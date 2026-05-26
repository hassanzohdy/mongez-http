import type { OutgoingRequest } from "./Http.types";

/**
 * Structured error thrown (or returned) by every Http method.
 *
 * All properties and predicates are accessible without calling a function:
 *   if (error.isAborted)        { return; }
 *   if (error.isNotFound)       { return null; }
 *   if (error.isValidationError) { return showErrors(error.body); }
 *   console.log(error.headers?.['x-request-id']);
 */
export class HttpError extends Error {
  /** HTTP status code, or null for network/abort/timeout errors. */
  public readonly status: number | null;

  /** Parsed response body (JSON if Content-Type is application/json, else raw text). */
  public readonly body: unknown;

  /** The raw Response object, if a response was received. */
  public readonly response: Response | null;

  /** True when the request was cancelled via AbortController. */
  public readonly isAborted: boolean;

  /** True when the request hit the timeout limit. */
  public readonly isTimeout: boolean;

  /** True for network-level failures (DNS, CORS, no connection). */
  public readonly isNetwork: boolean;

  /**
   * Response headers as a plain object. null when no response was received
   * (network error, timeout, or abort).
   *
   * Shortcut so you don't have to reach into `error.response?.headers.get(...)`:
   *   const remaining = error.headers?.['x-rate-limit-remaining'];
   */
  public readonly headers: Record<string, string> | null;

  /**
   * The outgoing request that triggered this error.
   * Useful in `throw: true` mode where you only have the HttpError (no HttpResult).
   *
   * Note: the `headers` object on the request may contain sensitive values
   * (Authorization, Cookie). Do not log this object without redacting first.
   */
  public readonly request: OutgoingRequest | null;

  constructor(opts: {
    message: string;
    status?: number | null;
    body?: unknown;
    response?: Response | null;
    isAborted?: boolean;
    isTimeout?: boolean;
    isNetwork?: boolean;
    headers?: Record<string, string> | null;
    request?: OutgoingRequest | null;
  }) {
    super(opts.message);
    this.name = "HttpError";
    this.status = opts.status ?? null;
    this.body = opts.body ?? null;
    this.response = opts.response ?? null;
    this.isAborted = opts.isAborted ?? false;
    this.isTimeout = opts.isTimeout ?? false;
    this.isNetwork = opts.isNetwork ?? false;
    this.headers = opts.headers ?? null;
    this.request = opts.request ?? null;

    // Preserve prototype chain in transpiled ES5 environments.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  // ─── Status predicates (getters — no () needed) ──────────────────────────────

  /** 4xx status code. */
  get isClientError(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }

  /** 5xx status code. */
  get isServerError(): boolean {
    return this.status !== null && this.status >= 500 && this.status < 600;
  }

  /** 401 Unauthorized. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** 403 Forbidden. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** 404 Not Found. */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** 422 Unprocessable Entity — typical validation error. */
  get isValidationError(): boolean {
    return this.status === 422;
  }

  /** 429 Too Many Requests. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      body: this.body,
      isAborted: this.isAborted,
      isTimeout: this.isTimeout,
      isNetwork: this.isNetwork,
      headers: this.headers,
      // `request` is intentionally omitted — it may contain raw Authorization / Cookie headers.
    };
  }
}
