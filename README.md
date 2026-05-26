<div align="center">

# @mongez/http

**Native-fetch HTTP client for TypeScript with a `{data, error}` result type, per-request `.cancel()`, typed errors, caching, retry, interceptors, and a RESTful `Resource` helper.**

[![npm](https://img.shields.io/npm/v/@mongez/http.svg)](https://www.npmjs.com/package/@mongez/http)
[![license](https://img.shields.io/npm/l/@mongez/http.svg)](LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@mongez/http.svg)](https://bundlephobia.com/package/@mongez/http)
[![downloads](https://img.shields.io/npm/dw/@mongez/http.svg)](https://www.npmjs.com/package/@mongez/http)

</div>

---

## Why @mongez/http?

Most HTTP libraries push you toward `try/catch` on every call, leave you to assemble cancellation by hand, and force a cast-or-check dance on `response.data`. `axios` ships its own XHR-based transport and is heavier than the entire native `fetch` stack. `ky` is fetch-based and tiny, but still throws on non-2xx — every call site needs a guard. Native `fetch` makes you parse the body yourself, check `response.ok`, build the `AbortController`, and serialize query strings. `ofetch` improves on fetch but still throws by default.

`@mongez/http` returns a clean discriminated union — every call yields `data` **or** `error`, never both, never neither. Every promise is cancellable. Errors are typed with status predicates (`isNotFound`, `isUnauthorized`, `isValidationError`, `isRateLimited`, `isAborted`, `isTimeout`, `isNetwork`). It carries one runtime dependency (`@mongez/concat-route`) and rides directly on native `fetch` — no XHR fallback, no Axios footprint.

```ts
import { Http } from "@mongez/http";

const http = new Http({ baseURL: "https://api.example.com" });

const { data, error } = await http.get<User[]>("/users");

if (error) {
  if (error.isNotFound)         return null;
  if (error.isUnauthorized)     return redirect("/login");
  if (error.isValidationError)  return showErrors(error.body);
  return showToast(error.message);
}

// data is User[] here — TypeScript narrows automatically, no cast.
```

---

## Features

| Feature | Description |
|---|---|
| **Native fetch** | One runtime dependency (`@mongez/concat-route`). No Axios, no XHR fallback. |
| **`{data, error}` result** | Discriminated union — no `try/catch` on every call site. |
| **Per-request `.cancel()`** | Every returned promise has `.cancel(reason?)` and `.signal`. |
| **Typed errors** | `HttpError` with `isAborted`, `isTimeout`, `isNetwork`, `isNotFound`, `isUnauthorized`, `isValidationError`, `isRateLimited`, … |
| **GET deduplication** | Concurrent `GET` to the same URL+params share one underlying `fetch`. |
| **Interceptors** | `.before()` modifies outgoing requests; `.after()` runs on both success AND error results. Both can be async. |
| **Events** | `request`, `response`, `error` — observation only, credentials redacted before dispatch. |
| **GET caching** | Pluggable `CacheDriver` interface, global or per-request TTL, custom keys, `invalidate()` / `invalidateAll()`. |
| **Retry** | Configurable attempts, base delay, exponential backoff, optional jitter, honours `Retry-After` header. |
| **Streaming** | `http.stream()` returns a cancellable async iterable. SSE and NDJSON built in, plus `parseLine` for custom formats. |
| **Download progress** | `onDownloadProgress` callback with `loaded`, `total`, `percent`. |
| **`responseType`** | Explicit `json` / `text` / `blob` / `arrayBuffer`, or auto-detect from `Content-Type`. |
| **`putToPost`** | Laravel-style `_method=PUT` body override for `FormData` file uploads. |
| **`Resource` class** | RESTful CRUD helper — `list`, `get`, `create`, `update`, `patch`, `delete`, `bulkDelete`, `publish`. |
| **Hardened defaults** | Blocks non-http(s) schemes, rejects CR/LF in headers, redacts `Authorization` / `Cookie` from event payloads. |

---

## Installation

```sh
npm install @mongez/http
```

```sh
yarn add @mongez/http
```

```sh
pnpm add @mongez/http
```

Requires TypeScript 5+ as a peer dependency. Runs in any environment with `fetch`, `AbortController`, and `TextDecoder` (modern browsers, Node 18+, Bun, Deno).

---

## Quick start

```ts
import { Http } from "@mongez/http";

const http = new Http({ baseURL: "https://api.example.com" });

// GET — every result has { data, error, status, headers, request, response }
const { data, error } = await http.get<User[]>("/users");

// POST — data is the second argument
const { data: created } = await http.post<User>("/users", { name: "Alice" });

// PUT — same shape
await http.put("/users/1", { name: "Alice" });

// PATCH — body lives in options.data (PATCH historically has no positional body)
await http.patch("/users/1", { data: { verified: true } });

// DELETE — body via options.data, optional
await http.delete("/users/1");
await http.delete("/users", { data: { ids: [1, 2, 3] } });
```

There is also a pre-built default instance with no `baseURL` for ad-hoc full-URL calls:

```ts
import { http } from "@mongez/http";

const { data } = await http.get("https://api.example.com/users");
```

---

## The `Http` class

`new Http(config?)` builds an instance with your shared config. Call `.extend(overrides)` to derive a new instance that inherits everything except what you override.

```ts
const http = new Http({
  baseURL: "https://api.example.com",

  // Static value or per-request factory. Return null/undefined to skip.
  auth: "Bearer my-token",
  // auth: (req) => store.getState().auth.token,

  timeout: 10_000,
  headers: { "X-App": "1" },

  retry: { attempts: 3, delay: 300, backoff: true, retryOn: [429, 500, 502, 503, 504] },

  cache: { driver: myDriver, ttl: 60 },

  // Laravel-style PUT-as-POST for FormData uploads
  putToPost: true,
  putMethodKey: "_method",
});

// Derive a CDN-bound instance that inherits auth, timeout, headers
const cdn = http.extend({ baseURL: "https://cdn.example.com" });
```

Every request method returns a `CancellablePromise<HttpResult<T>>`:

| Method | Signature |
|---|---|
| `http.get<T>(path, options?)` | Body: never. Auto-deduplicated by URL+params. |
| `http.post<T>(path, data?, options?)` | Body as positional arg. |
| `http.put<T>(path, data?, options?)` | Body as positional arg. |
| `http.patch<T>(path, options?)` | Body via `options.data`. |
| `http.delete<T>(path, options?)` | Body via `options.data` (optional). |
| `http.head(path, options?)` | Always resolves with `data: null`. |
| `http.options<T>(path, options?)` | Body: never. |
| `http.request<T>(method, path, data?, options?)` | Escape hatch — accepts any verb string. |

> **GET deduplication.** Concurrent `GET` calls with the same final URL+params share one underlying `fetch`. Each caller still gets its own `CancellablePromise` — `.cancel()` is per-caller, and the shared request only aborts when every caller has cancelled.

### The `HttpResult<T>` shape

Every method resolves with a discriminated union:

```ts
type HttpResult<T> =
  | { data: T;    error: null;      status: number;       response: Response;       headers: Record<string, string>;       request: OutgoingRequest }
  | { data: null; error: HttpError; status: number | null; response: Response | null; headers: Record<string, string> | null; request: OutgoingRequest };
```

Destructure, narrow on `error`, and TypeScript figures the rest out:

```ts
const result = await http.get<User>("/me");

if (result.error) {
  result.data;   // null
  result.error;  // HttpError
} else {
  result.data;    // User
  result.headers; // Record<string, string>
  result.request; // the final OutgoingRequest after interceptors
}
```

---

## Request bodies

`post`, `put`, `patch`, and `delete` all accept the same shape of body. The serialisation and `Content-Type` are inferred from the value:

| Value | Sent as | `Content-Type` |
|---|---|---|
| Plain object / array | `JSON.stringify(value)` | `application/json` |
| `FormData` | As-is | _(unset — browser injects the multipart boundary)_ |
| `HTMLFormElement` | Converted to `FormData` | _(unset — browser injects the multipart boundary)_ |
| `string` | As-is | _(unset — caller's responsibility)_ |
| `undefined` / `null` | No body | _(unset)_ |

```ts
// JSON
await http.post("/users", { name: "Alice", role: "admin" });

// File upload
const form = new FormData();
form.append("avatar", file);
form.append("name", "Alice");
await http.post("/users", form);

// HTMLFormElement — pass the DOM node directly
const el = document.querySelector<HTMLFormElement>("#signup-form")!;
await http.post("/users", el);

// Raw string (XML, custom payload, …)
await http.post("/ingest", "<event type=\"click\"/>", {
  headers: { "Content-Type": "application/xml" },
});
```

> **Never set `Content-Type` manually when sending `FormData`.** The browser must set the header itself so the multipart boundary is included — overriding it strips the boundary and the server fails to parse the body.

---

## Error handling

Every failed request returns an `HttpError` on the result — it never throws unless you pass `throw: true`.

```ts
const { data, error } = await http.get("/users/1");

if (error) {
  error.status;          // number | null
  error.body;            // parsed response body (json or text)
  error.message;         // human-readable message
  error.response;        // raw Response | null
  error.isAborted;       // request was cancelled
  error.isTimeout;       // exceeded timeout
  error.isNetwork;       // DNS / CORS / no connection

  // Status predicates — getters, no () needed
  error.isClientError;     // 4xx
  error.isServerError;     // 5xx
  error.isUnauthorized;    // 401
  error.isForbidden;       // 403
  error.isNotFound;        // 404
  error.isValidationError; // 422
  error.isRateLimited;     // 429
}
```

`HttpError.toJSON()` returns a serialisable subset (no `response`) — safe to log or ship to telemetry.

### Opt-in throw mode

When you'd rather use a `try/catch` boundary (e.g. inside React Query's `queryFn`, where throws drive the error state), pass `throw: true`:

```ts
try {
  const { data } = await http.get("/users/1", { throw: true });
} catch (err) {
  if (err instanceof HttpError && err.isNotFound) {
    // …
  }
  throw err;
}
```

---

## Cancellation

Every returned promise is a `CancellablePromise<HttpResult<T>>` — a normal `Promise` with two extras:

```ts
type CancellablePromise<T> = Promise<T> & {
  cancel(reason?: string): void;
  readonly signal: AbortSignal;
};

const req = http.get<User[]>("/slow-endpoint");

// Cancel from anywhere
req.cancel("user navigated away");

const { error } = await req;
// error.isAborted === true
```

You can also pass an external `AbortSignal` (React Query, `useEffect` cleanup) via `options.signal`. The request aborts when either signal fires.

```ts
useEffect(() => {
  const req = http.get<User[]>("/users");
  req.then(({ data, error }) => {
    if (error?.isAborted) return;
    if (data) setUsers(data);
  });
  return () => req.cancel("unmounted");
}, []);
```

---

## Interceptors and events

### Interceptors mutate

`.before()` runs after auth has been applied, on the final `OutgoingRequest`. Return a new request to mutate, return nothing to leave it untouched. `.after()` runs on the full `HttpResult<T>` — on **both success and error** results. Both can be async, and both are chainable.

```ts
// Add a per-request correlation id
http.before((req) => ({
  ...req,
  headers: { ...req.headers, "X-Request-Id": crypto.randomUUID() },
}));

// Refresh a token before sending
http.before(async (req) => {
  const token = await getAccessToken();
  return { ...req, headers: { ...req.headers, Authorization: `Bearer ${token}` } };
});

// Unwrap a nested { data: … } envelope from the API
http.after<{ data: unknown }>((result) => {
  if (result.data && typeof result.data === "object" && "data" in result.data) {
    return { ...result, data: (result.data as { data: unknown }).data };
  }
});
```

### Events observe

Events fire for observation only — they cannot mutate anything. Sensitive headers (`Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, `X-Auth-Token`, `X-Csrf-Token`) are redacted to `"[redacted]"` before the payload is dispatched.

| Event | Fires | Payload |
|---|---|---|
| `"request"` | After interceptors, just before `fetch()`. Skipped on cache hits. | `{ request }` |
| `"response"` | After a successful response and after-interceptors. | `{ request, response }` |
| `"error"` | When a request fails for any reason. | `{ request, response: undefined }` |

```ts
http.on("request", ({ request }) => {
  console.log(`-> ${request.method} ${request.url}`);
});

http.on("response", ({ request, response }) => {
  analytics.track({ url: request.url, status: response!.status });
});

http.on("error", ({ request }) => {
  logger.error(`x ${request.url}`);
});
```

Unsubscribe by passing the same handler reference to `.off()`:

```ts
const handler = ({ request }: { request: OutgoingRequest }) => console.log(request.url);
http.on("request", handler);
http.off("request", handler);
```

> **Retry interacts with the `"request"` event.** When `retry` is configured, `"request"` fires once per attempt — counting retries is straightforward, but watch for double-logging.

---

## Caching

GET-only. Plug any object that satisfies the `CacheDriver` interface — `@mongez/cache` drivers fit out of the box.

```ts
interface CacheDriver {
  get<T = unknown>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown, ttl?: number): Promise<void> | void;
  remove?(key: string): Promise<void> | void;
  clear?(): Promise<void> | void;
}
```

```ts
const http = new Http({
  baseURL: "https://api.example.com",
  cache: { driver: myDriver, ttl: 300 }, // 300 seconds default
});

// Bypass cache for this request only
await http.get("/users", { cache: false });

// Custom key
await http.get("/users", { cacheKey: "user-list" });

// Per-request driver override
await http.get("/users", { cache: { driver: sessionDriver, ttl: 60 } });
```

Default keys are `http:<url>:<serialised-params>`. Override with `cacheKey` or by supplying `generateKey(url, params)` on the global config. Invalidate explicitly when a write occurs:

```ts
await http.invalidate("user-list");      // remove one entry
await http.invalidateAll();              // wipe driver (requires driver.clear())
```

> **Cache hits skip the `"request"` event.** Only real network calls fire it. This keeps analytics counts honest.

---

## Retry

```ts
const http = new Http({
  retry: {
    attempts: 3,                                   // total attempts after first failure
    delay: 300,                                    // base delay in ms
    backoff: true,                                 // delay * 2^attempt — default true
    jitter: true,                                  // delay * random(0.5, 1.0) — default false
    retryOn: [429, 500, 502, 503, 504],            // default
  },
});

// Per-request override
await http.get("/flaky", { retry: { attempts: 1, delay: 100 } });

// Disable retry for one call
await http.get("/no-retry", { retry: false });
```

Network errors (`isNetwork`) always retry while attempts remain. Aborts and timeouts never retry. When the server returns a `Retry-After` header (typical on 429), it is respected — the next delay is never shorter than the value the server requested.

---

## Streaming

`http.stream<T>(path, options?)` opens a long-lived connection and returns a cancellable async iterable. Built-in formats: `"sse"` (default) and `"ndjson"`. Bring your own `parseLine` for anything else.

```ts
for await (const chunk of http.stream<ChatChunk>("/chat", {
  method: "POST",
  data: { model: "gpt-4o", messages },
})) {
  process(chunk.choices[0].delta.content);
}
```

Cancel from outside the loop with `.cancel()` — iteration ends silently:

```ts
const stream = http.stream("/chat", { method: "POST", data: body });

setTimeout(() => stream.cancel("user stopped"), 5_000);

for await (const chunk of stream) {
  // …
}
```

Custom line parser (return `undefined` to skip):

```ts
for await (const item of http.stream<string>("/feed", {
  parseLine: (line) => (line.startsWith("ITEM:") ? line.slice(5) : undefined),
})) {
  // item is `string`
}
```

> **Network upload progress is not supported.** Native `fetch` does not surface upload `progress` events. Use `XMLHttpRequest` directly when you need them.

---

## Download progress and `responseType`

`responseType` controls how the body is decoded. Omit it to auto-detect from `Content-Type` (JSON, image/video/audio/font/pdf/zip/octet-stream as `Blob`, everything else as text).

```ts
await http.get("/doc",       { responseType: "text" });
await http.get("/image.png", { responseType: "blob" });
await http.get("/binary",    { responseType: "arrayBuffer" });
await http.get("/api",       { responseType: "json" });
```

`onDownloadProgress` reads the body chunk-by-chunk for live progress:

```ts
const { data } = await http.get("/large-file.zip", {
  responseType: "blob",
  onDownloadProgress: ({ loaded, total, percent }) => {
    if (percent !== null) setProgress(percent);
    else setStatus(`${loaded} bytes`);
  },
});
```

`total` and `percent` are `null` when the server omits `Content-Length`.

---

## The `Resource` class

Extend `Resource`, set `route`, and you get a fully-typed RESTful CRUD surface. All methods return `CancellablePromise<HttpResult<T>>`.

```ts
import { Resource, Http, setCurrentHttp } from "@mongez/http";

const http = new Http({ baseURL: "https://api.example.com" });
setCurrentHttp(http); // register as the application-wide default

class UserResource extends Resource {
  route = "/users";
}

const users = new UserResource();

await users.list({ page: 1 });                          // GET    /users?page=1
await users.get(42);                                    // GET    /users/42
await users.create({ name: "Alice" });                  // POST   /users
await users.update(42, { name: "Alice" });              // PUT    /users/42
await users.patch(42, { data: { verified: true } });    // PATCH  /users/42
await users.delete(42);                                 // DELETE /users/42
await users.bulkDelete({ ids: [1, 2, 3] });             // DELETE /users  { ids: [...] }
await users.publish(42, true);                          // PATCH  /users/42  { published: true }
```

`Resource.http` is a lazy getter — it calls `getCurrentHttp()` on first access. Call `setCurrentHttp(instance)` once at boot and every resource picks it up. Override per-instance with `.useHttp()`:

```ts
const adminHttp = new Http({ baseURL: "https://admin.api.example.com", auth: adminToken });
export const adminUsers = new UserResource().useHttp(adminHttp);
```

Default list params live on the instance:

```ts
class OrderResource extends Resource {
  route = "/orders";
  defaultListParams = { include: "items,customer", sort: "-created_at" };
}
```

> **`publish()` keys are configurable.** Pass a third argument to override per-call (`users.publish(42, true, "active")`), or set `publishKey` on `HttpConfig` to change the default for every resource.

---

## Recipes

### Bootstrap once, share everywhere

Reach for this when you want one configured client your whole app imports, plus `Resource` classes that resolve it lazily.

```ts
// src/http.ts
import { Http, setCurrentHttp } from "@mongez/http";

export const http = new Http({
  baseURL: import.meta.env.VITE_API_URL,
  auth: () => {
    const token = localStorage.getItem("token");
    return token ? `Bearer ${token}` : null;
  },
  timeout: 15_000,
  retry: { attempts: 2, delay: 400 },
});

setCurrentHttp(http);

// src/main.tsx
import "./http"; // import first so Resource classes can resolve getCurrentHttp()
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

### Refresh the access token on 401

Reach for this when your API hands out short-lived access tokens with a long-lived refresh token, and you want one place that quietly re-authenticates and replays the failed request.

```ts
import { Http, HttpError } from "@mongez/http";

const http = new Http({ baseURL: "https://api.example.com" });

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  refreshing ??= http
    .post<{ accessToken: string }>("/auth/refresh", { refreshToken: getRefreshToken() })
    .then(({ data, error }) => {
      refreshing = null;
      if (error || !data) return null;
      saveAccessToken(data.accessToken);
      return data.accessToken;
    });
  return refreshing;
}

http.after(async (result) => {
  if (!result.error || !result.error.isUnauthorized) return;

  // Don't loop on the refresh endpoint itself.
  if (result.request.url.endsWith("/auth/refresh")) return;

  const token = await refreshAccessToken();
  if (!token) return;

  // Replay with the new token. We rebuild via the request rather than re-invoking
  // the original call site because the result object has no method/data context.
  const retried = await http.request(
    result.request.method,
    result.request.url.replace(http.getConfig().baseURL ?? "", ""),
    undefined,
    { headers: { ...result.request.headers, Authorization: `Bearer ${token}` } },
  );

  return retried as typeof result;
});
```

### Cancel on React unmount

Reach for this when a component starts a long request that becomes irrelevant the moment the user navigates away — cancel it before it lands so you never call `setState` on an unmounted tree.

```ts
import { useEffect, useState } from "react";
import { http } from "../http";
import type { User } from "../types";

export function useUser(id: number) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const req = http.get<User>(`/users/${id}`);
    req.then(({ data, error }) => {
      if (error?.isAborted) return;       // cleanup ran — drop result
      if (data) setUser(data);
    });
    return () => req.cancel("unmounted");
  }, [id]);

  return user;
}
```

### Wire React Query through the client

Reach for this when you want the typed `{data, error}` surface inline at call sites but still want React Query handling cache, retries, and stale state at the container layer. Forward React Query's `signal` so cancellation works out of the box.

```ts
import { useQuery } from "@tanstack/react-query";
import { http } from "../http";
import type { Order } from "../types";

export function useOrders(status: string) {
  return useQuery({
    queryKey: ["orders", status],
    queryFn: async ({ signal }) => {
      const { data, error } = await http.get<Order[]>("/orders", {
        params: { status },
        signal, // React Query aborts this on query cancel / unmount
      });
      if (error) throw error; // throw so React Query routes it to `error` state
      return data;
    },
  });
}
```

### Upload a file with Laravel-style PUT override

Reach for this when your backend is Laravel (or any framework that needs `_method=PUT` on `multipart/form-data` because PHP can't read PUT bodies as form data). Set `putToPost: true` once on the client and call `.put()` normally.

```ts
import { Http } from "@mongez/http";

const http = new Http({
  baseURL: "https://api.example.com",
  putToPost: true,        // converts PUT -> POST, appends _method=PUT to the body
  putMethodKey: "_method", // default; change if your backend expects a different key
});

const form = new FormData();
form.append("avatar", file);
form.append("name", "Alice");

// Sent as POST /users/1 with _method=PUT in the multipart body.
const { data, error } = await http.put<User>("/users/1", form);
```

### Cache a slow-changing endpoint with `@mongez/cache`

Reach for this when an endpoint is expensive and rarely updates — config, feature flags, currency rates, lookup tables. Wrap a `@mongez/cache` driver in the minimal `CacheDriver` shape and let GET responses memoize themselves.

```ts
import cache, { PlainLocalStorageDriver, setCacheConfigurations } from "@mongez/cache";
import { Http } from "@mongez/http";

setCacheConfigurations({ driver: new PlainLocalStorageDriver() });

const cacheDriver = {
  get: async <T>(key: string) => cache.get(key) as T | null,
  set: async (key: string, value: unknown, ttl?: number) => {
    cache.set(key, value, ttl ?? 0);
  },
  remove: async (key: string) => { cache.remove(key); },
  clear: async () => { cache.clear(); },
};

const http = new Http({
  baseURL: "https://api.example.com",
  cache: { driver: cacheDriver, ttl: 60 * 5 }, // 5 minutes default
});

// Cached for 5 minutes
await http.get("/config/feature-flags");

// Bust it after a write
await http.post("/admin/feature-flags", payload);
await http.invalidate("http:https://api.example.com/config/feature-flags");
```

### Stream an OpenAI-style chat completion with cancel

Reach for this when you're rendering streamed tokens into the UI and need a single "stop" button — cancellation has to abort the underlying fetch, not just stop iterating.

```ts
import { http } from "../http";
import type { ChatChunk } from "../types";

export function streamReply(messages: ChatChunk[]) {
  const stream = http.stream<ChatChunk>("/chat", {
    method: "POST",
    data: { model: "gpt-4o", messages, stream: true },
    format: "sse",
  });

  (async () => {
    try {
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) appendToUi(delta);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("HTTP ")) {
        showError(err.message);
      }
      // Aborted streams end silently — no error to surface.
    }
  })();

  return () => stream.cancel("user stopped");
}
```

---

## Related packages

| Package | Use when you need |
|---|---|
| [`@mongez/cache`](https://github.com/hassanzohdy/mongez-cache) | A pluggable cache facade — drop any driver straight into `HttpConfig.cache` via the minimal `CacheDriver` shape. |
| [`@mongez/concat-route`](https://github.com/hassanzohdy/mongez-concat-route) | URL segment joiner used internally by `Resource.path()`. |
| [`@mongez/atomic-query`](https://github.com/hassanzohdy/atomic-query) | Reactive query layer; pairs well with `@mongez/http`'s `Resource` classes. |
| [`@mongez/dotenv`](https://github.com/hassanzohdy/mongez-dotenv) | Typed `.env` loader for resolving `baseURL`, tokens, and other config at boot. |
| [`@mongez/events`](https://github.com/hassanzohdy/events) | Cross-feature pub/sub — pairs well with the `request` / `response` / `error` events for global instrumentation. |

For the full API reference in a single LLM-friendly file, see [`llms-full.txt`](./llms-full.txt). For per-topic deep-dives (caching, error handling, interceptors, streaming, resource, recipes), see the [`skills/`](./skills) directory.

---

## License

MIT
