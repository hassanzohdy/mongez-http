/**
 * Header names whose values are redacted before being exposed anywhere that
 * isn't the live outgoing request (events, error objects, logs).
 */
export const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
]);

/** Return a copy of `headers` with sensitive values replaced by "[redacted]". */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    safe[k] = SENSITIVE_HEADER_NAMES.has(k.toLowerCase()) ? "[redacted]" : v;
  }
  return safe;
}
