/**
 * Typed local-only capability result (E6/I6): a capability absent from the
 * injected deps still LISTS the tool (identical tool set on both transports,
 * I5) but returns this typed error pointing at the CLI command to run
 * instead. Never a generic failure, never a silent empty success.
 */
export const LOCAL_ONLY_NOTE =
  'NOTE: unavailable over remote MCP (needs local compute: crawl/HTML parsing).';

export interface LocalOnlyPayload {
  code: 'LOCAL_ONLY_CAPABILITY';
  tool: string;
  message: string;
  cli: string;
}

export const localOnly = (tool: string, cli: string): LocalOnlyPayload => ({
  code: 'LOCAL_ONLY_CAPABILITY',
  tool,
  message: `${tool} needs local compute (crawl/HTML parsing) and is unavailable over remote MCP. Run instead: ${cli}`,
  cli,
});
