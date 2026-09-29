/**
 * Minimal ambient declaration for the OPTIONAL playwright peer (E2.4): the
 * package typechecks without playwright installed (npm does not install
 * optional peers); the real types arrive when a user installs the peer.
 * Only the surface lumen touches is declared.
 */
declare module 'playwright' {
  export interface PlaywrightBrowser {
    newContext(o?: Record<string, unknown>): PlaywrightContext;
    close(): Promise<void>;
  }
  export interface PlaywrightContext {
    newPage(): PlaywrightPage;
    close(): Promise<void>;
  }
  export interface PlaywrightPage {
    goto(url: string, o?: Record<string, unknown>): Promise<unknown>;
    content(): Promise<string>;
    close(): Promise<void>;
  }
  export interface PlaywrightModule {
    chromium: { launch(o?: Record<string, unknown>): Promise<PlaywrightBrowser> };
  }
  export const chromium: PlaywrightModule['chromium'];
}
