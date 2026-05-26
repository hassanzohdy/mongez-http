# @mongez/http — Overview

**Version:** 3.x | **Runtime deps:** `@mongez/concat-route` only | **No Axios**

A robust, native-`fetch` HTTP client for TypeScript with:

- **`{data, error}` result pattern** — no try/catch needed by default
- **Per-request cancellation** via `.cancel()` on every returned promise
- **Typed errors** via `HttpError` with `.isAborted`, `.isTimeout`, `.isNetwork`, status predicates
- **Caching** for GET requests (any `CacheDriver`-compatible store)
- **Retry** with configurable backoff
- **Before/after interceptors** and lifecycle events
- **`Resource` class** — zero-boilerplate RESTful CRUD helper

## Exports

| Name | Kind |
|------|------|
| `Http` | class |
| `HttpError` | class |
| `Resource` | class |
| `setCurrentHttp` | function |
| `getCurrentHttp` | function |
| `makeCancellable` | function |
| `CancellablePromise` | type |
| `HttpResult<T>` | type |
| `HttpConfig` | interface |
| `RequestOptions` | interface |
| `CacheDriver` | interface |
| `ResourceService` | interface |

## Bootstrap

```ts
import { Http, setCurrentHttp } from '@mongez/http';

export const http = new Http({
  baseURL: import.meta.env.VITE_API_URL,
  auth: () => localStorage.getItem('token') ? `Bearer ${localStorage.getItem('token')}` : null,
});

setCurrentHttp(http); // enables Resource classes to resolve the instance lazily
```
