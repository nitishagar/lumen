/**
 * GCRA pacing (I4/I10). A classic token bucket with capacity `rpm` allows a
 * full bucket drain PLUS a full refill inside one rolling 60 s window —
 * ~2×rpm, which is above the hard documented limits of CrUX (150 qpm) and
 * Open PageRank (60 req/min). GCRA guarantees that in any rolling 60 s
 * window at most `rpm + burst` requests conform, and `resolvePacing` clamps
 * that sum to ≤ each provider's documented limit — so the bound holds by
 * construction, whatever the config asks for.
 *
 * Mechanics (burst ≥ 1): with inter-arrival interval `i = 60_000/rpm` and
 * tolerance `τ = (burst − 1)·i`, a request at time `now` conforms iff
 * `now ≥ tat − τ` where `tat` is the theoretical arrival time; a conforming
 * request advances `tat = max(tat, now) + i`. From idle this admits exactly
 * `burst` back-to-back requests; sustained demand is spaced exactly `i`
 * apart; the 60 s window bound is `1 + ⌊(60_000 + τ)/i⌋ = rpm + burst`.
 */
export interface Pacer {
  /** Waits (via the injected sleep) until a request conforms, then admits it. */
  acquire(): Promise<void>;
  /** Admits immediately when conforming; never waits. */
  tryAcquire(): boolean;
}

export interface PacingCfg {
  rpm?: number;
  burst?: number;
}

/** Sub-millisecond slack absorbing float64 ulp rounding at epoch-scale clock values (harmless to the window bound). */
const FP_EPSILON_MS = 1e-3;

export class GcraPacer implements Pacer {
  private tat = 0; // theoretical arrival time (ms, injected-clock domain); 0 = idle

  constructor(
    readonly rpm: number,
    readonly burst: number,
    private readonly clock: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {
    if (!Number.isFinite(rpm) || rpm < 1) throw new RangeError(`GcraPacer rpm must be >= 1 (got ${rpm})`);
    if (!Number.isFinite(burst) || burst < 1) throw new RangeError(`GcraPacer burst must be >= 1 (got ${burst})`);
  }

  /** Worst-case count of conforming requests in any rolling 60 s window. */
  get worstCasePerMinute(): number {
    return this.rpm + this.burst;
  }

  /** Earliest clock time at which a request would conform given the current TAT. */
  private earliestConforming(): number {
    const interval = 60_000 / this.rpm;
    const tolerance = (this.burst - 1) * interval;
    return this.tat - tolerance;
  }

  tryAcquire(): boolean {
    const now = this.clock();
    if (now < this.earliestConforming() - FP_EPSILON_MS) return false;
    this.tat = Math.max(this.tat, now) + 60_000 / this.rpm;
    return true;
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = this.clock();
      const earliest = this.earliestConforming();
      if (now >= earliest - FP_EPSILON_MS) {
        this.tat = Math.max(this.tat, now) + 60_000 / this.rpm;
        return;
      }
      await this.sleep(earliest - now); // sleep to the TRUE boundary — no epsilon drift
    }
  }
}

/**
 * Applies config overrides on top of the provider defaults, clamped so that
 * `rpm + burst ≤ documentedLimit` whenever a documented limit exists
 * (TC-REG-6). A burst may never eat more than half the documented budget.
 * Providers without a documented limit pass overrides through untouched.
 */
export function resolvePacing(
  cfg: PacingCfg | undefined,
  defaults: { rpm: number; burst: number },
  documentedLimit?: number,
): { rpm: number; burst: number } {
  let rpm = Math.max(1, Math.floor(cfg?.rpm ?? defaults.rpm));
  let burst = Math.max(1, Math.floor(cfg?.burst ?? defaults.burst));
  if (documentedLimit !== undefined && documentedLimit >= 2) {
    burst = Math.min(burst, Math.max(1, Math.floor(documentedLimit / 2)));
    rpm = Math.min(rpm, documentedLimit - burst);
  }
  return { rpm, burst };
}
