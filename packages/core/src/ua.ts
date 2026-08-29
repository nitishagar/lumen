/**
 * Fixed User-Agent (SC-12 / I4, BA-8): honest identification with a contact
 * URL, applied to every request, never suppressible or overridable in v1.
 *
 * The version is a literal here (no runtime JSON import — Workers-safe, F6);
 * `fetcher-basics.test.ts` asserts it stays equal to this package's
 * package.json `version` so a release bump cannot silently desync it.
 */
export const UA_VERSION = '0.0.0';

export const USER_AGENT = `lumen/${UA_VERSION} (+https://github.com/nitishagar/lumen)`;
