/**
 * @lumen-seo/audit/testing — the supported test kit (E2.4): the fake fetcher
 * (the core-fetcher contract, zero network), deterministic crawl deps, and
 * the cheerio page factory. Everything plugin authors need to test rules the
 * way lumen's own suite does.
 */
export { FakeFetcher } from './fake-fetcher.js';
export type { FakeRoute, FakeCall } from './fake-fetcher.js';
export { makeTestDeps } from './deps.js';
export { makePage } from './page.js';
