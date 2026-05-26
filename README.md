<div align="center">

# @mongez/http

**A fetch-based TypeScript HTTP client built for real apps.**

[![npm version](https://img.shields.io/npm/v/@mongez/http?color=0ea5e9&label=npm&logo=npm)](https://www.npmjs.com/package/@mongez/http)
[![License](https://img.shields.io/npm/l/@mongez/http?color=22c55e)](https://github.com/hassanzohdy/mongez-http/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5%2B-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/@mongez/http?color=f97316&label=minzipped)](https://bundlephobia.com/package/@mongez/http)
[![Tests](https://img.shields.io/badge/tests-80%20passing-22c55e?logo=vitest)](https://github.com/hassanzohdy/mongez-http)

</div>

---

## Why @mongez/http?

Most HTTP libraries require a try/catch on every request — or force you to handle `undefined` data paths. `@mongez/http` returns a clean discriminated union: you always get `data` **or** `error`, never both, never neither.

```ts
const { data, error } = await http.get<User[]>('/users');

if (error) {
  if (error.isNotFound)        return null;
  if (error.isUnauthorized)    return redirect('/login');
  if (error.isValidationError) return showErrors(error.body);
  return showToast(error.message);
}

// ✅ data is User[] here — fully typed, no cast needed
```

---

## Features

| | |
|---|---|
| **Zero dependencies** | Built on native `fetch` — no Axios, no XMLHttpRequest |
| **`{data, error}` result** | Typed discriminated union — no try/catch on every call |
| **Per-request cancel** | Every promise has `.cancel()` and `.signal` |
| **Typed errors** | `HttpError` with status predicates: `isNotFound`, `isUnauthorized`, `isValidationError`, … |
| **Streaming** | SSE + NDJSON with `.stream()` — cancellable async iterable |
| **Response metadata** | Result includes `headers`, `request`, `response`, `status` |
| **Smart body parsing** | Auto-detects JSON, binary blobs, text from Content-Type |
| **Interceptors** | `before` / `after` hooks, event bus (`request`, `response`, `error`) |
| **Caching** | GET-only, pluggable driver, per-request TTL & key overrides |
| **Retry** | Configurable attempts, delay, exponential backoff, status allowlist |
| **Download progress** | `onDownloadProgress` callback with `loaded`, `total`, `percent` |
| **`responseType`** | Explicit `'json' \| 'text' \| 'blob' \| 'arrayBuffer'` decode control |
| **`putToPost`** | Laravel-style `_method` override for file upload compatibility |
| **`Resource` class** | RESTful CRUD helper — list, get, create, update, delete, bulkDelete, publish |

---

## Installation

```bash
npm install @mongez/http
# or
yarn add @mongez/http
# or
pnpm add @mongez/http
```

---

## Quick start

```ts
import { Http } from '@mongez/http';

const http = new Http({ baseURL: 'https://api.example.com' });

// GET — returns { data, error, status, headers, request, response }
const { data, error } = await http.get<User[]>('/users');

// POST
const { data: user } = await http.post<User>('/users', { name: 'Alice' });

// PUT
await http.put('/users/1', { name: 'Alice' });

// PATCH — data goes inside options
await http.patch('/users/1', { data: { name: 'Alice' } });

// DELETE
await http.delete('/users/1');
```

### Using the default instance

```ts
import { http } from '@mongez/http';

// No baseURL — just pass the full URL
const { data } = await http.get('https://api.example.com/users');
```

---

## Request body

`post()`, `put()`, `patch()`, and `delete()` all accept the same `data` argument. The type and `Content-Type` header are determined automatically:

| Value passed | Sent as | `Content-Type` |
|---|---|---|
| Plain object / array | `JSON.stringify(value)` | `application/json` |
| `string` | As-is | _(not set — caller's responsibility)_ |
| `FormData` | As-is | _(not set — browser adds boundary automatically)_ |
| `HTMLFormElement` | Converted to `FormData` | _(not set — browser adds boundary automatically)_ |

```ts
// Object → JSON
await http.post('/users', { name: 'Alice', role: 'admin' });

// FormData — file upload
const form = new FormData();
form.append('avatar', file);
form.append('name', 'Alice');
await http.post('/users', form);

// HTMLFormElement — pass the DOM element directly
const el = document.querySelector<HTMLFormElement>('#signup-form')!;
await http.post('/users', el);

// Raw string — e.g. XML or custom payload
await http.post('/ingest', '<event type="click"/>', {
  headers: { 'Content-Type': 'application/xml' },
});
```

> **FormData tip:** never set `Content-Type` manually when sending `FormData`. The browser must set it so the multipart boundary is included — if you override it the server will fail to parse the body.

### DELETE with a body

```ts
await http.delete('/users', { data: { ids: [1, 2, 3] } });
```

---

## Configuration

```ts
const http = new Http({
  baseURL: 'https://api.example.com',

  // Static token or per-request factory
  auth: 'Bearer my-token',
  // auth: (req) => store.getState().token,

  timeout: 10_000,          // ms — applies to every request
  headers: { 'X-App': '1' },

  // Retry on server errors
  retry: { attempts: 3, delay: 300, backoff: true, retryOn: [429, 500, 502, 503, 504] },

  // Response caching (GET only)
  cache: { driver: myDriver, ttl: 60 },

  // Laravel-style PUT-as-POST for FormData uploads
  putToPost: true,
  putMethodKey: '_method',
});
```

---

## Error handling

Every failed request returns an `HttpError` — never throws (unless you pass `throw: true`).

```ts
const { data, error } = await http.get('/resource');

if (error) {
  error.status          // number | null
  error.body            // parsed response body
  error.message         // human-readable message
  error.response        // raw Response | null
  error.isAborted       // request was cancelled
  error.isTimeout       // exceeded timeout
  error.isNetwork       // DNS / CORS / no connection

  // Status predicates — getters, no () needed
  error.isClientError     // 4xx
  error.isServerError     // 5xx
  error.isUnauthorized    // 401
  error.isForbidden       // 403
  error.isNotFound        // 404
  error.isValidationError // 422
  error.isRateLimited     // 429
}
```

### Throw mode

```ts
try {
  const { data } = await http.get('/resource', { throw: true });
} catch (err) {
  if (err instanceof HttpError && err.isNotFound) { ... }
}
```

---

## Cancellation

Every request returns a `CancellablePromise` with `.cancel()` and `.signal`:

```ts
const req = http.get('/slow-endpoint');

// Cancel from anywhere
req.cancel('user navigated away');

const { data, error } = await req;
// error.isAborted === true
```

### React + useEffect

```ts
useEffect(() => {
  const req = http.get<User[]>('/users');
  req.then(({ data }) => setUsers(data ?? []));
  return () => req.cancel('unmounted');
}, []);
```

---

## Interceptors & events

### Interceptors

Interceptors run on every request and can **mutate** the request or result.

```ts
// before — modify the outgoing request (add headers, inject tokens, etc.)
http.before((req) => ({
  ...req,
  headers: { ...req.headers, 'X-Request-Id': crypto.randomUUID() },
}));

// before — async (e.g. refresh a token before sending)
http.before(async (req) => {
  const token = await getAccessToken();
  return { ...req, headers: { ...req.headers, Authorization: `Bearer ${token}` } };
});

// after — transform or inspect every result
http.after((result) => {
  if (!result.error) analytics.track({ url: result.request.url, status: result.status });
});

// after — unwrap a nested response shape
http.after<{ data: unknown }>((result) => {
  if (result.data && 'data' in (result.data as object)) {
    return { ...result, data: (result.data as { data: unknown }).data };
  }
});
```

`before` interceptors receive the `OutgoingRequest` after auth is applied. `after` interceptors receive the full `HttpResult<T>` including `headers` and `request`. Both can be async and both are chainable — call `.before()` / `.after()` multiple times to stack them.

### Events

Events are for **observation** — logging, analytics, telemetry. They cannot mutate anything.

| Event | Fires | Payload |
|---|---|---|
| `"request"` | After interceptors, just before `fetch()` | `{ request }` |
| `"response"` | After a successful response and after-interceptors | `{ request, response }` |
| `"error"` | When a request fails for any reason | `{ request, response: undefined }` |

```ts
// Log every outgoing request
http.on('request', ({ request }) => {
  console.log(`→ ${request.method} ${request.url}`);
});

// Track response times / analytics
http.on('response', ({ request, response }) => {
  analytics.track({ url: request.url, status: response!.status });
});

// Global error reporting
http.on('error', ({ request }) => {
  logger.error(`✗ ${request.url}`);
});
```

Unsubscribe by passing the same handler reference to `.off()`:

```ts
const handler = ({ request }) => console.log(request.url);
http.on('request', handler);
// later…
http.off('request', handler);
```

> **Note:** With retry enabled, `"request"` fires once per attempt. On error, the `HttpError` is on the result returned by the promise — not on the event payload.

---

## Streaming

```ts
for await (const chunk of http.stream<ChatChunk>('/chat', {
  method: 'POST',
  data: { model: 'gpt-4o', messages },
})) {
  process(chunk.choices[0].delta.content);
}
```

Supports `"sse"` (default) and `"ndjson"` formats, chunked delivery, and cancellation:

```ts
const stream = http.stream('/chat', { method: 'POST', data: body });

// Cancel from outside the loop (e.g. component unmount, user stops generation)
stream.cancel('user stopped');

for await (const chunk of stream) {
  // iteration ends silently
}
```

---

## Response metadata

Every result carries full context:

```ts
const { data, error, status, headers, request, response } = await http.get('/users');

headers['x-request-id'];      // plain object — direct key access, JSON-serialisable
request.url;                  // final URL after interceptors
request.headers;              // headers that were sent
response;                     // raw Response object
```

---

## Download progress

```ts
const { data } = await http.get('/large-file.zip', {
  responseType: 'blob',
  onDownloadProgress: ({ loaded, total, percent }) => {
    if (percent !== null) setProgress(percent);
  },
});
```

---

## `responseType`

```ts
await http.get('/doc',       { responseType: 'text' });
await http.get('/image.png', { responseType: 'blob' });
await http.get('/binary',    { responseType: 'arrayBuffer' });
await http.get('/api',       { responseType: 'json' });
// default: auto-detect from Content-Type
//   application/json                      → JSON
//   image/*, video/*, audio/*, pdf, zip   → Blob
//   everything else                       → text
```

---

## RESTful Resource

```ts
import { Resource, Http, setCurrentHttp } from '@mongez/http';

const http = new Http({ baseURL: 'https://api.example.com' });
setCurrentHttp(http); // register as global default

class UserResource extends Resource {
  route = '/users';
}

const users = new UserResource();

await users.list({ params: { page: 1 } });  // GET  /users?page=1
await users.get(42);                         // GET  /users/42
await users.create({ name: 'Alice' });       // POST /users
await users.update(42, { name: 'Alice' });   // PUT  /users/42
await users.patch(42, { data: { verified: true } });   // PATCH /users/42
await users.delete(42);                      // DELETE /users/42
await users.bulkDelete([1, 2, 3]);           // DELETE /users { ids: [...] }
await users.publish(42, true);               // PATCH /users/42 { published: true }
```

---

## Caching

```ts
import { createLocalStorageDriver } from '@mongez/cache'; // any compatible driver

const http = new Http({
  baseURL: 'https://api.example.com',
  cache: { driver: createLocalStorageDriver(), ttl: 300 },
});

// Bypass cache for this request only
const { data } = await http.get('/users', { cache: false });

// Custom key
const { data } = await http.get('/users', { cacheKey: 'user-list' });
```

---

## Multiple instances

```ts
const api = new Http({ baseURL: 'https://api.example.com', auth: 'Bearer ...' });
const cdn = api.extend({ baseURL: 'https://cdn.example.com' }); // inherits auth
```

---

## License

MIT © [Hassan Zohdy](https://github.com/hassanzohdy)
