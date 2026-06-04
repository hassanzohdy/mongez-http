---
name: mongez-http-client
description: |
  @mongez/http `Http` class — making HTTP/API requests and **replacing axios/fetch** with `get`, `post`, `put`, `patch`, `delete`, `head`, `options`, `request`, concurrent `all`/`race`, `invalidate`/`invalidateAll`, `extend`. Covers **typing responses with a generic** (`http.get<User>()` — the default is `unknown`, so `data.first_name` won't type-check without it) and narrowing the `{ data, error }` discriminated union. Per-request `.cancel()` and external `AbortSignal`. Full `HttpConfig` (`baseURL`, `auth`, `timeout`, `putToPost`, `serializer`, `fetchCache`, `dedupeKey`) and `RequestOptions` (`params`, `signal`, `responseType`, `data`, `throw`).
---

# Http class

## How to get an `Http` to call

`@mongez/http` exports a **pre-built `http` singleton** — use it directly. Do not construct a new `Http` per call.

```ts
// ✅ Ad-hoc / library code — import the pre-built singleton
import { http } from '@mongez/http';
const { data, error } = await http.get<User[]>('https://api.example.com/users');

// ✅ App bootstrap — create ONE configured instance, export it, reuse it everywhere
// src/lib/http.ts
import { Http, setCurrentHttp } from '@mongez/http';
export const http = new Http({ baseURL: '...', auth: getToken });
setCurrentHttp(http);   // lets Resource classes lazily pick it up
// → other files: import { http } from './lib/http';

// ✅ Need a tweak? Extend the existing instance — don't `new Http()` again
const adminHttp = http.extend({ baseURL: 'https://admin.api.com' });
```

> ❌ **Anti-pattern — do not write this:**
> ```ts
> import { Http } from '@mongez/http';
> const { data } = await new Http().get(url);   // wasteful per-call instance, ignores config
> ```
> `new Http()` with no config is functionally identical to the `http` singleton. Just `import { http } from '@mongez/http'` instead.

## Type the response — always pass a generic

Every request method is generic with a default of `unknown`:
`get<T = unknown>(path, options?): CancellablePromise<HttpResult<T>>`. If you
**omit the type**, `data` is `unknown` and TypeScript rejects any property
access — `data.first_name` won't compile. **Always pass the expected response
type** (this is the single most common mistake when migrating from `axios`/`fetch`):

```ts
const { data } = await http.get<User>('/users/1');     // data: User | null
const { data: users } = await http.get<User[]>('/users'); // data: User[] | null
const { data: user } = await http.post<User>('/users', { name: 'Alice' });
```

`HttpResult<T>` is a **discriminated union** — `{ data: T; error: null }` on
success, `{ data: null; error: HttpError }` on failure. Narrow on `error` first
so `data` becomes the non-null `T`:

```ts
const { data, error } = await http.get<User>('/users/1');
if (error) return;            // data is null on this branch
console.log(data.first_name); // data is User here — type-checks
```

Reach for the generic, not an `as User` cast or `any` — it types the result end
to end (and flows through `all`/`race` and `Resource` too).

## Common patterns

```ts
import { http } from '@mongez/http';   // or your project's own bootstrap export

// 90% of usage — destructure {data, error}
const { data, error } = await http.get<User[]>('/users');
if (error) { /* handle */ return; }
console.log(data);

// POST with body
const { data: user } = await http.post<User>('/users', { name: 'Alice' });

// Load a file from a full URL
const { data: bytes } = await http.get<ArrayBuffer>(
  'https://example.com/image.png',
  { responseType: 'arrayBuffer' },
);

// Cancel from outside
const req = http.get('/slow');
req.cancel('component unmounted');

// External AbortSignal (React Query, useEffect, etc.)
const { signal } = new AbortController();
const { data } = await http.get('/users', { signal });
```

## Class signature

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

  // Streaming — see mongez-http-streaming skill
  stream<T>(path: string, options?: StreamRequestOptions): CancellableAsyncIterable<T>

  // Concurrent helpers (each returns a CancellablePromise — cancel cancels every inner request)
  all<T>(requests: CancellablePromise<T>[]): CancellablePromise<T[]>     // wait for all, never throws (per-request errors stay on each result)
  race<T>(requests: CancellablePromise<T>[]): CancellablePromise<T>      // first to settle wins; losers are cancelled

  // Cache management — see mongez-http-caching skill
  invalidate(key: string): Promise<void>   // remove a single cache entry by key
  invalidateAll(): Promise<void>           // clear all cache entries (requires driver.clear())

  // Configuration
  extend(overrides: HttpConfig): Http        // returns new Http with merged config
  getConfig(): Readonly<HttpConfig>

  // Interceptors — see mongez-http-interceptors skill
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
  params?: HttpParams          // default query params merged into every request
  cache?: boolean | HttpCacheConfig
  retry?: HttpRetryConfig
  publishKey?: string          // default "published" — used by Resource.publish()

  // Fetch-native options forwarded to every fetch() call (per-request overrides exist)
  credentials?: RequestCredentials   // "same-origin" | "include" | "omit"
  mode?: RequestMode                 // "cors" | "no-cors" | "same-origin" | "navigate"
  keepalive?: boolean                // default false — body capped at 64 KB
  redirect?: RequestRedirect         // "follow" | "error" | "manual"
  fetchCache?: RequestCache          // browser HTTP cache directive — distinct from `cache`

  // Custom body serializer (e.g. MessagePack/CBOR). FormData/Blob/string pass through.
  serializer?: (data: unknown) => { body: BodyInit; contentType: string }

  // Custom GET deduplication key — default keys by URL + serialised params.
  dedupeKey?: (url: string, params?: HttpParams) => string
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
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream' // "stream" → raw ReadableStream; body not read by library
  onDownloadProgress?: (event: DownloadProgressEvent) => void
  onUploadProgress?: (event: UploadProgressEvent) => void // string/ArrayBuffer bodies only — FormData not supported

  // Per-request overrides of the fetch-native HttpConfig fields
  credentials?: RequestCredentials
  mode?: RequestMode
  keepalive?: boolean
  redirect?: RequestRedirect
  fetchCache?: RequestCache
}
```

## React — cancel on unmount

```ts
function useUser(id: number) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const req = http.get<User>(`/users/${id}`);
    req.then(({ data, error }) => {
      if (error?.isAborted) return;     // ignore cancellations
      if (data) setUser(data);
    });
    return () => req.cancel('unmounted');
  }, [id]);

  return user;
}
```

## React Query integration

```ts
import { useQuery } from '@tanstack/react-query';

useQuery({
  queryKey: ['users', params],
  queryFn: ({ signal }) =>
    http.get('/users', { params, signal }).then(({ data, error }) => {
      if (error) throw error;       // React Query expects throws
      return data;
    }),
});
```

## Multi-tenant: different Http per resource

```ts
const publicHttp  = new Http({ baseURL: 'https://api.example.com/public' });
const privateHttp = new Http({ baseURL: 'https://api.example.com/v2', auth: getToken });

export const articlesResource = new ArticlesResource().useHttp(publicHttp);
export const ordersResource   = new OrdersResource().useHttp(privateHttp);
```

## putToPost (Laravel file uploads)

Useful for Laravel APIs that don't accept PUT/PATCH natively with file uploads:

```ts
const http = new Http({ baseURL, putToPost: true, putMethodKey: '_method' });
// PUT /users/1 { name } → POST /users/1 { name, _method: 'PUT' }

const fd = new FormData();
fd.append('avatar', file);
fd.append('name', 'Alice');
await http.put('/users/1', fd);   // sent as POST with _method=PUT
```
