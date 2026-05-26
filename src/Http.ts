import type {
  AfterInterceptor,
  AfterInterceptorContext,
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
import { parseBody, prepareBody, readBodyWithProgress, wrapBodyWithProgress } from "./utils/body";

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

/**
 * Parse a full SSE event block (lines between two blank lines) into its
 * component fields: id, event, data (multi-line joined), and retry directive.
 * Returns `data: undefined` when the block should be skipped (comment-only or
 * no data lines).
 */
function parseSseBlock<T>(
  block: string,
  customParser?: (line: string) => unknown,
): { data?: T; id?: string; event?: string; retry?: number } {
  const lines = block.split("\n");
  const dataLines: string[] = [];
  let id: string | undefined;
  let event: string | undefined;
  let retry: number | undefined;

  for (const line of lines) {
    if (line.startsWith("id:")) {
      id = line.slice(3).trimStart();
    } else if (line.startsWith("event:")) {
      event = line.slice(6).trimStart();
    } else if (line.startsWith("retry:")) {
      const n = parseInt(line.slice(6).trimStart(), 10);
      if (!isNaN(n)) retry = n;
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
    // Lines starting with ":" are SSE comments — silently ignored.
  }

  if (dataLines.length === 0) return { id, event, retry };

  const dataStr = dataLines.join("\n");
  if (!dataStr || dataStr === "[DONE]") return { id, event, retry };

  if (customParser) {
    const parsed = customParser(dataStr);
    return { data: parsed as T | undefined, id, event, retry };
  }

  try {
    return { data: JSON.parse(dataStr) as T, id, event, retry };
  } catch {
    return { data: dataStr as unknown as T, id, event, retry };
  }
}

/**
 * Parse a single NDJSON line. Returns undefined to signal "skip this line".
 */
function parseNdjsonLine<T>(
  line: string,
  customParser?: (line: string) => unknown,
): T | undefined {
  if (customParser) return customParser(line) as T | undefined;

  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return trimmed as unknown as T;
  }
}

const DEFAULT_RETRY_ON = [429, 500, 502, 503, 504];
const DEFAULT_TTL = 300; // 5 minutes
const DEFAULT_RECONNECT_DELAY = 3000; // ms

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCacheKey(url: string, params?: HttpParams): string {
  const qs = params ? JSON.stringify(params) : "";
  return `http:${url}${qs ? `:${qs}` : ""}`;
}

// ─── Internal context for replay support ─────────────────────────────────────

interface ReplayCtx {
  method: HttpMethod | string;
  path: string;
  data: HttpData | undefined;
  options: RequestOptions;
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
   */
  request<T = unknown>(
    method: HttpMethod | string,
    path: string,
    data?: HttpData,
    options: RequestOptions = {},
  ): CancellablePromise<HttpResult<T>> {
    if (method === "GET") {
      // Merge default params for dedup key so it matches what buildOutgoingRequest produces.
      const mergedParams = this.config.params
        ? { ...this.config.params, ...options.params }
        : options.params;
      const dedupeKey = appendParams(
        joinUrl(this.config.baseURL ?? "", path),
        mergedParams,
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
   * For SSE, automatically reconnects on disconnect and sends `Last-Event-ID`
   * so the server can resume. Use `.cancel()` to abort from outside the loop.
   *
   * The stream **never throws** — errors are stored in `.error` instead.
   * Check `stream.error` after the `for await` loop.
   *
   * @example
   * const stream = http.stream<ChatChunk>('/chat', { method: 'POST', data: { messages } });
   * for await (const chunk of stream) {
   *   setContent(c => c + chunk.content);
   * }
   * if (stream.error) showError(stream.error.message);
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
    const shouldReconnect = options.reconnect ?? false;
    const maxAttempts = options.maxReconnectAttempts ?? Infinity;
    const baseReconnectDelay = options.reconnectDelay ?? DEFAULT_RECONNECT_DELAY;
    const self = this;

    // Shared state written by the generator, read by the iterable's .error getter.
    const state: { error: HttpError | null } = { error: null };

    // SSE reconnection state — persists across reconnects.
    let lastEventId: string | undefined;
    let serverRetryDelay: number | undefined; // set by the server's `retry:` directive

    async function* generator(): AsyncGenerator<T> {
      let reconnectAttempt = 0;

      while (true) {
        if (controller.signal.aborted) return;

        // ── Build request (fresh each attempt — re-applies auth + Last-Event-ID) ──
        const extraHeaders: Record<string, string> = {};
        if (!options.headers?.["Accept"]) {
          extraHeaders["Accept"] = "text/event-stream, application/x-ndjson, */*";
        }
        if (lastEventId !== undefined) {
          extraHeaders["Last-Event-ID"] = lastEventId;
        }

        const req = await self.buildOutgoingRequest(
          options.method ?? "GET",
          path,
          options.data as HttpData | undefined,
          options,
          extraHeaders,
        );

        self.emit("request", { request: sanitiseRequestForEvent(req) });

        // ── Fetch ──────────────────────────────────────────────────────────────
        let response: Response;
        try {
          response = await fetch(req.url, {
            method: req.method,
            headers: req.headers,
            body: req.body,
            signal: controller.signal,
            credentials: options.credentials ?? self.config.credentials,
            mode: options.mode ?? self.config.mode,
            redirect: options.redirect ?? self.config.redirect,
          });
        } catch {
          if (controller.signal.aborted) return; // cancelled — end silently

          const err = new HttpError({
            message: "Stream network error",
            isNetwork: true,
            request: req,
          });
          self.emit("error", { request: sanitiseRequestForEvent(req) });

          if (!shouldReconnect || reconnectAttempt >= maxAttempts) {
            state.error = err;
            return;
          }

          reconnectAttempt++;
          await sleep(serverRetryDelay ?? baseReconnectDelay);
          continue;
        }

        if (!response.ok) {
          const errorBody = await parseBody(response).catch(() => null);
          const err = new HttpError({
            message: `HTTP ${response.status} ${response.statusText}`,
            status: response.status,
            body: errorBody,
            response,
            headers: headersToObject(response.headers),
            request: req,
          });
          self.emit("error", { request: sanitiseRequestForEvent(req) });
          // Do NOT reconnect on HTTP errors — they indicate a server-side problem
          // (wrong path, auth failure, etc.) that retrying won't fix.
          state.error = err;
          return;
        }

        // ── Read and parse the stream ──────────────────────────────────────────
        const reader = response.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = "";
        let readError = false;

        try {
          while (true) {
            let readResult: ReadableStreamReadResult<Uint8Array>;
            try {
              readResult = await reader.read();
            } catch {
              if (controller.signal.aborted) return;
              readError = true;
              break;
            }

            const { done, value } = readResult;
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            if (format === "sse") {
              // SSE events are delimited by double-newlines.
              let boundary: number;
              while ((boundary = buffer.indexOf("\n\n")) !== -1) {
                const block = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);

                const parsed = parseSseBlock<T>(
                  block,
                  options.parseLine as ((l: string) => unknown) | undefined,
                );
                if (parsed.retry !== undefined) serverRetryDelay = parsed.retry;
                if (parsed.id !== undefined) lastEventId = parsed.id;
                if (parsed.data !== undefined) {
                  yield parsed.data;
                }
              }
            } else {
              // NDJSON: one JSON value per line.
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                const parsed = parseNdjsonLine<T>(
                  line,
                  options.parseLine as ((l: string) => unknown) | undefined,
                );
                if (parsed !== undefined) {
                  yield parsed;
                }
              }
            }
          }

          // Flush any remaining buffered content after the stream ends.
          if (buffer.trim()) {
            if (format === "sse") {
              const parsed = parseSseBlock<T>(
                buffer,
                options.parseLine as ((l: string) => unknown) | undefined,
              );
              if (parsed.retry !== undefined) serverRetryDelay = parsed.retry;
              if (parsed.id !== undefined) lastEventId = parsed.id;
              if (parsed.data !== undefined) yield parsed.data;
            } else {
              const parsed = parseNdjsonLine<T>(
                buffer,
                options.parseLine as ((l: string) => unknown) | undefined,
              );
              if (parsed !== undefined) yield parsed;
            }
          }
        } finally {
          reader.releaseLock();
        }

        // ── Handle reconnect logic ─────────────────────────────────────────────
        if (readError) {
          if (!shouldReconnect || reconnectAttempt >= maxAttempts) {
            state.error = new HttpError({
              message: "Stream read error",
              isNetwork: true,
              request: req,
            });
            return;
          }
          reconnectAttempt++;
          await sleep(serverRetryDelay ?? baseReconnectDelay);
          continue; // outer while — reconnect
        }

        // Normal stream end.
        if (!shouldReconnect) return;

        // SSE auto-reconnect after normal end.
        reconnectAttempt++;
        if (reconnectAttempt > maxAttempts) return;
        await sleep(serverRetryDelay ?? baseReconnectDelay);
        // fall through to top of outer while → reconnect
      }
    }

    const gen = generator();

    return {
      [Symbol.asyncIterator](): AsyncIterator<T> { return gen; },
      cancel(reason?: string): void { controller.abort(reason ?? "cancelled"); },
      get signal(): AbortSignal { return controller.signal; },
      get error(): HttpError | null { return state.error; },
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

    // Merge default config params with per-request params (request wins on conflict).
    const mergedParams = this.config.params
      ? { ...this.config.params, ...options.params }
      : options.params;
    const fullPath = appendParams(joinUrl(baseURL, path), mergedParams);

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
    isReplay = false,
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

    // Stash the original (pre-putToPost) parameters for replay().
    const replayCtx: ReplayCtx = { method, path, data, options };

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
    this.emit("request", { request: sanitiseRequestForEvent(req) });

    // ── Retry wrapper ─────────────────────────────────────────────────────────
    const retryConfig = this.resolveRetryConfig(options);
    return this.executeWithRetry<T>(req, signal, options, cacheConfig, retryConfig, cacheKey, replayCtx, isReplay);
  }

  private async executeWithRetry<T>(
    req: OutgoingRequest,
    signal: AbortSignal,
    options: RequestOptions,
    cacheConfig: ResolvedCache | null,
    retryConfig: HttpRetryConfig | null,
    cacheKey: string | undefined,
    replayCtx: ReplayCtx,
    isReplay: boolean,
    attempt = 0,
  ): Promise<HttpResult<T>> {
    try {
      return await this.executeSingle<T>(req, signal, options, cacheConfig, cacheKey, replayCtx, isReplay);
    } catch (err) {
      // Guard: only handle HttpErrors — rethrow anything else (e.g. interceptor bugs).
      if (!(err instanceof HttpError)) throw err;

      // Never retry aborts or timeouts.
      if (err.isAborted || err.isTimeout) {
        return this.errorResult<T>(err, options, req, replayCtx, isReplay);
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

        // Fire the onRetry callback if configured.
        if (retryConfig.onRetry) {
          retryConfig.onRetry(attempt + 1, err, delay);
        }

        await sleep(delay);
        return this.executeWithRetry<T>(req, signal, options, cacheConfig, retryConfig, cacheKey, replayCtx, isReplay, attempt + 1);
      }

      return this.errorResult<T>(err, options, req, replayCtx, isReplay);
    }
  }

  private async executeSingle<T>(
    req: OutgoingRequest,
    signal: AbortSignal,
    options: RequestOptions,
    cacheConfig: ResolvedCache | null,
    cacheKey: string | undefined,
    replayCtx: ReplayCtx,
    isReplay: boolean,
  ): Promise<HttpResult<T>> {
    // Fast path: if the signal was already aborted before the microtask queue
    // delivered execute() — e.g. cancel() was called synchronously right after
    // creating the request — throw immediately without touching fetch.
    // AbortSignal does NOT fire "abort" listeners retroactively, so waiting for
    // the event inside the fetch mock (or real fetch) would hang forever.
    if (signal.aborted) {
      throw new HttpError({ message: "Request was cancelled", isAborted: true, request: req });
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

    // ── Upload progress wrapping ───────────────────────────────────────────────
    let fetchBody = req.body;
    const extraInit: Record<string, unknown> = {};

    if (options.onUploadProgress && req.body !== undefined) {
      const wrapped = wrapBodyWithProgress(req.body, options.onUploadProgress);
      fetchBody = wrapped.body;
      if (wrapped.duplex) extraInit.duplex = wrapped.duplex;
    }

    let response: Response;
    try {
      response = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: fetchBody,
        signal: effectiveSignal,
        credentials: options.credentials ?? this.config.credentials,
        mode: options.mode ?? this.config.mode,
        keepalive: options.keepalive ?? this.config.keepalive,
        redirect: options.redirect ?? this.config.redirect,
        ...extraInit,
      } as RequestInit);
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
        request: req,
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
        headers: headersToObject(response.headers),
        request: req,
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

    return this.runAfterInterceptors<T>(result, replayCtx, isReplay, req);
  }

  private async errorResult<T>(
    err: HttpError,
    options: RequestOptions,
    req: OutgoingRequest,
    replayCtx: ReplayCtx,
    isReplay: boolean,
  ): Promise<HttpResult<T>> {
    const errorRes: HttpResult<T> = {
      data: null,
      error: err,
      status: err.status,
      response: err.response,
      headers: err.response ? headersToObject(err.response.headers) : null,
      request: req,
    };

    const finalResult = await this.runAfterInterceptors<T>(errorRes, replayCtx, isReplay, req);

    if (options.throw) throw finalResult.error ?? err;

    return finalResult;
  }

  /**
   * Run all after-interceptors on `result`, providing each with a `replay()` context.
   *
   * `replay()` re-fires the original request from scratch (fresh auth, before-interceptors).
   * When `isReplay` is true, `replay()` is a no-op that returns the current result — this
   * prevents infinite loops when a token-refresh interceptor would otherwise call replay()
   * on the already-replayed request.
   */
  private async runAfterInterceptors<T>(
    result: HttpResult<T>,
    replayCtx: ReplayCtx,
    isReplay: boolean,
    req: OutgoingRequest,
  ): Promise<HttpResult<T>> {
    let finalResult = result as HttpResult<unknown>;

    for (const interceptor of this.afterInterceptors) {
      const context: AfterInterceptorContext<unknown> = {
        replay: isReplay
          ? async (): Promise<HttpResult<unknown>> => finalResult
          : (): Promise<HttpResult<unknown>> => this.execute<unknown>(
              replayCtx.method as HttpMethod,
              replayCtx.path,
              replayCtx.data,
              replayCtx.options,
              new AbortController().signal,
              true, // isReplay = true — prevents recursive replays
            ),
      };

      const modified = await interceptor(finalResult, context);
      if (modified) finalResult = modified;
    }

    if (finalResult.error === null) {
      this.emit("response", { request: sanitiseRequestForEvent(req), response: finalResult });
    } else {
      this.emit("error", { request: sanitiseRequestForEvent(req), response: finalResult });
    }

    return finalResult as HttpResult<T>;
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
