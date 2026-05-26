// ─── Core ─────────────────────────────────────────────────────────────────────
export { Http } from "./Http";
export { HttpError } from "./HttpError";
export { Resource } from "./Resource";

// ─── Current instance ─────────────────────────────────────────────────────────
export { getCurrentHttp, setCurrentHttp } from "./current-http";

// ─── Cancellable promise / iterable ──────────────────────────────────────────
export type { CancellableAsyncIterable, CancellablePromise } from "./cancellable";
export { makeCancellable } from "./cancellable";

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  AfterInterceptor,
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
  StreamFormat,
  StreamRequestOptions,
} from "./Http.types";

export type { ResourceService } from "./Resource.types";
