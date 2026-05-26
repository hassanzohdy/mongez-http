import type { HttpError } from "./HttpError";

// ─── Primitives ──────────────────────────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type HttpData =
  | string
  | object
  | FormData
  | (typeof globalThis extends { HTMLFormElement: infer T } ? T : never);

export type HttpParams = Record<
  string,
  string | number | boolean | (string | number)[] | null | undefined
>;

// ─── Cache ───────────────────────────────────────────────────────────────────

/**
 * Minimal interface any cache driver must satisfy.
 * Compatible with @mongez/cache drivers out of the box.
 */
export interface CacheDriver {
  get<T = unknown>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown, ttl?: number): Promise<void> | void;
  remove?(key: string): Promise<void> | void;
  /** Clear all entries. Required for `http.invalidateAll()`. */
  clear?(): Promise<void> | void;
}

export interface HttpCacheConfig {
  driver: CacheDriver;
  /** Time-to-live in seconds. Default: 300 (5 min). */
  ttl?: number;
  /** Custom key generator. Default: baseURL + path + serialised params. */
  generateKey?: (url: string, params?: HttpParams) => string;
}

// ─── Retry ───────────────────────────────────────────────────────────────────

export interface HttpRetryConfig {
  /** Number of retry attempts. */
  attempts: number;
  /** Base delay between retries in ms. */
  delay: number;
  /** Double delay after each attempt. Default: true. */
  backoff?: boolean;
  /**
   * Add randomised jitter to retry delays to avoid thundering-herd problems.
   * When true, each delay is multiplied by a random factor in [0.5, 1.0].
   * Default: false.
   */
  jitter?: boolean;
  /** Status codes that trigger a retry. Default: [429, 500, 502, 503, 504]. */
  retryOn?: number[];
  /**
   * Called before each retry attempt.
   * @param attempt 1-based attempt number (1 = first retry).
   * @param error   The error that triggered the retry.
   * @param delay   The computed delay in ms before the retry fires.
   */
  onRetry?: (attempt: number, error: HttpError, delay: number) => void;
}

// ─── Interceptors ────────────────────────────────────────────────────────────

export interface OutgoingRequest {
  /** HTTP method. Supports all standard methods plus arbitrary strings for escape-hatch use. */
  method: HttpMethod | string;
  url: string;
  headers: Record<string, string>;
  body?: BodyInit;
}

export type BeforeInterceptor = (
  req: OutgoingRequest,
) => OutgoingRequest | void | Promise<OutgoingRequest | void>;

// ─── After interceptor context ────────────────────────────────────────────────

export interface AfterInterceptorContext<T = unknown> {
  /**
   * Re-fire the original request from scratch — re-runs auth, before-interceptors,
   * and the full request pipeline with freshly-resolved credentials.
   *
   * Typical use case: catch a 401, refresh the token, call `replay()` to retry.
   *
   * **Infinite-loop guard:** inside a replayed request's after-interceptors,
   * `replay()` is a no-op that immediately returns the current result unchanged.
   *
   * @example
   * http.after(async (result, { replay }) => {
   *   if (result.error?.isUnauthorized) {
   *     await refreshToken();
   *     return replay();
   *   }
   * });
   */
  replay(): Promise<HttpResult<T>>;
}

export type AfterInterceptor<T = unknown> = (
  result: HttpResult<T>,
  context: AfterInterceptorContext<T>,
) => HttpResult<T> | void | Promise<HttpResult<T> | void>;

// ─── Events ──────────────────────────────────────────────────────────────────

export type HttpEvent = "request" | "response" | "error";

export type HttpEventPayload<T = unknown> = {
  request: OutgoingRequest;
  response?: HttpResult<T>;
};

export type HttpEventHandler<T = unknown> = (
  payload: HttpEventPayload<T>,
) => void;

// ─── Result ──────────────────────────────────────────────────────────────────

/**
 * Every Http method returns this discriminated union.
 *
 *   const { data, error, headers, request } = await http.get<User[]>('/users');
 *   if (error) { ... }  // data is null
 *   // data is User[] here
 */
export type HttpResult<T> =
  | {
      data: T;
      error: null;
      status: number;
      response: Response;
      /** Response headers as a plain object for easy access and serialisation. */
      headers: Record<string, string>;
      /** The outgoing request that produced this result. */
      request: OutgoingRequest;
    }
  | {
      data: null;
      error: HttpError;
      status: number | null;
      response: Response | null;
      /** Response headers, or null when no response was received. */
      headers: Record<string, string> | null;
      /** The outgoing request that produced this result. */
      request: OutgoingRequest;
    };

// ─── Configuration ───────────────────────────────────────────────────────────

export interface HttpConfig {
  /** Base URL prepended to every request path. */
  baseURL?: string;

  /**
   * Authorization header value or a factory called before each request.
   * Return null/undefined to skip the header for that request.
   */
  auth?: string | ((req: OutgoingRequest) => string | null | undefined);

  /**
   * Convert PUT requests to POST + append `putMethodKey=PUT` in the body.
   * Useful for Laravel-style file uploads.
   * @default false
   */
  putToPost?: boolean;

  /**
   * Key appended to the body when `putToPost` is true.
   * @default "_method"
   */
  putMethodKey?: string;

  /** Default timeout in ms. No timeout by default. */
  timeout?: number;

  /** Default headers merged into every request. */
  headers?: Record<string, string>;

  /**
   * Default query parameters appended to every request.
   * Per-request `params` are merged on top (per-request wins on conflict).
   *
   * @example
   * const http = new Http({ baseURL, params: { api_key: 'xyz', version: 'v2' } });
   * // Every request automatically includes ?api_key=xyz&version=v2
   */
  params?: HttpParams;

  /**
   * Controls whether cookies and HTTP authentication are sent with requests.
   *
   * - `"same-origin"` *(default)* — cookies sent only to same-origin URLs.
   * - `"include"` — cookies sent to all URLs, including cross-origin.
   *   The server must respond with `Access-Control-Allow-Credentials: true`.
   * - `"omit"` — cookies never sent.
   *
   * **Browser note:** `"include"` is required for cross-origin cookie-based auth.
   * **Node.js note:** the native fetch cookie jar is not used; manage cookies
   * manually via `headers: { Cookie: '...' }` and read `Set-Cookie` from
   * `result.headers['set-cookie']`.
   */
  credentials?: RequestCredentials;

  /**
   * CORS mode for all requests.
   *
   * - `"cors"` *(default)* — cross-origin requests are allowed; server must send CORS headers.
   * - `"no-cors"` — cross-origin request with limited response access (opaque response).
   * - `"same-origin"` — only same-origin requests; cross-origin throws.
   * - `"navigate"` — used by browser navigation; rarely needed in API clients.
   */
  mode?: RequestMode;

  /**
   * Keep the underlying TCP connection alive after the page unloads.
   * Useful for fire-and-forget analytics / telemetry beacons sent on `unload`/`pagehide`.
   * Maximum body size is 64 KB when `keepalive` is true.
   * @default false
   */
  keepalive?: boolean;

  /**
   * How to handle HTTP redirects.
   * - `"follow"` *(default)* — automatically follow redirects.
   * - `"error"` — throw a network error on any redirect.
   * - `"manual"` — return the redirect response opaquely (status 0) for manual handling.
   */
  redirect?: RequestRedirect;

  /** Enable/configure response caching for GET requests. */
  cache?: boolean | HttpCacheConfig;

  /** Retry failed requests. */
  retry?: HttpRetryConfig;

  /**
   * Key used by Resource.publish().
   * @default "published"
   */
  publishKey?: string;
}

// ─── Response type ───────────────────────────────────────────────────────────

/**
 * Controls how the response body is decoded.
 * Default: auto-detect from Content-Type (json → JSON, otherwise text).
 */
export type ResponseType = "json" | "text" | "blob" | "arrayBuffer";

// ─── Download progress ───────────────────────────────────────────────────────

export interface DownloadProgressEvent {
  /** Bytes received so far. */
  loaded: number;
  /** Total bytes expected. null when the server omits Content-Length. */
  total: number | null;
  /** 0–100, or null when total is unknown. */
  percent: number | null;
}

// ─── Upload progress ─────────────────────────────────────────────────────────

export interface UploadProgressEvent {
  /** Bytes sent so far. */
  loaded: number;
  /**
   * Total bytes in the request body.
   * `null` for FormData bodies — the browser doesn't expose the serialized size
   * until transmission begins. Accurate for string / ArrayBuffer bodies.
   */
  total: number | null;
  /** 0–100, or null when total is unknown. */
  percent: number | null;
}

// ─── Streaming ───────────────────────────────────────────────────────────────

/**
 * How each line / event of a streamed response is parsed.
 * - "sse"    — full Server-Sent Events parsing: id/event/data/retry fields,
 *              multi-line data concatenation, [DONE] skipping, JSON parsing.
 * - "ndjson" — skips empty lines, JSON-parses each line.
 */
export type StreamFormat = "sse" | "ndjson";

/**
 * A parsed Server-Sent Event with all fields.
 * Yielded by `Http.streamEvents()` when you need the full SSE envelope.
 */
export interface SseEvent<T = unknown> {
  /** The `id:` field. Tracked as `Last-Event-ID` on reconnect. */
  id?: string;
  /** The `event:` field (named event type). Undefined for un-named events. */
  event?: string;
  /** Parsed data payload. */
  data: T;
}

export interface StreamRequestOptions
  extends Omit<
    RequestOptions,
    "data" | "responseType" | "onDownloadProgress" | "cache" | "retry"
  > {
  /** HTTP method. Default: "GET". Use "POST" for chat-style APIs. */
  method?: HttpMethod;
  /** Request body for streaming POST/PUT. */
  data?: HttpData;
  /** Line parsing strategy. Default: "sse". */
  format?: StreamFormat;
  /**
   * Custom line parser. Return undefined to skip a line.
   * When provided, overrides the built-in SSE / NDJSON parsers.
   */
  parseLine?: (line: string) => unknown;
  /**
   * Automatically reconnect when the SSE stream disconnects.
   * Default: `false`. Set to `true` to enable proper SSE auto-reconnection.
   * Reconnections send a `Last-Event-ID` header so the server can resume.
   * Does NOT reconnect on non-2xx HTTP errors (wrong path, auth failure, etc.).
   */
  reconnect?: boolean;
  /**
   * Maximum number of reconnection attempts before giving up.
   * Default: unlimited.
   */
  maxReconnectAttempts?: number;
  /**
   * Base delay in ms between reconnection attempts.
   * Overridden by the server's `retry:` directive if present.
   * Default: 3000.
   */
  reconnectDelay?: number;
}

// ─── Per-request options ─────────────────────────────────────────────────────

export interface RequestOptions {
  /** Query string parameters. */
  params?: HttpParams;

  /** Per-request headers merged on top of global headers. */
  headers?: Record<string, string>;

  /** External AbortSignal (React Query, useEffect cleanup, etc.). */
  signal?: AbortSignal;

  /** Override global cache setting for this request. */
  cache?: boolean | Omit<HttpCacheConfig, "driver"> & { driver?: CacheDriver };

  /** Explicit cache key override. */
  cacheKey?: string;

  /** Override global retry setting for this request. */
  retry?: boolean | Partial<HttpRetryConfig>;

  /**
   * When true, throw HttpError instead of returning { data: null, error }.
   * Useful for try/catch boundaries.
   * @default false
   */
  throw?: boolean;

  /** Per-request timeout override in ms. */
  timeout?: number;

  /**
   * Override the global `credentials` setting for this single request.
   * See `HttpConfig.credentials` for full documentation.
   */
  credentials?: RequestCredentials;

  /**
   * Override the global `mode` setting for this single request.
   * See `HttpConfig.mode` for full documentation.
   */
  mode?: RequestMode;

  /**
   * Override the global `keepalive` setting for this single request.
   * See `HttpConfig.keepalive` for full documentation.
   */
  keepalive?: boolean;

  /**
   * Override the global `redirect` setting for this single request.
   * See `HttpConfig.redirect` for full documentation.
   */
  redirect?: RequestRedirect;

  /** Request body — used for DELETE-with-body (bulkDelete) and similar. */
  data?: unknown;

  /**
   * How to decode the response body.
   * Default: auto-detect from Content-Type (json or text).
   */
  responseType?: ResponseType;

  /**
   * Called each time a download chunk arrives.
   * When set, the body is read as a stream instead of buffered at once.
   */
  onDownloadProgress?: (event: DownloadProgressEvent) => void;

  /**
   * Called each time a chunk of the request body is sent.
   *
   * **Accurate progress** is available for `string` and `ArrayBuffer` bodies
   * (the body is wrapped in a `ReadableStream` and chunked at 64 KiB intervals).
   *
   * **FormData bodies** do not support accurate progress because the browser
   * serializes them internally without exposing the size. No events will fire
   * for FormData — use a library like `axios` if you need FormData upload progress.
   *
   * Requires `duplex: "half"` fetch support (Chrome 105+, Node.js 18+,
   * Safari 17.4+). Environments without it fall back to no progress events.
   */
  onUploadProgress?: (event: UploadProgressEvent) => void;
}
