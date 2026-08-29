/**
 * Handler-side unknown-argument guard (E7/B7 fallback, locked): rejection of
 * unknown/extra params is guaranteed REGARDLESS of what the wire inputSchema
 * advertises or what the installed SDK does with unknown keys. With the
 * current SDK + strictObject zod schemas this is redundant (the SDK rejects
 * before the handler runs) — kept deliberately so the contract cannot
 * silently regress on an SDK upgrade.
 */
export interface StrictArgsViolation {
  code: 'INVALID_ARGUMENTS';
  message: string;
}

export const strictArgs = (
  args: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): StrictArgsViolation | null => {
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k));
  if (unknown.length === 0) return null;
  return {
    code: 'INVALID_ARGUMENTS',
    message: `unknown argument(s): ${unknown.join(', ')} — allowed: ${allowed.join(', ')}`,
  };
};
