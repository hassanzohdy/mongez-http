import type { HttpData, HttpMethod, HttpParams, HttpResult, RequestOptions } from "./Http.types";
import type { CancellablePromise } from "./cancellable";

export interface ResourceService {
  /** Base route, e.g. "/users". */
  route: string;

  /** Retrieve a paginated / filtered list. */
  list(params?: HttpParams, options?: RequestOptions): CancellablePromise<HttpResult<unknown>>;

  /** Get a single record by id. */
  get(id: number | string, options?: RequestOptions): CancellablePromise<HttpResult<unknown>>;

  /** Create a new record. */
  create(data: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<unknown>>;

  /** Replace an existing record (PUT). */
  update(id: number | string, data: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<unknown>>;

  /** Partial update (PATCH). Pass body via options.data. */
  patch(id: number | string, options?: RequestOptions): CancellablePromise<HttpResult<unknown>>;

  /** Delete a record. */
  delete(id: number | string, options?: RequestOptions): CancellablePromise<HttpResult<unknown>>;

  /** Bulk delete — sends ids/data in the request body. */
  bulkDelete(data: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<unknown>>;

  /** Toggle the publish state of a record. */
  publish(
    id: number | string,
    published: boolean | HttpData,
    publishKey?: string,
    options?: RequestOptions,
  ): CancellablePromise<HttpResult<unknown>>;

  /** Send a non-CRUD action on a specific record. Default method: POST. */
  action<T = unknown>(
    id: number | string,
    actionName: string,
    data?: HttpData,
    options?: RequestOptions,
    method?: HttpMethod,
  ): CancellablePromise<HttpResult<unknown>>;

  /** Build a full path relative to the base route. */
  path(suffix?: string | number): string;

  /** Build a full path for a named action on a record. */
  actionPath(id: string | number, actionName: string): string;
}
