import type { Http } from "./Http";

let _current: Http | null = null;

/**
 * Set the application-wide default Http instance.
 * Call this once during app bootstrap, before any Resource is used.
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
