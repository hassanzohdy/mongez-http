---
name: mongez-http-overview
description: |
  @mongez/http — native-fetch TypeScript HTTP client: `{data,error}` result pattern, per-request cancellation, typed `HttpError`, GET dedup, caching, retry, interceptors, and `Resource` RESTful helper. No Axios. Single runtime dep (`@mongez/concat-route`).
  TRIGGER when: `Http`, `setCurrentHttp`, `getCurrentHttp`, `http`, `makeCancellable`, `CancellablePromise`, `HttpResult`, `HttpConfig`, `RequestOptions`, `CancellableAsyncIterable`, `ResourceService` imported from `@mongez/http`; user asks "set up mongez http" or "configure http client" or "what does @mongez/http export" or "install mongez http".
  SKIP: making specific requests — use `mongez-http-client`; error handling — use `mongez-http-error-handling`; streaming SSE/NDJSON — use `mongez-http-streaming`; Resource CRUD — use `mongez-http-resource`.
---

# @mongez/http — Overview

**Version:** 3.x | **Runtime deps:** `@mongez/concat-route` only | **No Axios**

A robust, native-`fetch` HTTP client for TypeScript with:

- **`{data, error}` result pattern** — no try/catch needed by default
- **Per-request cancellation** via `.cancel()` on every returned promise
- **Typed errors** via `HttpError` with `.isAborted`, `.isTimeout`, `.isNetwork`, status predicates
- **GET deduplication** — concurrent calls to the same URL share one fetch
- **Caching** for GET requests (any `CacheDriver`-compatible store)
- **Retry** with configurable backoff + optional jitter
- **Before/after interceptors** (after-interceptors run on both success AND error results) and lifecycle events
- **`Resource` class** — zero-boilerplate RESTful CRUD helper

## Exports

| Name | Kind |
|------|------|
| `Http` | class |
| `HttpError` | class |
| `Resource` | class |
| `http` | default Http instance (pre-built, no config) |
| `setCurrentHttp` | function |
| `getCurrentHttp` | function |
| `makeCancellable` | function |
| `CancellablePromise` | type |
| `CancellableAsyncIterable` | type |
| `HttpResult<T>` | type |
| `HttpConfig` | interface |
| `RequestOptions` | interface |
| `StreamRequestOptions` | interface |
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
