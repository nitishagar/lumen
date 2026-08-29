/**
 * Typed error hierarchy (I15/I17 style): callers never pattern-match message
 * strings. Every error class extends `LumenError` and carries an optional
 * `label` naming the provider/context it originated from.
 */

/** One actionable validation problem, named by its config path. */
export interface ConfigErrorDetail {
  path: string;
  message: string;
}

export class LumenError extends Error {
  /** Provider or fetcher label the failure is attributed to (I17). */
  readonly label?: string;

  constructor(message: string, label?: string) {
    super(message);
    this.name = new.target.name;
    this.label = label;
  }
}

/** Invalid configuration — `details` names every offending key and the valid options. */
export class ConfigError extends LumenError {
  readonly details: readonly ConfigErrorDetail[];

  constructor(details: readonly ConfigErrorDetail[]) {
    super(`invalid config: ${details.map((d) => `${d.path}: ${d.message}`).join('; ')}`);
    this.details = Object.freeze([...details]);
  }
}
