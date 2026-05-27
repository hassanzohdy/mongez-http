---
name: mongez-http-caching
description: |
  @mongez/http application-level caching — `CacheDriver` interface (get/set/remove/clear), `HttpCacheConfig` (driver, ttl, generateKey), global `cache` in `HttpConfig`, per-request `cache`/`cacheKey` override, `invalidate`/`invalidateAll`. GET requests only. Works with `@mongez/cache` drivers.
  TRIGGER when: `CacheDriver`, `HttpCacheConfig`, `cacheKey`, `http.invalidate`, `http.invalidateAll`, `cache` option in `HttpConfig` or `RequestOptions`; user asks "cache HTTP GET responses" or "TTL cache" or "invalidate cache" or "use @mongez/cache driver" or "in-memory cache" or "localStorage cache".
  SKIP: fetch-native `RequestCache` browser HTTP cache (`fetchCache` option) — see `mongez-http-client`; interceptors — see `mongez-http-interceptors`; caching streamed responses — not supported.
---

# Caching

Caching applies to **GET requests only**. Any `CacheDriver`-compatible store works — including `@mongez/cache` drivers.

## CacheDriver interface

```ts
interface CacheDriver {
  get<T = unknown>(key: string): Promise<T | null | undefined>
  set(key: string, value: unknown, ttl?: number): Promise<void> | void
  remove?(key: string): Promise<void> | void
  clear?(): Promise<void> | void   // required for `http.invalidateAll()`
}
```

## Configuration

```ts
// Global — all GET requests are cached
const http = new Http({
  baseURL: '...',
  cache: {
    driver: myDriver,
    ttl: 300,                           // seconds, default 300
    generateKey: (url, params) => url,  // optional custom key
  },
});

// Globally disabled
const http = new Http({ cache: false });
```

## Per-request overrides

```ts
// Force-disable cache for this call
const { data } = await http.get('/users', { cache: false });

// Force-enable for this call (inherits global driver)
const { data } = await http.get('/static/config', { cache: true });

// Per-request driver override
const { data } = await http.get('/users', {
  cache: { driver: sessionDriver, ttl: 60 },
});

// Explicit cache key
const { data } = await http.get('/users', { cacheKey: 'all-users' });
```

## Example: in-memory driver

```ts
const store = new Map<string, unknown>();

const memoryDriver = {
  get: async (k) => store.get(k) ?? null,
  set: async (k, v) => { store.set(k, v); },
  remove: async (k) => { store.delete(k); },
};
```

## Example: localStorage driver

```ts
const localStorageDriver = {
  get: async (k) => {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  },
  set: async (k, v, ttl) => {
    localStorage.setItem(k, JSON.stringify(v));
    if (ttl) {
      setTimeout(() => localStorage.removeItem(k), ttl * 1000);
    }
  },
  remove: async (k) => { localStorage.removeItem(k); },
};
```
