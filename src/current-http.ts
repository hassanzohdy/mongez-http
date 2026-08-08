import type { Http } from "./Http";

let _current: Http | null = null;

/**
 * Set the application-wide default Http instance.
 * Call this once during app bootstrap, before any Resource is used.
 *
 * > ⚠️ **This is module-level global state — safe in a browser, not on a server.**
 * > A server process handles many users concurrently, so calling this per request
 * > (e.g. to attach the current user's token) lets one request overwrite the instance
 * > another is mid-way through using, and requests can end up sending the wrong
 * > credentials. On a server either set a single instance with no per-user state at
 * > bootstrap, or skip this entirely and build a request-scoped `new Http({ auth })`,
 * > passing it explicitly to whatever needs it.
 *
 * @example
 * import { Http, setCurrentHttp } from '@mongez/http';
 *
 * const http = new Http({ baseURL: 'https://api.example.com' });
 * setCurrentHttp(http);
 */
export function setCurrentHttp(instance: Http): void {
  _current = instance;
}

/**
 * Get the application-wide default Http instance.
 * Throws if `setCurrentHttp` was never called — fail loudly rather than silently.
 */
export function getCurrentHttp(): Http {
  if (!_current) {
    throw new Error(
      "@mongez/http: No default Http instance found. " +
        "Call setCurrentHttp(http) during app bootstrap before using Resource.",
    );
  }
  return _current;
}
