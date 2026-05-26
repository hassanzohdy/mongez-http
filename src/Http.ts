import type {
  AfterInterceptor,
  BeforeInterceptor,
  CacheDriver,
  HttpCacheConfig,
  HttpConfig,
  HttpData,
  HttpEventHandler,
  HttpEventPayload,
  HttpMethod,
  HttpParams,
  HttpResult,
  HttpRetryConfig,
  OutgoingRequest,
  RequestOptions,
  StreamFormat,
  StreamRequestOptions,
} from "./Http.types";
import { HttpError } from "./HttpError";
import { type CancellableAsyncIterable, type CancellablePromise, makeCancellable } from "./cancellable";
import { appendParams } from "./utils/params";
import { parseBody, prepareBody, readBodyWithProgress } from "./utils/body";

// ─── Module-level helpers ─────────────────────────────────────────────────────

/**
 * Matches any URL scheme that is NOT http or https.
 * Used to block javascript:, data:, file:, ftp:, etc.
 */
const BLOCKED_SCHEMES = /^(?!https?:\/\/)[a-z][a-z0-9+\-.]*:/i;

/**
 * Header names/values whose values are redacted before being placed in event payloads.
 * This prevents credentials from leaking to third-party event listeners / loggers.
 */
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
]);

/**
 * Join a base URL (may include protocol + host) with a path segment.
 * - Blocks non-http(s) schemes when base is empty (javascript:, data:, file:, …).
 * - Normalises the joined URL via `new URL()` to collapse any `..` path-traversal
 *   sequences before the string reaches fetch().
 */
function joinUrl(base: string, path: string): string {
  if (!base) {
    if (BLOCKED_SCHEMES.test(path)) {
      throw new Error(
        `@mongez/http: Blocked request to unsafe URL scheme — "${path.slice(0, 80)}"`,
      );
    }
    return path;
  }
  const joined = base.replace(/\/$/, "") + "/" + path.replace(/^\//, "");
  // Normalise through the URL parser so "../.." sequences are resolved before fetch sees them.
  try {
    return new URL(joined).href;
  } catch {
    return joined; // Non-absolute URL (e.g. relative path used in tests) — return as-is.
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => { result[key] = value; });
  return result;
}

/**
 * Throw if any header name or value contains CR or LF characters.
 * Defence-in-depth against header injection; most runtimes already validate this,
 * but failing early with a clear message is better than a cryptic runtime error.
 */
function assertSafeHeaders(headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) {
      throw new Error(
        `@mongez/http: Header "${name}" contains invalid CR or LF character.`,
      );
    }
  }
}

/**
 * Return a copy of `req` with sensitive header values replaced by "[redacted]".
 * Used when emitting events so third-party listeners (analytics, loggers) never
 * receive raw credentials.
 */
function sanitiseRequestForEvent(req: OutgoingRequest): OutgoingRequest {
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    safe[k] = SENSITIVE_HEADER_NAMES.has(k.toLowerCase()) ? "[redacted]" : v;
  }
  return { ...req, headers: safe };
}

const DEFAULT_RETRY_ON = [429, 500, 502, 503, 504];
const DEFAULT_TTL = 300; // 5 minutes

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCacheKey(url: string, params?: HttpParams): string {
  const qs = params ? JSON.stringify(params) : "";
  return `http:${url}${qs ? `:${qs}` : ""}`;
}

/**
 * Parse a single line from a stream according to the requested format.
 * Returns undefined to signal "skip this line".
 */
function parseStreamLine<T>(
  line: string,
  format: StreamFormat,
  customParser?: (line: string) => unknown,
): T | undefined {
  if (customParser) return customParser(line) as T | undefined;

  if (format === "sse") {
    if (!line.startsWith("data:")) return undefined;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return undefined;
    try {
      return JSON.parse(data) as T;
    } catch {
      return data as unknown as T;
    }
  }

  // ndjson
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return trimmed as unknown as T;
  }
}

// ─── Http ─────────────────────────────────────────────────────────────────────

export class Http {
  private readonly config: HttpConfig;
  private readonly beforeInterceptors: BeforeInterceptor[] = [];
  private readonly afterInterceptors: AfterInterceptor[] = [];
  private readonly eventHandlers: Map<string, HttpEventHandler[]> = new Map();
  /**
   * In-flight GET entries keyed by URL+params. Each entry tracks the shared underlying
   * promise, the shared AbortController, and a ref-count of active callers.
   * When the last caller cancels, the shared fetch is aborted.
   */
  private readonly inFlight = new Map<string, {
    promise: Promise<HttpResult<unknown>>;
    sharedController: AbortController;
    refs: number;
  }>();

  constructor(config: HttpConfig = {}) {
    this.config = config;
  }

  // ─── Configuration ──────────────────────────────────────────────────────────

  /** Return a new Http instance that inherits this config merged with overrides. */
  extend(overrides: HttpConfig): Http {
    return new Http({ ...this.config, ...overrides });
  }

  getConfig(): Readonly<HttpConfig> {
    return this.config;
  }

  // ─── Interceptors ───────────────────────────────────────────────────────────

  before(interceptor: BeforeInterceptor): this {
    this.beforeInterceptors.push(interceptor);
    return this;
  }

  after<T = unknown>(interceptor: AfterInterceptor<T>): this {
    this.afterInterceptors.push(interceptor as AfterInterceptor);
    return this;
  }

  // ─── Events ─────────────────────────────────────────────────────────────────

  on<T = unknown>(event: string, handler: HttpEventHandler<T>): this {
    const list = this.eventHandlers.get(event) ?? [];
    list.push(handler as HttpEventHandler);
    this.eventHandlers.set(event, list);
    return this;
  }

  off<T = unknown>(event: string, handler: HttpEventHandler<T>): this {
    const list = this.eventHandlers.get(event);
    if (list) {
      const idx = list.indexOf(handler as HttpEventHandler);
      if (idx !== -1) list.splice(idx, 1);
    }
    return this;
  }

  private emit<T>(event: string, payload: HttpEventPayload<T>): void {
    const list = this.eventHandlers.get(event);
    if (list) {
      for (const handler of list) handler(payload as HttpEventPayload);
    }
  }

  // ─── Public HTTP methods ─────────────────────────────────────────────────────

  get<T = unknown>(path: string, options?: RequestOptions): CancellablePromise<HttpResult<T>> {
    return this.request<T>("GET", path, undefined, options);
  }

  post<T = unknown>(path: string, data?: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<T>> {
    return this.request<T>("POST", path, data, options);
  }

  put<T = unknown>(path: string, data?: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<T>> {
    return this.request<T>("PUT", path, data, options);
  }

  patch<T = unknown>(path: string, options?: RequestOptions): CancellablePromise<HttpResult<T>> {
    return this.request<T>("PATCH", path, options?.data as HttpData | undefined, options);
  }

  delete<T = unknown>(path: string, options?: RequestOptions): CancellablePromise<HttpResult<T>> {
    return this.request<T>("DELETE", path, options?.data as HttpData | undefined, options);
  }

  head(path: string, options?: RequestOptions): CancellablePromise<HttpResult<null>> {
    return this.request<null>("HEAD", path, undefined, options);
  }

  options<T = unknown>(path: string, options?: RequestOptions): CancellablePromise<HttpResult<T>> {
    return this.request<T>("OPTIONS", path, undefined, options);
  }

  /**
   * Send a request with any HTTP method — the escape hatch for non-standard verbs.
   * All convenience methods delegate here.
   *
   * GET requests are automatically deduplicated: concurrent calls with the same URL
   * share a single underlying fetch. Each caller gets its own CancellablePromise.
   *
   * Note: cancelling a deduplicated GET does not abort the shared fetch — other
   * callers waiting for the same URL are unaffected.
   */
  request<T = unknown>(
    method: HttpMethod | string,
    path: string,
    data?: HttpData,
    options: RequestOptions = {},
  ): CancellablePromise<HttpResult<T>> {
    if (method === "GET") {
      const dedupeKey = appendParams(
        joinUrl(this.config.baseURL ?? "", path),
        options.params,
      );

      if (!this.inFlight.has(dedupeKey)) {
        const sharedController = new AbortController();
        const promise = this.execute<T>(method, path, data, options, sharedController.signal) as Promise<HttpResult<unknown>>;
        this.inFlight.set(dedupeKey, { promise, sharedController, refs: 0 });
        // Use then(cb, cb) rather than finally(cb): the .finally() variant creates a
        // derived promise that re-throws any rejection, causing an unhandled-rejection
        // warning when no external consumer has attached a rejection handler to it yet.
        const cleanup = (): void => { this.inFlight.delete(dedupeKey); };
        promise.then(cleanup, cleanup);
      }

      const entry = this.inFlight.get(dedupeKey)!;
      entry.refs++;

      // Each caller gets its own AbortController so cancel() is per-caller.
      // When the last active caller cancels, the shared fetch is aborted too.
      const callerController = new AbortController();

      callerController.signal.addEventListener("abort", (): void => {
        entry.refs--;
        if (entry.refs <= 0) {
          entry.sharedController.abort(callerController.signal.reason);
        }
      }, { once: true });

      // Forward an external signal (React Query / useEffect) to the caller controller.
      if (options.signal) {
        if (options.signal.aborted) {
          callerController.abort(options.signal.reason);
        } else {
          const extSignal = options.signal;
          extSignal.addEventListener(
            "abort",
            (): void => callerController.abort(extSignal.reason),
            { once: true },
          );
        }
      }

      // .then() produces a fresh promise object — safe to attach per-caller properties.
      const callerPromise = entry.promise.then((r) => r as HttpResult<T>);
      return Object.assign(callerPromise, {
        cancel: (reason?: string): void => callerController.abort(reason ?? "cancelled"),
        signal: callerController.signal,
      }) as unknown as CancellablePromise<HttpResult<T>>;
    }

    return makeCancellable(
      (signal) => this.execute<T>(method as HttpMethod, path, data, options, signal),
      options.signal,
    );
  }

  // ─── Cache management ────────────────────────────────────────────────────────

  /**
   * Remove a single cache entry by key.
   * Pass the same key used in `options.cacheKey`, or the auto-generated key:
   * `http:<url>:<serialised-params>`.
   */
  async invalidate(key: string): Promise<void> {
    const config = this.resolveCacheConfig({});
    if (config?.driver.remove) {
      await config.driver.remove(key);
    }
  }

  /**
   * Remove all cache entries. Requires the driver to implement `clear()`.
   */
  async invalidateAll(): Promise<void> {
    const config = this.resolveCacheConfig({});
    if (config?.driver.clear) {
      await config.driver.clear();
    }
  }

  // ─── Streaming ──────────────────────────────────────────────────────────────

  /**
   * Open a streaming connection and yield parsed chunks as an async iterable.
   *
   * Supports Server-Sent Events (SSE) and newline-delimited JSON (NDJSON).
   * Use `.cancel()` to abort the stream from outside the loop.
   *
   * @example
   * for await (const chunk of http.stream<ChatChunk>('/chat', {
   *   method: 'POST',
   *   data: { messages },
   * })) {
   *   process(chunk);
   * }
   */
  stream<T = unknown>(
    path: string,
    options: StreamRequestOptions = {},
  ): CancellableAsyncIterable<T> {
    const controller = new AbortController();

    if (options.signal) {
      const ext = options.signal;
      if (ext.aborted) {
        controller.abort(ext.reason);
      } else {
        ext.addEventListener("abort", () => controller.abort(ext.reason), { once: true });
      }
    }

    const format = options.format ?? "sse";
    const self = this;

    async function* generator(): AsyncGenerator<T> {
      // ── Build request (shared logic with regular requests) ───────────────────
      const extraHeaders: Record<string, string> = {};
      if (!options.headers?.["Accept"]) {
        extraHeaders["Accept"] = "text/event-stream, application/x-ndjson, */*";
      }

      const req = await self.buildOutgoingRequest(
        options.method ?? "GET",
        path,
        options.data as HttpData | undefined,
        options,
        extraHeaders,
      );

      self.emit("request", { request: sanitiseRequestForEvent(req) });

      // ── Fetch ────────────────────────────────────────────────────────────────
      let response: Response;
      try {
        response = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) return; // cancelled — end silently
        const err = new HttpError({ message: "Stream network error", isNetwork: true });
        self.emit("error", { request: sanitiseRequestForEvent(req), response: undefined });
        throw err;
      }

      if (!response.ok) {
        const errorBody = await parseBody(response).catch(() => null);
        const err = new HttpError({
          message: `HTTP ${response.status} ${response.statusText}`,
          status: response.status,
          body: errorBody,
          response,
        });
        self.emit("error", { request: sanitiseRequestForEvent(req), response: undefined });
        throw err;
      }

      // ── Read line-by-line ────────────────────────────────────────────────────
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          let readResult: ReadableStreamReadResult<Uint8Array>;
          try {
            readResult = await reader.read();
          } catch {
            if (controller.signal.aborted) return; // cancelled — end silently
            const err = new HttpError({ message: "Stream read error", isNetwork: true });
            self.emit("error", { request: sanitiseRequestForEvent(req), response: undefined });
            throw err;
          }

          const { done, value } = readResult;
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Split on newlines; keep the last (potentially incomplete) fragment.
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const parsed = parseStreamLine<T>(
              line,
              format,
              options.parseLine as ((l: string) => T | undefined) | undefined,
            );
            if (parsed !== undefined) yield parsed;
          }
        }

        // Flush any remaining buffered content.
        if (buffer.trim()) {
          const parsed = parseStreamLine<T>(
            buffer,
            format,
            options.parseLine as ((l: string) => T | undefined) | undefined,
          );
          if (parsed !== undefined) yield parsed;
        }
      } finally {
        reader.releaseLock();
      }
    }

    const gen = generator();

    return {
      [Symbol.asyncIterator](): AsyncIterator<T> { return gen; },
      cancel(reason?: string): void { controller.abort(reason ?? "cancelled"); },
      get signal(): AbortSignal { return controller.signal; },
    };
  }

  // ─── Core execution ──────────────────────────────────────────────────────────

  /**
   * Build the final OutgoingRequest: URL, headers, auth, before-interceptors.
   * Shared by both regular requests and streaming.
   */
  private async buildOutgoingRequest(
    method: HttpMethod | string,
    path: string,
    data: HttpData | undefined,
    options: Pick<RequestOptions, "params" | "headers">,
    extraHeaders: Record<string, string> = {},
  ): Promise<OutgoingRequest> {
    const baseURL = this.config.baseURL ?? "";
    const fullPath = appendParams(joinUrl(baseURL, path), options.params);

    const { body, contentType } = prepareBody(data);

    const headers: Record<string, string> = {
      ...(this.config.headers ?? {}),
      ...extraHeaders,
      ...(options.headers ?? {}),
    };

    if (contentType && !headers["Content-Type"]) {
      headers["Content-Type"] = contentType;
    }

    const outgoing: OutgoingRequest = { method, url: fullPath, headers, body };

    const authValue = typeof this.config.auth === "function"
      ? this.config.auth(outgoing)
      : this.config.auth;

    if (authValue) headers["Authorization"] = authValue;

    // Defence-in-depth: reject headers with embedded CR/LF before they reach fetch().
    assertSafeHeaders(headers);

    let req = outgoing;
    for (const interceptor of this.beforeInterceptors) {
      const modified = await interceptor(req);
      if (modified) req = modified;
    }

    return req;
  }

  private async execute<T>(
    method: HttpMethod,
    path: string,
    data: HttpData | undefined,
    options: RequestOptions,
    signal: AbortSignal,
  ): Promise<HttpResult<T>> {
    // ── putToPost conversion ──────────────────────────────────────────────────
    let actualMethod: HttpMethod | string = method;
    let actualData = data;

    if (method === "PUT" && this.config.putToPost) {
      actualMethod = "POST";
      const key = this.config.putMethodKey ?? "_method";
      if (actualData instanceof FormData) {
        actualData.append(key, "PUT");
      } else if (typeof actualData === "object" && actualData !== null) {
        actualData = { ...(actualData as object), [key]: "PUT" };
      } else {
        actualData = { [key]: "PUT" };
      }
    }

    // ── Build outgoing request ────────────────────────────────────────────────
    const req = await this.buildOutgoingRequest(actualMethod, path, actualData, options);

    // ── Cache check (GET only) — runs before emitting "request" so the event
    //    only fires for actual network calls, not cache hits. ─────────────────
    const cacheConfig = this.resolveCacheConfig(options);
    let cacheKey: string | undefined;

    if (actualMethod === "GET" && cacheConfig) {
      cacheKey = options.cacheKey ??
        (cacheConfig.generateKey
          ? cacheConfig.generateKey(req.url, options.params)
          : buildCacheKey(req.url, options.params));

      const cached = await cacheConfig.driver.get<T>(cacheKey);
      if (cached !== null && cached !== undefined) {
        return { data: cached, error: null, status: 200, response: new Response(), headers: {}, request: req };
      }
    }

    // ── Emit "request" (only for real network calls, never for cache hits) ────
    // Credentials are redacted in the event payload so third-party listeners
    // (analytics, loggers) never receive raw Authorization / Cookie values.
    this.emit("request", { request: sanitiseRequestForEvent(req) });

    // ── Retry wrapper ─────────────────────────────────────────────────────────
    const retryConfig = this.resolveRetryConfig(options);
    return this.executeWithRetry<T>(req, signal, options, cacheConfig, retryConfig, cacheKey);
  }

  private async executeWithRetry<T>(
    req: OutgoingRequest,
    signal: AbortSignal,
    options: RequestOptions,
    cacheConfig: ResolvedCache | null,
    retryConfig: HttpRetryConfig | null,
    cacheKey: string | undefined,
    attempt = 0,
  ): Promise<HttpResult<T>> {
    try {
      return await this.executeSingle<T>(req, signal, options, cacheConfig, cacheKey);
    } catch (err) {
      // Guard: only handle HttpErrors — rethrow anything else (e.g. interceptor bugs).
      if (!(err instanceof HttpError)) throw err;

      // Never retry aborts or timeouts.
      if (err.isAborted || err.isTimeout) {
        return this.errorResult<T>(err, options, req);
      }

      if (
        retryConfig &&
        attempt < retryConfig.attempts &&
        this.shouldRetry(err, retryConfig)
      ) {
        const base = retryConfig.backoff !== false
          ? retryConfig.delay * Math.pow(2, attempt)
          : retryConfig.delay;

        // Optional jitter: multiply by a random factor in [0.5, 1.0] to avoid
        // thundering-herd problems when many clients retry simultaneously.
        let delay = retryConfig.jitter === true
          ? base * (0.5 + Math.random() * 0.5)
          : base;

        // Respect the Retry-After header (common on 429 responses).
        // Never wait less than the server explicitly requested.
        if (err.response) {
          const retryAfterRaw = err.response.headers.get("Retry-After");
          if (retryAfterRaw) {
            const serverDelayMs = parseInt(retryAfterRaw, 10) * 1000;
            if (!isNaN(serverDelayMs) && serverDelayMs > delay) {
              delay = serverDelayMs;
            }
          }
        }

        await sleep(delay);
        return this.executeWithRetry<T>(req, signal, options, cacheConfig, retryConfig, cacheKey, attempt + 1);
      }

      return this.errorResult<T>(err, options, req);
    }
  }

  private async executeSingle<T>(
    req: OutgoingRequest,
    signal: AbortSignal,
    options: RequestOptions,
    cacheConfig: ResolvedCache | null,
    cacheKey: string | undefined,
  ): Promise<HttpResult<T>> {
    // Fast path: if the signal was already aborted before the microtask queue
    // delivered execute() — e.g. cancel() was called synchronously right after
    // creating the request — throw immediately without touching fetch.
    // AbortSignal does NOT fire "abort" listeners retroactively, so waiting for
    // the event inside the fetch mock (or real fetch) would hang forever.
    if (signal.aborted) {
      throw new HttpError({ message: "Request was cancelled", isAborted: true });
    }

    // ── Timeout ───────────────────────────────────────────────────────────────
    const timeout = options.timeout ?? this.config.timeout;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timeoutController: AbortController | undefined;

    if (timeout !== undefined) {
      timeoutController = new AbortController();
      timeoutId = setTimeout(() => timeoutController!.abort("timeout"), timeout);
    }

    const effectiveSignal = timeoutController
      ? mergeSignals(signal, timeoutController.signal)
      : signal;

    let response: Response;
    try {
      response = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: effectiveSignal,
      });
    } catch (err) {
      clearTimeout(timeoutId);

      const timedOut = timeoutController?.signal.aborted ?? false;
      const isTimeout = timedOut || (err instanceof Error && err.message === "timeout");
      const isAborted = !isTimeout && signal.aborted;
      const isNetwork = !isTimeout && !isAborted;

      throw new HttpError({
        message: isTimeout
          ? `Request timed out after ${timeout}ms`
          : isAborted
            ? "Request was cancelled"
            : `Network error: ${err instanceof Error ? err.message : String(err)}`,
        isAborted,
        isTimeout,
        isNetwork,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const parsedBody = options.onDownloadProgress
      ? await readBodyWithProgress(response, options.onDownloadProgress, options.responseType)
      : await parseBody(response, options.responseType);

    if (!response.ok) {
      throw new HttpError({
        message: `HTTP ${response.status} ${response.statusText}`,
        status: response.status,
        body: parsedBody,
        response,
      });
    }

    // ── Store in cache ────────────────────────────────────────────────────────
    if (cacheConfig && cacheKey) {
      await cacheConfig.driver.set(cacheKey, parsedBody as T, cacheConfig.ttl ?? DEFAULT_TTL);
    }

    const result: HttpResult<T> = {
      data: parsedBody as T,
      error: null,
      status: response.status,
      response,
      headers: headersToObject(response.headers),
      request: req,
    };

    // ── After-interceptors (success branch) ───────────────────────────────────
    let finalResult = result as HttpResult<unknown>;
    for (const interceptor of this.afterInterceptors) {
      const modified = await interceptor(finalResult);
      if (modified) finalResult = modified;
    }

    this.emit("response", { request: sanitiseRequestForEvent(req), response: finalResult });
    return finalResult as HttpResult<T>;
  }

  private async errorResult<T>(
    err: HttpError,
    options: RequestOptions,
    req: OutgoingRequest,
  ): Promise<HttpResult<T>> {
    let result: HttpResult<T> = {
      data: null,
      error: err,
      status: err.status,
      response: err.response,
      headers: err.response ? headersToObject(err.response.headers) : null,
      request: req,
    };

    // ── After-interceptors (error branch) — allows global error transformation ─
    let finalResult = result as HttpResult<unknown>;
    for (const interceptor of this.afterInterceptors) {
      const modified = await interceptor(finalResult);
      if (modified) finalResult = modified;
    }

    result = finalResult as HttpResult<T>;

    this.emit("error", { request: sanitiseRequestForEvent(req), response: finalResult });

    if (options.throw) throw err;

    return result;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private shouldRetry(err: HttpError, config: HttpRetryConfig): boolean {
    if (err.isNetwork) return true;
    if (err.status === null) return false;
    const retryOn = config.retryOn ?? DEFAULT_RETRY_ON;
    return retryOn.includes(err.status);
  }

  private resolveCacheConfig(options: RequestOptions): ResolvedCache | null {
    const opt = options.cache;
    const global = this.config.cache;

    if (opt === false) return null;

    if (opt && typeof opt === "object") {
      const driver = opt.driver ?? (typeof global === "object" ? global.driver : null);
      if (!driver) return null;
      return { ...opt, driver } as ResolvedCache;
    }

    if (opt === true || opt === undefined) {
      if (!global) return null;
      if (typeof global === "object") return global as ResolvedCache;
    }

    return null;
  }

  private resolveRetryConfig(options: RequestOptions): HttpRetryConfig | null {
    const opt = options.retry;
    const global = this.config.retry;

    if (opt === false) return null;
    if (opt === true || opt === undefined) return global ?? null;
    if (typeof opt === "object") {
      return { attempts: 3, delay: 300, ...global, ...opt };
    }
    return null;
  }
}

// ─── Internal types ──────────────────────────────────────────────────────────

type ResolvedCache = HttpCacheConfig & { driver: CacheDriver };

// ─── Utility: merge two AbortSignals ─────────────────────────────────────────
// Each handler removes the other listener when it fires, preventing leaks when
// only one signal ever aborts (e.g. timeout fires but cancel never does).

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();

  if (a.aborted || b.aborted) {
    controller.abort();
    return controller.signal;
  }

  const abortFromA = (): void => { controller.abort(); b.removeEventListener("abort", abortFromB); };
  const abortFromB = (): void => { controller.abort(); a.removeEventListener("abort", abortFromA); };

  a.addEventListener("abort", abortFromA, { once: true });
  b.addEventListener("abort", abortFromB, { once: true });

  return controller.signal;
}
