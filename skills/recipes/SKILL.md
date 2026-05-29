---
name: mongez-http-recipes
description: |
  Idiomatic composition recipes for `@mongez/http` — auth interceptor with token refresh on 401 via `replay()`, built-in retry with exponential backoff and jitter, cancel-on-unmount in React via `.cancel()`, multipart file upload with abort, typed CRUD via a `Resource` subclass, deduping identical concurrent requests with `dedupeKey`, and response caching by URL.
---

# Recipes

Cross-feature compositions for `@mongez/http` — patterns that come up once you've moved past one-off requests.

## Auth interceptor with token refresh on 401

A single `before()` interceptor injects the access token. A single `after()` interceptor catches a `401`, refreshes the token, and calls `context.replay()` to re-fire the original request. The `replay()` helper is guarded against infinite loops — inside an already-replayed request it short-circuits to the current result.

```ts
import { http } from "@mongez/http";

let refreshing: Promise<string | null> | null = null;

http.before(req => {
  const token = getAccessToken();
  if (token) {
    return { ...req, headers: { ...req.headers, Authorization: `Bearer ${token}` } };
  }
});

http.after(async (result, { replay }) => {
  if (!result.error?.isUnauthorized) return;

  refreshing ??= refreshAccessToken().finally(() => { refreshing = null; });
  const token = await refreshing;
  if (!token) return;

  return replay();
});
```

The `refreshing` lock collapses concurrent 401s into one refresh call instead of stampeding the refresh endpoint.

## Retry with exponential backoff

For transient failures (5xx, network), retry up to N times with widening delay. `@mongez/http` has built-in retry — configure once on the `Http` instance and every request inherits it, or pass `retry` per-request.

```ts
import { Http } from "@mongez/http";

const http = new Http({
  baseURL: "https://api.example.com",
  retry: {
    attempts: 5,
    delay: 200,
    backoff: true,            // delay * 2^attempt — default true
    jitter: true,             // multiply by random [0.5, 1.0) to spread thundering herds
    retryOn: [429, 500, 502, 503, 504],   // default
    onRetry: (attempt, error, delay) => {
      console.warn(`retry ${attempt} after ${delay}ms — ${error.message}`);
    },
  },
});

// Per-request override — disable retry for one call
await http.get("/no-retry", { retry: false });

// Or tweak it per-request
await http.get("/flaky", { retry: { attempts: 2, delay: 100 } });
```

Network errors always retry while attempts remain. Aborts and timeouts never retry. When the server returns `Retry-After` (typical on 429), the next delay is never shorter than the value the server requested.

## Cancel a request on component unmount

React's effect cleanup is the right hook. Every request returns a `CancellablePromise` with `.cancel()` — no external `AbortController` plumbing required.

```tsx
import { useEffect, useState } from "react";
import { http } from "@mongez/http";

function UserPanel({ id }: { id: string }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const req = http.get<User>(`/users/${id}`);
    req.then(({ data, error }) => {
      if (error?.isAborted) return;        // cleanup ran — drop the result
      if (data) setUser(data);
    });
    return () => req.cancel("unmounted");
  }, [id]);

  return user ? <h1>{user.name}</h1> : <Spinner />;
}
```

When `id` changes, the previous fetch aborts before the new one fires — no stale-data race. If you already have an external `AbortSignal` (e.g. from React Query), pass it via `options.signal` and the request aborts when either signal fires.

## Multipart file upload with abort

`FormData` is the standard. `http.post` takes the body as a positional argument and infers the content-type — never set `Content-Type` for `FormData` yourself or you'll strip the multipart boundary.

```ts
async function uploadAvatar(file: File, signal: AbortSignal) {
  const form = new FormData();
  form.append("avatar", file);
  form.append("crop", "square");

  const { data, error } = await http.post<{ url: string }>(
    "/users/me/avatar",
    form,
    { signal },
  );

  if (error) throw error;
  return data.url;
}
```

For progress reporting on `string` or `ArrayBuffer` bodies, pass `onUploadProgress` — the body is wrapped in a `ReadableStream` and chunked at 64 KiB. `FormData` bodies do **not** support progress because the browser serializes them internally without exposing the size. Requires `duplex: "half"` fetch support (Chrome 105+, Node 18+, Safari 17.4+).

## Typed CRUD via a `Resource` subclass

When a backend resource (users, products, orders) has the standard CRUD endpoints, subclass `Resource` once and get typed methods for the lot.

```ts
import { Resource } from "@mongez/http";

class UsersResource extends Resource {
  route = "/users";
}

export const usersApi = new UsersResource();

// Now everywhere:
const { data: list }    = await usersApi.list<User[]>({ page: 1 });
const { data: user }    = await usersApi.get<User>(userId);
const { data: created } = await usersApi.create<User>({ name: "Ada" });
const { data: updated } = await usersApi.update<User>(userId, { name: "Ada L." });
await usersApi.delete(userId);

// Bonus — domain actions inherit the same {data, error} shape
await usersApi.action(userId, "ban");                  // POST /users/:id/ban
await usersApi.bulkDelete({ ids: [1, 2, 3] });         // DELETE /users  { ids: [...] }
```

One file declares the resource; the call sites stay free of URL-string sprawl. Subclasses can add domain methods alongside the inherited CRUD. `Resource` resolves its `Http` lazily via `getCurrentHttp()` — call `setCurrentHttp(http)` once at boot, or override per-resource with `.useHttp(instance)`.

## Dedupe identical concurrent requests

Two components mount in the same tick and both ask for `/products/42`. By default, concurrent `GET` calls to the same URL + serialised params already share one underlying `fetch` — each caller still gets its own `CancellablePromise`, and the shared request only aborts when every caller has cancelled.

Need to tweak how the dedup key is computed (e.g. ignore params, or coalesce paginated calls)? Set `dedupeKey` on the `Http` config — a function `(url, params) => string`.

```ts
import { Http } from "@mongez/http";

// Default — dedup by full URL + serialised params (different params = different fetches)
const http = new Http({ baseURL: "https://api.example.com" });

// Aggressive — dedup by URL only, so page=1 and page=2 share one in-flight fetch
const aggressive = new Http({
  baseURL: "https://api.example.com",
  dedupeKey: (url) => url,
});
```

Useful in React trees where multiple components legitimately need the same data on first render. The dedup window is the lifetime of the in-flight request — once it resolves, the cache layer (configured separately) takes over for subsequent calls.

## Response cache by URL with a custom TTL

Read-heavy endpoints (settings, feature flags, public catalogues) can cache their successful responses. Configure once on the `Http` instance — caching applies to `GET` requests only.

```ts
import { Http } from "@mongez/http";

// Minimal in-memory driver — any object matching the CacheDriver shape works
const store = new Map<string, unknown>();
const memoryDriver = {
  get: async <T>(k: string) => (store.get(k) as T) ?? null,
  set: async (k: string, v: unknown) => { store.set(k, v); },
  remove: async (k: string) => { store.delete(k); },
  clear: async () => { store.clear(); },
};

const http = new Http({
  baseURL: "https://api.example.com",
  cache: { driver: memoryDriver, ttl: 60 },   // seconds
});

const { data } = await http.get<Settings>("/settings");
// Same call within 60 seconds returns instantly from cache — no network round-trip.
```

For browser-survivable caching, swap the in-memory `Map` for a `@mongez/cache` driver (localStorage / sessionStorage). To invalidate after a mutation:

```ts
await http.invalidate("http:https://api.example.com/settings");   // a single key
await http.invalidateAll();                                       // everything (needs driver.clear())
```

Default keys are `http:<url>:<serialised-params>`. Override with `options.cacheKey` per request, or supply `generateKey(url, params)` on the cache config.

## Pair with `@mongez/atomic-query` for React state

`@mongez/http` is the request layer. `@mongez/atomic-query` is the React cache layer. Keep them separate and let each do its job:

```ts
const { data, isLoading, error } = useQuery({
  queryKey: ["product", id],
  queryFn: async () => {
    const { data, error } = await http.get<Product>(`/products/${id}`);
    if (error) throw error;
    return data;
  },
});
```

http's `{data, error}` shape maps cleanly: throw on error so atomic-query's `error` slot activates, return on success so its `data` slot populates. No exception bubbling, no manual loading state.
