---
name: mongez-http-overview
description: |
  @mongez/http setup and bootstrap — installing the package, configuring the global `Http` instance, `setCurrentHttp`/`getCurrentHttp`, and the exports table. Use this when **replacing axios/fetch** or making HTTP/API requests in a @mongez/warlock app. No Axios; single runtime dep (`@mongez/concat-route`). Remember to type responses with a generic (`http.get<User>()`) — see the `mongez-http-client` skill.
---

# @mongez/http

Native-`fetch` HTTP for TypeScript apps that you actually enjoy writing. No Axios. No magic globals. One tiny runtime dep. Errors are *typed* — not stringly-typed exceptions — so handling a 404 looks like `if (error.isNotFound)` instead of parsing a status code out of a thrown object.

You can be making requests within ten seconds of `yarn add`ing it, because the package ships a pre-built `http` instance you can import and call. When you outgrow that — when you need a base URL, an auth header, a retry policy — you graduate to your own configured instance without changing a single call site.

## Highlighted features

<div class="mongez-highlights">

<div class="mongez-highlight" data-accent="ice">
  <svg class="mongez-highlight-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
  <h3>Ready-to-go singleton</h3>
  <p>Import <code>http</code> and start calling <code>http.get(url)</code> — no setup, no config, no boilerplate. Outgrow it later without changing call sites.</p>
</div>

<div class="mongez-highlight" data-accent="ice">
  <svg class="mongez-highlight-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z"/></svg>
  <h3>Typed <code>data</code> + <code>error</code> results</h3>
  <p>Every call returns a discriminated union — <code>data</code> on success, <code>error</code> on failure. No <code>try/catch</code>, no casts, no thrown values mid-render. TypeScript narrows the happy path for you.</p>
</div>

<div class="mongez-highlight" data-accent="fire">
  <svg class="mongez-highlight-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
  <h3>Cancellation built in</h3>
  <p>Every returned promise carries a <code>.cancel()</code> method, or pass an external <code>AbortSignal</code>. Cancelled requests resolve with <code>error.isAborted = true</code> — no rejected-promise noise.</p>
</div>

<div class="mongez-highlight" data-accent="fire">
  <svg class="mongez-highlight-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><polyline points="21 3 21 8 16 8"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><polyline points="3 21 3 16 8 16"/></svg>
  <h3>Smart GET deduplication + retry</h3>
  <p>Two concurrent calls to the same URL share one underlying <code>fetch</code>. Retry with configurable backoff and optional jitter — opt in per request or per instance.</p>
</div>

<div class="mongez-highlight" data-accent="bolt">
  <svg class="mongez-highlight-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18"/><circle cx="7" cy="6" r="0.5" fill="currentColor"/></svg>
  <h3>Cache + interceptors</h3>
  <p>Plug any <code>CacheDriver</code>-compatible store for GET caching. <code>before()</code> shapes outgoing requests; <code>after()</code> runs on both success <em>and</em> error results — perfect for global toasts, refresh-token flows, and logging.</p>
</div>

<div class="mongez-highlight" data-accent="bolt">
  <svg class="mongez-highlight-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h12"/></svg>
  <h3><code>Resource</code> for RESTful CRUD</h3>
  <p>Subclass <code>Resource</code>, set <code>endpoint = "users"</code>, and you get typed <code>list</code> / <code>get</code> / <code>create</code> / <code>update</code> / <code>delete</code> / <code>publish</code> — zero boilerplate, full type inference end to end.</p>
</div>

</div>

## Install

```sh
npm install @mongez/http
# or: yarn add @mongez/http
# or: pnpm add @mongez/http
```

Runs anywhere `fetch`, `AbortController`, and `TextDecoder` are available — modern browsers, Node 18+, Bun, Deno. The only runtime dep is `@mongez/concat-route` for path joining.

## Quick peek

```ts
import { http } from "@mongez/http";

const { data, error } = await http.get<User[]>(
  "https://api.example.com/users",
);

if (error) {
  console.error(error.message);
  return;
}

// `data` is `User[]` here — TypeScript narrows automatically.
console.log(data.length, "users");
```

The package ships a ready-to-use `http` singleton — import it and call it, no `new`, no config. The `{data, error}` result type means HTTP failures don't throw. Typed error predicates like `error.isNotFound` / `error.isUnauthorized` / `error.isValidationError` are documented in [error handling](../error-handling/).

## When you're ready: bootstrap your own instance

Most apps want a base URL, an auth header, maybe a retry policy. Create **one** configured instance and reuse it everywhere:

```ts
// src/lib/http.ts
import { Http, setCurrentHttp } from "@mongez/http";

export const http = new Http({
  baseURL: import.meta.env.VITE_API_URL,
  auth: () => {
    const token = localStorage.getItem("token");
    return token ? `Bearer ${token}` : null;
  },
});

setCurrentHttp(http); // lets Resource classes pick it up lazily
```

```ts
// anywhere else in your app
import { http } from "./lib/http";

const { data } = await http.get<User[]>("/users"); // hits VITE_API_URL/users
```

Need a one-off variant? Don't `new Http()` again — `extend()` returns a fresh instance with merged config:

```ts
const adminHttp = http.extend({ baseURL: "https://admin.api.com" });
```

## Where to go next

- **[HTTP client](../http-client/)** — every request method, options, and config field
- **[Error handling](../error-handling/)** — the `HttpError` predicate cheat sheet
- **[Resource](../resource/)** — RESTful CRUD subclasses
- **[Caching](../caching/)** — GET cache configuration and drivers
- **[Interceptors](../interceptors/)** — `before()` / `after()` and lifecycle events
- **[Streaming](../streaming/)** — SSE, NDJSON, and raw streams
- **[Recipes](../recipes/)** — file uploads, React Query, multi-tenant clients
