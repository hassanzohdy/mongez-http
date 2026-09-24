---
description: "Native-fetch HTTP client for TypeScript with typed errors, interceptors, retries, caching and streaming; no Axios. Exports `http`, `Http`, `HttpError`, `Resource`, `setCurrentHttp`, `getCurrentHttp`, `makeCancellable`. Use for: \"replace axios\", \"call an API with a base URL and auth header\", \"handle a 404 or 401 error\", \"retry failed requests\", \"upload progress\", \"cancel a request\", \"stream SSE or NDJSON\", \"cache GET responses\", \"wrap an endpoint in a Resource class\". Not this package: loading data for a page or route (loaders, SSR data) → @warlock.js/web; schema validation of responses → @warlock.js/seal."
---
# @mongez/http

A thin layer over `fetch`. A ready `http` instance works for full URLs at once; when you need a base URL, headers, retries or cache, create your own `Http` and register it with `setCurrentHttp` without touching call sites. Failures throw `HttpError` with flags like `isNotFound`.

## The 80% path
1. Orient and bootstrap: `overview.md`.
2. Make requests and type them with a generic (`http.get<User>()`): `http-client.md`.
3. Handle failures: `error-handling.md`.
4. Cross-cutting behaviour (auth headers, logging, refresh): `interceptors.md`.
5. Optional layers: `caching.md`, `streaming.md`, and `resource.md` for endpoint wrapper classes.
6. Node, Next.js or SSR: `server-side.md` before shipping; examples in `recipes.md`; version notes in `changelog.md`.

## Conventions and pitfalls
- `setCurrentHttp` is global state. On a server it is shared across requests, so read `server-side.md` first.
- Type every response; the default is loose.
- Branch on `HttpError` flags instead of parsing status codes out of the error.
- GET deduplication and response caching are opt-in on the server, not automatic.
- `Resource` paths are contained under its base path; do not build them from unchecked user input.
