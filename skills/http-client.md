# Http class

```ts
class Http {
  constructor(config?: HttpConfig)

  // Request methods — all return CancellablePromise<HttpResult<T>>
  get<T>(path: string, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  post<T>(path: string, data?: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  put<T>(path: string, data?: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  patch<T>(path: string, data?: HttpData, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  delete<T>(path: string, options?: RequestOptions): CancellablePromise<HttpResult<T>>
  head(path: string, options?: RequestOptions): CancellablePromise<HttpResult<null>>

  // Configuration
  extend(overrides: HttpConfig): Http        // returns new Http with merged config
  getConfig(): Readonly<HttpConfig>

  // Interceptors
  before(fn: BeforeInterceptor): this
  after<T>(fn: AfterInterceptor<T>): this

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
  data?: unknown                                          // body for DELETE-with-body
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
