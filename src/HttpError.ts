/**
 * Structured error thrown (or returned) by every Http method.
 *
 * Discriminate programmatically:
 *   if (error.isAborted)  { ... }
 *   if (error.isTimeout)  { ... }
 *   if (error.isNetwork)  { ... }
 *   if (error.status === 422) { ... }
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

  constructor(opts: {
    message: string;
    status?: number | null;
    body?: unknown;
    response?: Response | null;
    isAborted?: boolean;
    isTimeout?: boolean;
    isNetwork?: boolean;
  }) {
    super(opts.message);
    this.name = "HttpError";
    this.status = opts.status ?? null;
    this.body = opts.body ?? null;
    this.response = opts.response ?? null;
    this.isAborted = opts.isAborted ?? false;
    this.isTimeout = opts.isTimeout ?? false;
    this.isNetwork = opts.isNetwork ?? false;

    // Preserve prototype chain in transpiled ES5 environments.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  // ─── Convenience predicates ──────────────────────────────────────────────────

  /** 4xx status code. */
  isClientError(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }

  /** 5xx status code. */
  isServerError(): boolean {
    return this.status !== null && this.status >= 500 && this.status < 600;
  }

  /** 401 Unauthorized. */
  isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** 403 Forbidden. */
  isForbidden(): boolean {
    return this.status === 403;
  }

  /** 404 Not Found. */
  isNotFound(): boolean {
    return this.status === 404;
  }

  /** 422 Unprocessable Entity — typical Laravel/API validation error. */
  isValidationError(): boolean {
    return this.status === 422;
  }

  /** 429 Too Many Requests. */
  isRateLimited(): boolean {
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
    };
  }
}
