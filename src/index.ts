// ─── Core ─────────────────────────────────────────────────────────────────────
export { Http } from "./Http";
export { HttpError } from "./HttpError";
export { Resource } from "./Resource";

// ─── Current instance ─────────────────────────────────────────────────────────
export { getCurrentHttp, setCurrentHttp } from "./current-http";

// ─── Cancellable promise ──────────────────────────────────────────────────────
export type { CancellablePromise } from "./cancellable";
export { makeCancellable } from "./cancellable";

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  AfterInterceptor,
  BeforeInterceptor,
  CacheDriver,
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
} from "./Http.types";

export type { ResourceService } from "./Resource.types";
