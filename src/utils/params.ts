import type { HttpParams } from "../Http.types";

/**
 * Serialise an HttpParams record into a URL query string (without leading "?").
 *
 * Arrays are expanded as repeated keys: { ids: [1,2,3] } → "ids=1&ids=2&ids=3"
 * null / undefined values are omitted.
 * Booleans are serialised as "true" / "false".
 */
export function buildQueryString(params: HttpParams): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.join("&");
}

/**
 * Append serialised params to a URL string, handling existing query strings.
 */
export function appendParams(url: string, params: HttpParams | undefined): string {
  if (!params || Object.keys(params).length === 0) return url;

  const qs = buildQueryString(params);
  if (!qs) return url;

  return url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
}
