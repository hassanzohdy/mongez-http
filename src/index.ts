// ─── Core ─────────────────────────────────────────────────────────────────────
export { Http } from "./Http";
export { HttpError } from "./HttpError";
export { Resource } from "./Resource";

// ─── Default instance ─────────────────────────────────────────────────────────
/**
 * A ready-to-use Http instance with no base URL.
 * Ideal for one-off full-URL requests without creating a custom instance.
 *
 * @example
 * import { http } from '@mongez/http';
 * const { data } = await http.get('https://api.example.com/users');
 */
export { default as http } from "./default-http";

// ─── Current instance ─────────────────────────────────────────────────────────
export { getCurrentHttp, setCurrentHttp } from "./current-http";

// ─── Cancellable promise / iterable ──────────────────────────────────────────
export type { CancellableAsyncIterable, CancellablePromise } from "./cancellable";
export { makeCancellable } from "./cancellable";

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  AfterInterceptor,
  AfterInterceptorContext,
  BeforeInterceptor,
  CacheDriver,
  DownloadProgressEvent,
  HttpCacheConfig,
  HttpConfig,
  HttpData,
  HttpEvent,
  HttpEventHandler,
  HttpEventPayload,
  HttpMethod,
  HttpParams,
  HttpResult,
  HttpRetryConfig,
  OutgoingRequest,
  RequestOptions,
  ResponseType,
  SseEvent,
  StreamFormat,
  StreamRequestOptions,
  UploadProgressEvent,
} from "./Http.types";

export type { ResourceService } from "./Resource.types";
