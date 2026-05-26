import concatRoute from "@mongez/concat-route";
import type { Http } from "./Http";
import type { HttpData, HttpParams, HttpResult, RequestOptions } from "./Http.types";
import type { CancellablePromise } from "./cancellable";
import { getCurrentHttp } from "./current-http";
import type { ResourceService } from "./Resource.types";

/**
 * RESTful resource helper built on top of Http.
 *
 * Extend this class and set `route` to get fully-typed CRUD methods:
 *
 * @example
 * class UsersResource extends Resource {
 *   route = '/users';
 * }
 *
 * const users = new UsersResource();
 * const { data, error } = await users.list({ page: 1 });
 */
export class Resource implements ResourceService {
  /**
   * Base route for this resource, e.g. "/users".
   * All methods build URLs relative to this route.
   */
  public route = "";

  /**
   * Default query params merged into every `list()` call.
   * Override per-instance or in a subclass.
   */
  public defaultListParams: HttpParams = {};

  /**
   * Lazy reference to the Http instance.
   * Resolved on first use via getCurrentHttp() so that setCurrentHttp()
   * does not have to be called before the class is instantiated.
   */
  private _http: Http | null = null;

  protected get http(): Http {
    if (!this._http) {
      this._http = getCurrentHttp();
    }
    return this._http;
  }

  /**
   * Override the Http instance used by this specific resource.
   * Useful for resources that talk to a different API base URL.
   */
  useHttp(instance: Http): this {
    this._http = instance;
    return this;
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  list<T = unknown>(
    params?: HttpParams,
    options?: RequestOptions,
  ): CancellablePromise<HttpResult<T>> {
    const mergedParams = { ...this.defaultListParams, ...params };
    return this.http.get<T>(this.route, { ...options, params: mergedParams });
  }

  get<T = unknown>(
    id: number | string,
    options?: RequestOptions,
  ): CancellablePromise<HttpResult<T>> {
    return this.http.get<T>(this.path(id), options);
  }

  create<T = unknown>(
    data: HttpData,
    options?: RequestOptions,
  ): CancellablePromise<HttpResult<T>> {
    return this.http.post<T>(this.route, data, options);
  }

  update<T = unknown>(
    id: number | string,
    data: HttpData,
    options?: RequestOptions,
  ): CancellablePromise<HttpResult<T>> {
    return this.http.put<T>(this.path(id), data, options);
  }

  patch<T = unknown>(
    id: number | string,
    data: HttpData,
    options?: RequestOptions,
  ): CancellablePromise<HttpResult<T>> {
    return this.http.patch<T>(this.path(id), data, options);
  }

  delete<T = unknown>(
    id: number | string,
    options?: RequestOptions,
  ): CancellablePromise<HttpResult<T>> {
    return this.http.delete<T>(this.path(id), options);
  }

  bulkDelete<T = unknown>(
    data: HttpData,
    options?: RequestOptions,
  ): CancellablePromise<HttpResult<T>> {
    return this.http.delete<T>(this.route, { ...options, data });
  }

  /**
   * Toggle the published state of a record.
   *
   * Sends a PATCH to `/<route>/<id>` with `{ [publishKey]: published }`.
   * If `published` is already an object, it is sent as-is.
   *
   * Uses `this.http.patch` directly — no double-route bug.
   */
  publish<T = unknown>(
    id: number | string,
    published: boolean | HttpData,
    publishKey?: string,
    options?: RequestOptions,
  ): CancellablePromise<HttpResult<T>> {
    const key = publishKey ?? this.http.getConfig().publishKey ?? "published";
    const body = typeof published === "object" ? published : { [key]: published };
    return this.http.patch<T>(this.path(id), body, options);
  }

  // ─── Utilities ───────────────────────────────────────────────────────────────

  /**
   * Build a path relative to the base route.
   *
   * @example
   * this.path(42)          // "/users/42"
   * this.path('profile')   // "/users/profile"
   * this.path()            // "/users"
   */
  path(suffix: string | number = ""): string {
    return concatRoute(this.route, String(suffix));
  }
}
