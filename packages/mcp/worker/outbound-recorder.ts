/**
 * I16 outbound recorder + fixture responder for the Miniflare tests. Lives in
 * node-side module state (the outboundService callback runs in the Vitest
 * node context, outside workerd), so tests read/reset `outboundRecorder`
 * directly. The allowlist below ACTIVATES fully at the rebase commit when the
 * real providers start fetching (I1: zero PSI/CrUX outbound when no keys are
 * sent); pre-rebase the fixture providers fetch nothing, so the recorded list
 * must be EMPTY for every test.
 */

export interface OutboundCall {
  method: string;
  host: string;
  path: string;
}

/** The ONLY hosts the Worker may ever reach (I16 allowlist, post-rebase set). */
export const OUTBOUND_HOST_ALLOWLIST: readonly string[] = [
  'www.googleapis.com', // PSI + CrUX
  'api.openpagerank.com', // OPR
  'suggestqueries.google.com', // google-suggest
  'en.wikipedia.org', // wikipedia-demand
];

const recorded: OutboundCall[] = [];

export const outboundRecorder = {
  calls: (): readonly OutboundCall[] => recorded,
  reset: (): void => {
    recorded.length = 0;
  },
};

/** Deterministic fixture response for allowlisted upstreams (never live). */
const fixtureResponseFor = (req: Request): Response =>
  Response.json(
    { fixture: true, for: new URL(req.url).host, path: new URL(req.url).pathname },
    { headers: { 'content-type': 'application/json' } },
  );

export const recordAndFixture = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  recorded.push({ method: req.method, host: url.host, path: url.pathname });
  return fixtureResponseFor(req);
};

/** Test-side assertion helper: every recorded call is inside the allowlist. */
export const allCallsAllowed = (): boolean =>
  recorded.every((c) => (OUTBOUND_HOST_ALLOWLIST as readonly string[]).includes(c.host));
