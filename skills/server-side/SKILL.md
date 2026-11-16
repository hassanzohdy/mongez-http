---
name: mongez-http-server-side
description: |
  Using `@mongez/http` on a **server** — Next.js App Router / server components / SSR, Node services, workers, and any multi-tenant process. Covers the browser-vs-server defaults for GET deduplication (`dedupe`, per-request `dedupeKey`), the identity-aware key required by the response `cache` (`cacheKey`, `generateKey`), forwarding framework fetch options with `fetchInit` (Next.js `next: { revalidate, tags }` + `revalidateTag`), and why `setCurrentHttp` is unsafe per-request on a server. Read this before using the package outside a browser.
---

# Server-side & Next.js

A browser runs **one user per instance**. A server runs **many users per process**. Two
features of this package are optimisations that quietly assume the first: GET
deduplication and the response cache. Both key on **URL + params** — never on
credentials — so on a server they could hand one user's response to another.

Since **v3.4.0** the package defaults to the safe behaviour off the browser and refuses
to guess at identity. This skill is the whole story.

## The environment check

Everything below keys off one thing: `typeof window === "undefined"`. Browser-like →
deduplication and the default cache key are allowed. Anything else — Next.js server
components, route handlers, SSR, Node, Bun, Deno, workers — is treated as multi-user.

## GET deduplication

In a browser, concurrent GETs to the same URL share one underlying fetch. That is pure
win: same user, same request, half the traffic.

On a server it is a **cross-user data leak**. Two concurrent `GET /me` calls carrying
different bearer tokens would share one fetch, and both callers would receive the first
caller's response. It is timing-dependent, so it never shows up in testing.

```ts
// Default behaviour — no configuration needed
dedupe: typeof window !== 'undefined'   // true in a browser, false on a server
```

| Setting | Where | Effect |
|---|---|---|
| `dedupe: false` | `HttpConfig` | Off for the whole instance |
| `dedupe: false` | `RequestOptions` | Off for one call |
| `dedupe: true` | either | On — but server-side each GET then **needs** a `dedupeKey` |

### Opting in on a server

If you genuinely want deduplication server-side — a request-scoped instance fanning out
to the same endpoint several times — you must say what makes two callers different:

```ts
const http = new Http({ baseURL, dedupe: true, auth: () => session.token });

// ✅ The key carries identity, so two users never share a fetch.
await http.get('/me', { dedupeKey: `me:${session.userId}` });

// ❌ Throws: dedupe is on outside a browser with no identity-aware key.
await http.get('/me');
```

The library **will not guess** which header carries identity. It could be
`Authorization`, a session cookie, `X-Tenant-Id`, or a signed header — a guess would
silently miss cases while *looking* safe, which is worse than failing loudly. You know
your app; you supply the key.

> `HttpConfig.dedupeKey(url, params)` does **not** satisfy this. It only ever receives the
> URL and params — never headers or options — so it cannot express "same URL, different
> user". It stays a browser-side tuning knob.

## Response caching

The cache is **opt-in**: with no `driver` configured it never runs at all. But when you
do enable it on a server, its default key has the same blind spot — so an identity-aware
key is required:

```ts
// ✅ Per-request key
await http.get('/me', { cacheKey: `me:${session.userId}` });

// ✅ Or a generator that closes over the caller (request-scoped instance)
const http = new Http({
  baseURL,
  cache: {
    driver,
    generateKey: (url, params) =>
      `u:${session.userId}:${url}:${JSON.stringify(params ?? {})}`,
  },
});

// ❌ Throws: cache enabled outside a browser with the default URL+params key.
const http = new Http({ baseURL, cache: { driver } });
await http.get('/me');
```

**Prefer not to use it server-side at all.** The built-in cache is designed as a
client-side feature. On a server, reach for the framework's own cache (below) or a store
you key per request.

## Next.js — `fetchInit`

The library builds its `RequestInit` from a fixed set of keys, so anything it doesn't
model would be dropped. `fetchInit` forwards extra keys verbatim to the underlying
`fetch()`. It's framework-neutral — use it for Next.js, or for Deno/Bun/Cloudflare keys.

This matters most for **cache tags**, which attach per-fetch. Without forwarding,
`revalidateTag()` after a mutation silently invalidates nothing — and because caching is
largely disabled in development, it looks correct locally and fails in production.

```ts
// Instance-wide default
const http = new Http({ baseURL, fetchInit: { next: { revalidate: 60 } } });

// Per-request — merged over the config one
const { data } = await http.get<Post[]>('/posts', {
  fetchInit: { next: { tags: ['posts'] } },
});

// …then, after a mutation:
import { revalidateTag } from 'next/cache';
revalidateTag('posts');
```

`no-store` / `force-cache` already have a first-class option — use `fetchCache`:

```ts
await http.get('/live', { fetchCache: 'no-store' });
```

### What `fetchInit` cannot override

`fetchInit` is spread **first**; the fields the library manages are written last.

| Field | Overridable? | Why |
|---|---|---|
| `method`, `headers`, `body` | ❌ never | Would bypass interceptors and auth |
| `signal` | ❌ never | Would break `.cancel()` and the timeout controller |
| `credentials`, `mode`, `keepalive`, `redirect`, `cache` | Only when unset | A configured value wins; an unset one leaves yours alone |
| anything else (`next`, runtime flags) | ✅ always | That's the point |

It applies to **both** fetch paths — regular requests and `stream()` — so streamed
responses are forwarded too. (`keepalive` is the one exception: it never applies to a
stream, since it caps the body at 64 KB.)

## `setCurrentHttp` is global state

`setCurrentHttp` writes a module-level singleton. In a browser that's a convenience; in a
server process it's shared mutable state across concurrent requests. Calling it **per
request** — to attach the current user's token — lets one request overwrite the instance
another is mid-way through using.

```ts
// ❌ Server — request A can end up sending request B's token
export async function handler(req) {
  setCurrentHttp(new Http({ baseURL, auth: tokenFrom(req) }));
  return ordersResource.list();
}

// ✅ Server — build a request-scoped instance and pass it explicitly
export async function handler(req) {
  const http = new Http({ baseURL, auth: tokenFrom(req) });
  return new OrdersResource().useHttp(http).list();
}
```

`setCurrentHttp` at bootstrap with an instance carrying **no per-user state** is fine
anywhere.

## Recommended server setup

```ts
// One request-scoped instance, no shared caches, framework cache for revalidation.
import { Http } from '@mongez/http';

export function httpFor(session: Session) {
  return new Http({
    baseURL: process.env.API_URL!,
    auth: () => `Bearer ${session.token}`,
    // dedupe defaults to false here — nothing to switch off.
    // No `cache` — let Next's data cache handle it:
    fetchInit: { next: { revalidate: 60 } },
  });
}
```

## Migrating from ≤ 3.3.x

If your server-side code relied on the old behaviour, the changes are:

- **GET deduplication no longer happens on a server.** You may see more outbound
  requests. That is the fix — they were previously sharing responses across callers.
  To keep it, opt in with `dedupe: true` **and** a per-request `dedupeKey`.
- **An enabled cache now throws on a server** unless you pass `cacheKey` or
  `cache.generateKey`. The error message names the fix.
- Browser behaviour is **unchanged** — same defaults, same keys.

## SSRF: user-influenced URLs

Without a `baseURL`, `Http` fetches any `http(s)` URL it is given, including `http://169.254.169.254/` (cloud metadata) and `http://localhost:6379/`. When a URL is influenced by a user (a webhook target, an "import from URL" field, a proxy endpoint), that is server-side request forgery (SSRF). On a server, set a `baseURL` (requests that resolve outside it are refused) or validate the host against an allowlist before calling. Redirects are followed by the runtime, so also keep the allowlist to hosts you trust not to redirect elsewhere.

```ts
// Fixed base: a user-supplied path can never leave it.
const api = new Http({ baseURL: "https://api.example.com" });
await api.get(userPath);            // "../../admin" is rejected; an absolute URL stays under the base

// No baseURL: validate the host yourself before fetching.
const ALLOWED_HOSTS = new Set(["api.example.com", "cdn.example.com"]);

function assertAllowed(raw: string) {
  const url = new URL(raw);         // throws on garbage
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.host)) { // `host` keeps a non-default port
    throw new Error(`Blocked host: ${url.host}`);
  }
  return url.href;
}

await http.get(assertAllowed(userSuppliedUrl));
```
