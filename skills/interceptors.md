# Interceptors & Events

## Before interceptors

Run before every request. Receive the `OutgoingRequest` and may return a modified copy.

```ts
interface OutgoingRequest {
  method: HttpMethod
  url: string
  headers: Record<string, string>
  body?: BodyInit
}

type BeforeInterceptor = (req: OutgoingRequest) =>
  OutgoingRequest | void | Promise<OutgoingRequest | void>
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

Run after every successful response. Receive `HttpResult<T>` and may return a modified result.

```ts
type AfterInterceptor<T> = (result: HttpResult<T>) =>
  HttpResult<T> | void | Promise<HttpResult<T> | void>
```

```ts
// Unwrap a nested `data` envelope from the API response
http.after((result) => {
  if (result.data && typeof result.data === 'object' && 'data' in result.data) {
    return { ...result, data: (result.data as { data: unknown }).data };
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
  retryOn?: number[]           // default [429, 500, 502, 503, 504]
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
