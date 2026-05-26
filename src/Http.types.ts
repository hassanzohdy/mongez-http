import type { HttpError } from "./HttpError";

// ─── Primitives ──────────────────────────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

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
  /** Status codes that trigger a retry. Default: [429, 500, 502, 503, 504]. */
  retryOn?: number[];
}

// ─── Interceptors ────────────────────────────────────────────────────────────

export interface OutgoingRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: BodyInit;
}

export type BeforeInterceptor = (
  req: OutgoingRequest,
) => OutgoingRequest | void | Promise<OutgoingRequest | void>;

export type AfterInterceptor<T = unknown> = (
  result: HttpResult<T>,
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

// ─── Streaming ───────────────────────────────────────────────────────────────

/**
 * How each line of a streamed response is parsed.
 * - "sse"    — strips "data: " prefix, skips [DONE] and empty lines, JSON-parses remainder
 * - "ndjson" — skips empty lines, JSON-parses each line
 */
export type StreamFormat = "sse" | "ndjson";

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

  /** Request body — used for DELETE-with-body (bulkDelete) and similar. */
  data?: unknown;

  /**
   * How to decode the response body.
   * Default: auto-detect from Content-Type (json or text).
   */
  responseType?: ResponseType;

  /**
   * Called each time a chunk arrives.
   * When set, the body is read as a stream instead of buffered at once.
   */
  onDownloadProgress?: (event: DownloadProgressEvent) => void;
}
