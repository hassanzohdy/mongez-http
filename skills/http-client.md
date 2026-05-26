# Http class

```ts
class Http {
  constructor(config?: HttpConfig)

  // Request methods — all return CancellablePromise<HttpResult<T>>
  get<T>(path: string, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  post<T>(path: string, data?: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  put<T>(path: string, data?: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  patch<T>(path: string, options?: RequestOptions): CancellablePromise<HttpResult<T>>  // body via options.data
  delete<T>(path: string, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  head(path: string, options?: RequestOptions): CancellablePromise<HttpResult<null>>
  options<T>(path: string, options?: RequestOptions): CancellablePromise<HttpResult<T>>

  /**
   * Escape hatch for any HTTP method, including non-standard verbs.
   * All convenience methods delegate here.
   * GET requests are automatically deduplicated: concurrent calls with the same URL
   * share one underlying fetch. Each caller gets its own CancellablePromise.
   */
  request<T>(method: HttpMethod | string, path: string, data?: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<T>>

  // Cache management
  invalidate(key: string): Promise<void>   // remove a single cache entry by key
  invalidateAll(): Promise<void>           // clear all cache entries (requires driver.clear())

  // Configuration
  extend(overrides: HttpConfig): Http        // returns new Http with merged config
  getConfig(): Readonly<HttpConfig>

  // Interceptors
  before(fn: BeforeInterceptor): this
  after<T>(fn: AfterInterceptor<T>): this   // runs on both success AND error results

  // Events
  on(event: string, handler: HttpEventHandler): this
  off(event: string, handler: HttpEventHandler): this
}
```

## HttpConfig

```ts
interface HttpConfig {
  baseURL?: string
  auth?: string | ((req: OutgoingRequest) => string | null | undefined)
  putToPost?: boolean          // default false — convert PUT→POST for file uploads
  putMethodKey?: string        // default "_method"
  timeout?: number             // ms, no timeout by default
  headers?: Record<string, string>
  cache?: boolean | HttpCacheConfig
  retry?: HttpRetryConfig
  publishKey?: string          // default "published" — used by Resource.publish()
}
```

## RequestOptions

```ts
interface RequestOptions {
  params?: HttpParams                                      // query string
  headers?: Record<string, string>                        // merged with global
  signal?: AbortSignal                                    // external (React Query, useEffect)
  cache?: boolean | Omit<HttpCacheConfig,'driver'> & { driver?: CacheDriver }
  cacheKey?: string                                       // explicit cache key override
  retry?: boolean | Partial<HttpRetryConfig>
  throw?: boolean                                         // default false
  timeout?: number
  data?: unknown                                          // body for PATCH / DELETE and any method needing a body
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' // default: auto-detect from Content-Type
  onDownloadProgress?: (event: DownloadProgressEvent) => void
}
```

## Cancellation

```ts
const req = http.get<User[]>('/users');
req.cancel('component unmounted');

const { data, error } = await req;
// error.isAborted === true
```

External signal (React Query / useEffect):

```ts
const { signal } = new AbortController();
const { data } = await http.get('/users', { signal });
```

## putToPost

Useful for Laravel APIs that don't accept PUT/PATCH natively with file uploads:

```ts
const http = new Http({ baseURL, putToPost: true, putMethodKey: '_method' });
// PUT /users/1 { name } → POST /users/1 { name, _method: 'PUT' }
```
