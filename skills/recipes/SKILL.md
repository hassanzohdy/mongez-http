---
name: mongez-http-recipes
description: |
  Idiomatic composition recipes for `@mongez/http` — auth interceptor with token refresh on 401, retry with exponential backoff via `@mongez/reinforcements`, cancel-on-unmount in React, multipart file upload with abort, typed CRUD via a `RestfulResource` subclass, deduping identical concurrent requests, and response caching by URL.
  TRIGGER when: code composes multiple `Http` features (interceptors + cache, abort + retry, RestfulResource + auth); user asks "show me an end-to-end auth flow", "how do I retry with backoff", "how do I cancel HTTP requests on unmount in React", "how do I upload a file with progress", or "how do I dedupe concurrent identical requests".
  SKIP: single-method ad-hoc calls — load `mongez-http-client` instead; per-feature dives — load `mongez-http-interceptors`, `mongez-http-caching`, `mongez-http-error-handling`, `mongez-http-streaming`, or `mongez-http-resource`; first-time setup — load `mongez-http-overview`; users on `axios`, `ofetch`, native `fetch`, or `XMLHttpRequest` without `@mongez/http`.
---

# Recipes

Cross-feature compositions for `@mongez/http` — patterns that come up once you've moved past one-off requests.

## Auth interceptor with token refresh on 401

A single `before()` interceptor injects the access token. A single `after()` interceptor catches a `401`, refreshes the token, and replays the original request once. Anything beyond once is a real auth failure.

```ts
import { http } from "@mongez/http";

let refreshing: Promise<string> | null = null;

http.before(req => {
  const token = getAccessToken();
  if (token) req.headers.set("Authorization", `Bearer ${token}`);
});

http.after(async (res, req) => {
  if (res.status !== 401 || (req as any).__retried) return res;
  refreshing ??= refreshAccessToken().finally(() => { refreshing = null; });
  await refreshing;
  (req as any).__retried = true;
  return http.request(req);
});
```

The `refreshing` lock collapses concurrent 401s into one refresh call instead of stampeding the refresh endpoint.

## Retry with exponential backoff

For transient failures (5xx, network), retry up to N times with widening delay. `@mongez/reinforcements` ships the `retry` helper; pair it with `@mongez/http` for a clean composition.

```ts
import { retry } from "@mongez/reinforcements";
import { http } from "@mongez/http";

async function safeFetchUser(id: string) {
  return retry(
    async () => {
      const { data, error } = await http.get<User>(`/users/${id}`);
      if (error) throw error;
      return data;
    },
    {
      attempts: 5,
      delay: 200,
      backoff: "exponential",
      shouldRetry: err => err?.status >= 500 || err?.code === "NETWORK_ERROR",
    },
  );
}
```

`shouldRetry` decides per-failure. 4xx responses don't retry — they're client errors, not transient.

## Cancel a request on component unmount

React's effect cleanup is the right hook. Pass the `AbortSignal` into the request and the unmount aborts it.

```tsx
import { useEffect, useState } from "react";
import { http } from "@mongez/http";

function UserPanel({ id }: { id: string }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    http.get<User>(`/users/${id}`, { signal: ctrl.signal })
      .then(({ data }) => data && setUser(data));
    return () => ctrl.abort();
  }, [id]);

  return user ? <h1>{user.name}</h1> : <Spinner />;
}
```

When `id` changes, the previous fetch aborts before the new one fires — no stale-data race.

## Multipart file upload with abort

`FormData` is the standard. `http.post` accepts it as `data` and infers the content-type.

```ts
async function uploadAvatar(file: File, signal: AbortSignal) {
  const form = new FormData();
  form.append("avatar", file);
  form.append("crop", "square");

  const { data, error } = await http.post<{ url: string }>("/users/me/avatar", {
    data: form,
    signal,
  });

  if (error) throw error;
  return data.url;
}
```

For progress reporting, use the native `XMLHttpRequest` `upload.onprogress` instead — `fetch` (which `@mongez/http` wraps) doesn't expose upload-byte progress yet.

## Typed CRUD via a `RestfulResource` subclass

When a backend resource (users, products, orders) has the standard five endpoints, subclass `RestfulResource` once and get typed methods for the lot.

```ts
import { RestfulResource } from "@mongez/http";

class UsersResource extends RestfulResource<User> {
  protected endpoint = "/users";
}

export const usersApi = new UsersResource();

// Now everywhere:
const { data: list }   = await usersApi.list({ params: { page: 1 } });
const { data: user }   = await usersApi.get(userId);
const { data: created} = await usersApi.create({ name: "Ada" });
const { data: updated} = await usersApi.update(userId, { name: "Ada L." });
await usersApi.delete(userId);
```

One file declares the resource; the call sites stay free of URL-string sprawl. Subclasses can add domain methods (e.g. `usersApi.ban(id)`) alongside the inherited five.

## Dedupe identical concurrent requests

Two components mount in the same tick and both ask for `/products/42`. With `dedupeKey`, the second request reuses the in-flight first instead of round-tripping.

```ts
const { data } = await http.get<Product>(`/products/${id}`, {
  dedupeKey: `products:${id}`,
});
```

Useful in React trees where multiple components legitimately need the same data on first render. The dedupe window is the lifetime of the in-flight request — once it resolves, the cache layer (configured separately) takes over for subsequent calls.

## Response cache by URL with a custom TTL

Read-heavy endpoints (settings, feature flags, public catalogues) can cache their successful responses. Configure once at boot.

```ts
import { http, setFetchCache } from "@mongez/http";

setFetchCache({
  driver: "memory",
  defaultTTL: 60_000,
  shouldCache: (req, res) => req.method === "GET" && res.status === 200,
});

const { data } = await http.get<Settings>("/settings", { fetchCache: true });
// Same call within 60 seconds returns instantly from cache.
```

For browser-survivable caching, swap `driver: "memory"` for a `@mongez/cache` driver (localStorage or sessionStorage). To invalidate after a mutation:

```ts
http.invalidate("/settings");           // a single URL
http.invalidateAll();                   // everything
```

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
