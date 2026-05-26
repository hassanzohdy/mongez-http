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
} from "./Http.types";
import { HttpError } from "./HttpError";
import { type CancellablePromise, makeCancellable } from "./cancellable";
import { appendParams } from "./utils/params";
import { parseBody, prepareBody } from "./utils/body";
// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Join a base URL (may include protocol + host) with a path segment.
 * Unlike concatRoute, this preserves the protocol scheme.
 *
 * Examples:
 *   joinUrl('https://api.example.com', '/users')  → 'https://api.example.com/users'
 *   joinUrl('https://api.example.com/', '/users') → 'https://api.example.com/users'
 *   joinUrl('', '/users')                         → '/users'
 */
function joinUrl(base: string, path: string): string {
  if (!base) return path;
  return base.replace(/\/$/, "") + "/" + path.replace(/^\//, "");
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

// ─── Http ─────────────────────────────────────────────────────────────────────

export class Http {
  private readonly config: HttpConfig;
  private readonly beforeInterceptors: BeforeInterceptor[] = [];
  private readonly afterInterceptors: AfterInterceptor[] = [];
  private readonly eventHandlers: Map<string, HttpEventHandler[]> = new Map();

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

  get<T = unknown>(
    path: string,
    options?: RequestOptions,
  ): CancellablePromise<HttpResult<T>> {
    return this.request<T>("GET", path, undefined, options);
  }

  post<T = unknown>(
    path: string,
    data?: HttpData,
    options?: RequestOptions,
  ): CancellablePromise<HttpResult<T>> {
    return this.request<T>("POST", path, data, options);
  }

  put<T = unknown>(
    path: string,
    data?: HttpData,
    options?: RequestOptions,
  ): CancellablePromise<HttpResult<T>> {
    return this.request<T>("PUT", path, data, options);
  }

  patch<T = unknown>(
    path: string,
    data?: HttpData,
    options?: RequestOptions,
  ): CancellablePromise<HttpResult<T>> {
    return this.request<T>("PATCH", path, data, options);
  }

  delete<T = unknown>(
    path: string,
    options?: RequestOptions,
  ): CancellablePromise<HttpResult<T>> {
    return this.request<T>("DELETE", path, options?.data as HttpData | undefined, options);
  }

  head(path: string, options?: RequestOptions): CancellablePromise<HttpResult<null>> {
    return this.request<null>("HEAD", path, undefined, options);
  }

  // ─── Core request ───────────────────────────────────────────────────────────

  private request<T>(
    method: HttpMethod,
    path: string,
    data?: HttpData,
    options: RequestOptions = {},
  ): CancellablePromise<HttpResult<T>> {
    return makeCancellable(
      (signal) => this.execute<T>(method, path, data, options, signal),
      options.signal,
    );
  }

  private async execute<T>(
    method: HttpMethod,
    path: string,
    data: HttpData | undefined,
    options: RequestOptions,
    signal: AbortSignal,
  ): Promise<HttpResult<T>> {
    // ── putToPost conversion ──────────────────────────────────────────────────
    let actualMethod = method;
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

    // ── Build URL ─────────────────────────────────────────────────────────────
    const baseURL = this.config.baseURL ?? "";
    const fullPath = appendParams(
      joinUrl(baseURL, path),
      options.params,
    );

    // ── Build headers ─────────────────────────────────────────────────────────
    const { body, contentType } = prepareBody(actualData);

    const headers: Record<string, string> = {
      ...(this.config.headers ?? {}),
      ...(options.headers ?? {}),
    };

    if (contentType && !headers["Content-Type"]) {
      headers["Content-Type"] = contentType;
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    const outgoing: OutgoingRequest = {
      method: actualMethod,
      url: fullPath,
      headers,
      body,
    };

    const authValue =
      typeof this.config.auth === "function"
        ? this.config.auth(outgoing)
        : this.config.auth;

    if (authValue) {
      headers["Authorization"] = authValue;
    }

    // ── Run before-interceptors ───────────────────────────────────────────────
    let req = outgoing;
    for (const interceptor of this.beforeInterceptors) {
      const modified = await interceptor(req);
      if (modified) req = modified;
    }

    this.emit("request", { request: req });

    // ── Cache check (GET only) ────────────────────────────────────────────────
    const cacheConfig = this.resolveCacheConfig(options);
    if (actualMethod === "GET" && cacheConfig) {
      const cacheKey =
        options.cacheKey ??
        (cacheConfig.generateKey
          ? cacheConfig.generateKey(req.url, options.params)
          : buildCacheKey(req.url, options.params));

      const cached = await cacheConfig.driver.get<T>(cacheKey);
      if (cached !== null && cached !== undefined) {
        const result: HttpResult<T> = {
          data: cached,
          error: null,
          status: 200,
          response: new Response(),
        };
        return result;
      }

      // Stash key for post-fetch storage.
      (options as RequestOptions & { _cacheKey?: string })._cacheKey = cacheKey;
    }

    // ── Retry wrapper ─────────────────────────────────────────────────────────
    const retryConfig = this.resolveRetryConfig(options);
    return this.executeWithRetry<T>(req, signal, options, cacheConfig, retryConfig);
  }

  private async executeWithRetry<T>(
    req: OutgoingRequest,
    signal: AbortSignal,
    options: RequestOptions,
    cacheConfig: ResolvedCache | null,
    retryConfig: HttpRetryConfig | null,
    attempt = 0,
  ): Promise<HttpResult<T>> {
    try {
      const result = await this.executeSingle<T>(req, signal, options, cacheConfig);
      return result;
    } catch (err) {
      const httpErr = err as HttpError;

      // Never retry aborts/timeouts.
      if (httpErr.isAborted || httpErr.isTimeout) {
        return this.errorResult<T>(httpErr, options);
      }

      if (
        retryConfig &&
        attempt < retryConfig.attempts &&
        this.shouldRetry(httpErr, retryConfig)
      ) {
        const delay =
          retryConfig.backoff !== false
            ? retryConfig.delay * Math.pow(2, attempt)
            : retryConfig.delay;

        await sleep(delay);
        return this.executeWithRetry<T>(req, signal, options, cacheConfig, retryConfig, attempt + 1);
      }

      return this.errorResult<T>(httpErr, options);
    }
  }

  private async executeSingle<T>(
    req: OutgoingRequest,
    signal: AbortSignal,
    options: RequestOptions,
    cacheConfig: ResolvedCache | null,
  ): Promise<HttpResult<T>> {
    // ── Timeout ───────────────────────────────────────────────────────────────
    const timeout = options.timeout ?? this.config.timeout;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timeoutController: AbortController | undefined;

    if (timeout !== undefined) {
      timeoutController = new AbortController();
      timeoutId = setTimeout(() => timeoutController!.abort("timeout"), timeout);
    }

    // Merge signals: external abort + timeout
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

      const abortSignal = timeoutController?.signal.aborted ? "timeout" : "abort";
      const isTimeout = abortSignal === "timeout" || (err instanceof Error && err.message === "timeout");
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
    const parsedBody = await parseBody(response);

    if (!response.ok) {
      throw new HttpError({
        message: `HTTP ${response.status} ${response.statusText}`,
        status: response.status,
        body: parsedBody,
        response,
      });
    }

    // ── Store in cache ────────────────────────────────────────────────────────
    const cacheKey = (options as RequestOptions & { _cacheKey?: string })._cacheKey;
    if (cacheConfig && cacheKey) {
      const ttl = cacheConfig.ttl ?? DEFAULT_TTL;
      await cacheConfig.driver.set(cacheKey, parsedBody as T, ttl);
    }

    const result: HttpResult<T> = {
      data: parsedBody as T,
      error: null,
      status: response.status,
      response,
    };

    // ── Run after-interceptors ────────────────────────────────────────────────
    let finalResult = result as HttpResult<unknown>;
    for (const interceptor of this.afterInterceptors) {
      const modified = await interceptor(finalResult);
      if (modified) finalResult = modified;
    }

    this.emit("response", { request: req, response: finalResult });
    return finalResult as HttpResult<T>;
  }

  private errorResult<T>(
    err: HttpError,
    options: RequestOptions,
  ): HttpResult<T> {
    this.emit("error", { request: {} as OutgoingRequest, response: undefined });

    if (options.throw) throw err;

    return {
      data: null,
      error: err,
      status: err.status,
      response: err.response,
    };
  }

  // ─── Retry helpers ───────────────────────────────────────────────────────────

  private shouldRetry(err: HttpError, config: HttpRetryConfig): boolean {
    if (err.isNetwork) return true;
    if (err.status === null) return false;
    const retryOn = config.retryOn ?? DEFAULT_RETRY_ON;
    return retryOn.includes(err.status);
  }

  // ─── Cache resolution ────────────────────────────────────────────────────────

  private resolveCacheConfig(options: RequestOptions): ResolvedCache | null {
    const opt = options.cache;
    const global = this.config.cache;

    // Explicitly disabled for this request.
    if (opt === false) return null;

    // Per-request driver override.
    if (opt && typeof opt === "object") {
      const driver = opt.driver ?? (typeof global === "object" ? global.driver : null);
      if (!driver) return null;
      return { ...opt, driver } as ResolvedCache;
    }

    // Inherit global.
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

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();

  const abort = () => controller.abort();

  if (a.aborted || b.aborted) {
    controller.abort();
    return controller.signal;
  }

  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });

  return controller.signal;
}
