# @mongez/http

Robust, native-`fetch` HTTP client for TypeScript.

- **`{data, error}` result** — no try/catch clutter
- **Per-request `.cancel()`** — every method returns a CancellablePromise
- **Typed errors** — `HttpError` with `.isAborted`, `.isTimeout`, `.isNetwork`, status predicates
- **Caching** — GET caching with any `CacheDriver`-compatible store
- **Retry** — configurable attempts, delay, and exponential backoff
- **Interceptors** — before-request and after-response hooks
- **`Resource` class** — RESTful CRUD helper with zero boilerplate
- **Zero heavy deps** — native `fetch` only, one small runtime dep

---

## Install

```bash
npm i @mongez/http
```

---

## Bootstrap

```ts
// src/http.ts
import { Http, setCurrentHttp } from '@mongez/http';

export const http = new Http({
  baseURL: import.meta.env.VITE_API_URL,
  auth: () => localStorage.getItem('token')
    ? `Bearer ${localStorage.getItem('token')}`
    : null,
});

setCurrentHttp(http); // lets Resource classes find the instance lazily
```

---

## Making requests

All methods return a `CancellablePromise<HttpResult<T>>`.

```ts
import { http } from './http';
import type { User } from './types';

const { data, error } = await http.get<User[]>('/users');

if (error) {
  console.error(error.message, error.status);
  return;
}

// data is User[] here — TypeScript knows
console.log(data);
```

Available methods: `get`, `post`, `put`, `patch`, `delete`, `head`.

---

## HttpResult<T>

```ts
type HttpResult<T> =
  | { data: T;    error: null;      status: number;      response: Response }
  | { data: null; error: HttpError; status: number|null; response: Response|null }
```

Destructure and check `error` first. TypeScript narrows `data` to `T` in the else-branch.

---

## Query params

```ts
// Simple
await http.get('/users', { params: { page: 1, limit: 20 } });
// → GET /users?page=1&limit=20

// Array values — repeated keys
await http.get('/posts', { params: { ids: [1, 2, 3] } });
// → GET /posts?ids=1&ids=2&ids=3

// null / undefined values are omitted
await http.get('/search', { params: { q: 'hello', type: null } });
// → GET /search?q=hello
```

---

## Cancellation

```ts
const req = http.get<User[]>('/users');

// Cancel it
req.cancel('component unmounted');

const { data, error } = await req;
// error.isAborted === true
```

Pass an external signal (React Query / `useEffect`):

```ts
const { data } = await http.get('/users', { signal: abortController.signal });
```

React cleanup example:

```ts
useEffect(() => {
  const req = http.get<User[]>('/users');
  req.then(({ data, error }) => {
    if (!error?.isAborted) setUsers(data ?? []);
  });
  return () => req.cancel('unmounted');
}, []);
```

---

## Error handling

```ts
const { data, error } = await http.get('/users/99');

if (error) {
  if (error.isNotFound())        return null;
  if (error.isUnauthorized())    return redirect('/login');
  if (error.isValidationError()) return showErrors(error.body);
  if (error.isNetwork)           return toast('Check your connection');
  if (error.isTimeout)           return toast('Request timed out');
  throw error; // re-throw unexpected errors
}
```

Throw mode (for try/catch boundaries):

```ts
const { data } = await http.get('/users/99', { throw: true });
// throws HttpError on failure
```

### HttpError properties

| Property | Type | Description |
|----------|------|-------------|
| `status` | `number \| null` | HTTP status, or null for network errors |
| `body` | `unknown` | Parsed response body |
| `isAborted` | `boolean` | Cancelled via `.cancel()` |
| `isTimeout` | `boolean` | Exceeded timeout limit |
| `isNetwork` | `boolean` | DNS / CORS / no connection |

Predicate methods: `isClientError()`, `isServerError()`, `isUnauthorized()`, `isForbidden()`, `isNotFound()`, `isValidationError()`, `isRateLimited()`.

---

## Resource class

```ts
import { Resource } from '@mongez/http';
import type { User } from './types';

class UsersResource extends Resource {
  route = '/users';
}

export const usersResource = new UsersResource();
```

```ts
// List
const { data: users } = await usersResource.list<User[]>({ page: 1 });

// Get one
const { data: user } = await usersResource.get<User>(42);

// Create
const { data: newUser } = await usersResource.create<User>({ name: 'Alice' });

// Update (PUT)
const { data: updated } = await usersResource.update<User>(42, { name: 'Alice' });

// Partial update (PATCH)
await usersResource.patch(42, { avatar: 'url' });

// Delete
await usersResource.delete(42);

// Bulk delete (sends body to DELETE /users)
await usersResource.bulkDelete({ ids: [1, 2, 3] });

// Publish / Unpublish
await usersResource.publish(42, true);
await usersResource.publish(42, false, 'active'); // custom key
```

`Resource.http` is a **lazy getter** — it calls `getCurrentHttp()` on first use.
Call `setCurrentHttp(http)` at bootstrap and all Resources will find it automatically.

Override per-resource:

```ts
const adminHttp = new Http({ baseURL: 'https://admin.api.com' });
export const adminUsers = new UsersResource().useHttp(adminHttp);
```

---

## Caching

```ts
const http = new Http({
  cache: {
    driver: myDriver,   // any CacheDriver-compatible store
    ttl: 300,           // seconds, default 300
  },
});

// Disable for one call
await http.get('/fresh-data', { cache: false });

// Explicit key
await http.get('/users', { cacheKey: 'all-users' });
```

`CacheDriver` interface:

```ts
interface CacheDriver {
  get<T>(key: string): Promise<T | null | undefined>
  set(key: string, value: unknown, ttl?: number): Promise<void> | void
  remove?(key: string): Promise<void> | void
}
```

---

## Retry

```ts
const http = new Http({
  retry: {
    attempts: 3,
    delay: 300,         // base ms
    backoff: true,      // exponential: delay * 2^attempt (default true)
    retryOn: [429, 503],
  },
});

// Per-request override
await http.get('/flaky', { retry: { attempts: 1, delay: 100 } });

// Disable for one call
await http.get('/no-retry', { retry: false });
```

Default `retryOn`: `[429, 500, 502, 503, 504]`. Network errors are always retried. Aborts and timeouts are never retried.

---

## Interceptors

```ts
// Before — modify outgoing request
http.before((req) => ({
  ...req,
  headers: { ...req.headers, 'X-Request-Id': crypto.randomUUID() },
}));

// After — transform response
http.after((result) => {
  if (result.data && 'data' in (result.data as object)) {
    return { ...result, data: (result.data as { data: unknown }).data };
  }
});
```

---

## Multiple instances / extend()

```ts
const base = new Http({ baseURL: 'https://api.example.com' });

const authHttp = base.extend({
  headers: { 'X-Api-Key': process.env.API_KEY! },
});
```

---

## putToPost (Laravel file uploads)

```ts
const http = new Http({ baseURL, putToPost: true });

// Sent as POST /users/1 with _method=PUT in body
await http.put('/users/1', formData);
```

---

## Timeout

```ts
// Global
const http = new Http({ timeout: 10_000 }); // 10s

// Per-request override
await http.get('/slow', { timeout: 30_000 });
```

---

## License

MIT © [hassanzohdy](https://github.com/hassanzohdy)
