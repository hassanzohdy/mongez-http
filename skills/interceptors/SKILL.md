---
name: mongez-http-interceptors
description: |
  @mongez/http interceptors & lifecycle — `before()` (`BeforeInterceptor`, `OutgoingRequest` + read-only `RequestOptions`), `after()` (`AfterInterceptor`, `AfterInterceptorContext.replay()`), lifecycle events (`on`/`off`: `"request"`, `"response"`, `"error"`), and `HttpRetryConfig` (attempts, delay, backoff, jitter, retryOn, onRetry).
---

# Interceptors & Events

## Before interceptors

Run before every request. Receive the `OutgoingRequest` (plus a read-only snapshot
of the original `RequestOptions`) and may return a modified copy.

```ts
interface OutgoingRequest {
  method: HttpMethod | string      // any string allowed for non-standard verbs
  url: string
  headers: Record<string, string>
  body?: BodyInit
}

type BeforeInterceptor = (
  req: OutgoingRequest,
  options: Readonly<RequestOptions>,   // inspect params, timeout, responseType, …
) => OutgoingRequest | void | Promise<OutgoingRequest | void>
```

```ts
// Add a custom header to every request
http.before((req) => ({
  ...req,
  headers: { ...req.headers, 'X-Request-Id': crypto.randomUUID() },
}));

// Add auth token dynamically
http.before((req) => {
  const token = store.getState().auth.token;
  if (!token) return;
  return { ...req, headers: { ...req.headers, Authorization: `Bearer ${token}` } };
});
```

## After interceptors

Run after every response — both success AND error. Receive `HttpResult<T>` plus a
context with `replay()` (re-fire the original request from scratch, e.g. after a
token refresh). May return a modified result.

```ts
interface AfterInterceptorContext<T> {
  /** Re-fire the original request from scratch — re-runs auth and before-interceptors.
   *  No-op (returns the current result) inside an already-replayed request. */
  replay(): Promise<HttpResult<T>>;
}

type AfterInterceptor<T> = (
  result: HttpResult<T>,
  context: AfterInterceptorContext<T>,
) => HttpResult<T> | void | Promise<HttpResult<T> | void>
```

```ts
// Unwrap a nested `data` envelope from the API response
http.after((result) => {
  if (result.data && typeof result.data === 'object' && 'data' in result.data) {
    return { ...result, data: (result.data as { data: unknown }).data };
  }
});

// Token refresh on 401 — replay() retries with fresh credentials
http.after(async (result, { replay }) => {
  if (result.error?.isUnauthorized) {
    await refreshToken();
    return replay();
  }
});
```

## Global 401 redirect (simpler — no replay)

```ts
http.after((result) => {
  if (result.error?.isUnauthorized) {
    window.location.href = '/login';
  }
});
```

## Multiple interceptors

Interceptors are chained in registration order. Each receives the output of the previous.

```ts
http.before(addRequestId).before(addTimestamp);
```

## Events

```ts
http.on('request', ({ request }) => {
  console.log(`→ ${request.method} ${request.url}`);
});

http.on('response', ({ request, response }) => {
  console.log(`← ${response?.status} ${request.url}`);
});

http.on('error', ({ request }) => {
  console.error(`✗ ${request.method} ${request.url}`);
});

// Remove handler
http.off('request', myHandler);
```

## Retry config

```ts
interface HttpRetryConfig {
  attempts: number             // number of retry attempts
  delay: number                // base delay in ms
  backoff?: boolean            // default true — exponential: delay * 2^attempt
  jitter?: boolean             // default false — multiply delay by random [0.5, 1.0)
  retryOn?: number[]           // default [429, 500, 502, 503, 504]
  onRetry?: (attempt: number, error: HttpError, delay: number) => void
}
```

```ts
const http = new Http({
  retry: { attempts: 3, delay: 300, backoff: true, retryOn: [429, 503] },
});

// Per-request override
const { data } = await http.get('/flaky', { retry: { attempts: 1, delay: 100 } });

// Disable retry for one call
const { data } = await http.get('/no-retry', { retry: false });
```
