---
name: mongez-http-changelog
description: |
  Release history for `@mongez/http` — what changed in each version, each entry dated (`## [x.y.z] - YYYY-MM-DD`). Load this to answer "what is new in @mongez/http", "when did fetchInit / Next.js support land", "which version made GET deduplication SSR-safe", "what changed between versions", or before bumping/releasing the package. Mirrors the package CHANGELOG.md (Keep a Changelog + SemVer). Newest version first.
---

# Changelog

All notable changes to `@mongez/http` are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). This skill is the source-of-truth mirror of the package `CHANGELOG.md` — keep both in lockstep on every release.

---

## [3.5.2] — 2026-11-16

### Documentation

- **Server-side requests and SSRF:** README and the server-side skill explain that without a `baseURL` any URL is fetched (`http://169.254.169.254/`, `http://localhost:6379/`), and show a `baseURL` or host-allowlist guard for user-influenced URLs.

### Changed

- Tests: the path-traversal tests no longer touch the network. A `Resource` id with `..` segments is collapsed by `@mongez/concat-route` and stays under the `baseURL`; a direct `Http` call that resolves above the `baseURL` is blocked before `fetch` and comes back as an error result. The guard itself was already correct.

## [3.5.0] - 2026-08-17

Security release. Both items below are reachable in ordinary browser and server usage; the
credential-redaction change alters the shape of `HttpError.request`, so read the note under
`rawRequest` if you log errors.

### Security

- **Path traversal through `Resource` id / action segments.** `joinUrl` (`src/Http.ts`)
  concatenated the resource path onto `baseURL` verbatim, so an id of `../../admin/users`
  produced a request to a completely different endpoint than the one the resource
  represents. Ids routinely come from route params, query strings or API payloads, which
  makes this reachable without the calling code doing anything unusual — and it defeats any
  authorization the server enforces per-resource-path. The joined URL is now resolved with
  `URL` and confined to the configured `baseURL`: anything landing outside it **throws**
  rather than being silently rewritten, because a request that escaped its base is a bug in
  the caller, not something to quietly repoint. When no `baseURL` is configured there is
  nothing to confine against, so instead the scheme is checked and unsafe ones
  (`javascript:`, `data:`, …) are blocked.

- **`Authorization` / `Cookie` values no longer leak through `HttpError`.** `HttpError.request`
  carried the outgoing request with its live headers, so the standard
  `console.error(error)` / `logger.error({ error })` / Sentry-style capture wrote a bearer
  token or session cookie into logs — durably, and usually into a system with a much wider
  read audience than the app itself. `HttpError.request` now returns a copy with sensitive
  header values replaced by `"[redacted]"`. (`src/HttpError.ts`, `src/utils/redact.ts`)

### Added

- **`HttpError.rawRequest`** — the outgoing request with its original, unredacted headers,
  for the narrow cases that genuinely need them (retry with the same credentials,
  request signing). It is a separate property precisely so that reaching for the secret is
  an explicit act and never happens by accident when something serializes the error.

---

## [3.4.0] - 2026-08-08

Server-side safety and Next.js compatibility. **Browser behaviour is unchanged** — every
default, key and option behaves exactly as before. Everything here applies off the browser
(`typeof window === "undefined"`): Next.js server components and SSR, Node services,
workers, and any multi-tenant process.

### Fixed

- **🔴 GET deduplication could serve one user's response to another on a server.** The
  dedup key is built from URL + query params before the outgoing request exists, so it
  never included `Authorization`, cookies or any per-request header. Two concurrent
  `GET /me` calls carrying **different** bearer tokens shared one in-flight fetch and both
  callers received the first caller's response — silent, timing-dependent, and invisible in
  normal testing. Deduplication now **defaults to off outside a browser**, where it was
  only ever an optimisation for a single user. `config.dedupeKey` was not an escape hatch
  for this: its `(url, params)` signature never receives headers, so a credential-aware key
  could not be written from outside the package. **Server-side users should upgrade.**

### Added

- **`fetchInit` on `HttpConfig` and `RequestOptions`** — extra `RequestInit` fields
  forwarded verbatim to the underlying `fetch()`. The init object was built from a fixed
  set of keys, so anything the library didn't model was silently dropped — including
  Next.js' `next: { revalidate, tags }`. Tags attach *per fetch*, so `revalidateTag()`
  after a mutation invalidated nothing; it looked correct in development (where caching is
  largely disabled) and failed in production. Framework-neutral: also covers Deno/Bun/
  Cloudflare keys and whatever comes next.

  ```ts
  const http = new Http({ baseURL, fetchInit: { next: { revalidate: 60 } } });
  await http.get('/posts', { fetchInit: { next: { tags: ['posts'] } } });
  ```

  Caller-supplied keys are merged **first** so the library's own fields win: `method`,
  `headers`, `body` and `signal` can never be overridden (that would bypass interceptors
  and auth, or break cancellation and the timeout controller), and `credentials` / `mode` /
  `keepalive` / `redirect` / `fetchCache` win whenever they are actually configured.
  Applied at **both** fetch call sites — regular requests and `stream()`.
- **`dedupe?: boolean` on `HttpConfig` and `RequestOptions`** — turn GET deduplication on
  or off per instance or per call. Defaults to `true` in a browser, `false` elsewhere.
- **`dedupeKey?: string` on `RequestOptions`** — an explicit, identity-aware dedup key,
  mirroring the existing `cacheKey`. Required for every deduplicated GET when `dedupe` is
  enabled outside a browser; takes precedence over `HttpConfig.dedupeKey`.

### Changed

- **An enabled response cache now requires an identity-aware key outside a browser.** The
  cache is opt-in and stays completely inert when no driver is configured — but once
  enabled on a server its default URL + params key had the same blind spot as the dedup
  key. It now throws unless you pass a per-request `cacheKey` or a `cache.generateKey`,
  naming the fix in the message. The built-in cache remains a **client-side** feature; on a
  server prefer the framework's cache (Next.js' data cache via `fetchInit`) or a store you
  key per request.
- **Opting into deduplication outside a browser throws without a per-request `dedupeKey`.**
  The library deliberately does not hash a guessed list of credential headers into the
  default key — it cannot know whether identity lives in `Authorization`, a session cookie
  or a custom `X-Tenant-Id`, and a guess would miss cases while *looking* safe. Failing
  loudly is the safer default.

### Docs

- **New `server-side` skill** covering the browser-vs-server split end to end: dedup and
  cache defaults, identity-aware keys, `fetchInit` with a full `revalidateTag` example, and
  why `setCurrentHttp` is module-level global state that must not be called per request on
  a server. `overview`, `http-client`, `caching` and `recipes` updated to match and to
  cross-link it; `setCurrentHttp` carries the same warning in its JSDoc.

---

## [3.3.8] — 2026-06-04

### Changed

- **Skills now state the response-typing rule explicitly.** The `http-client` skill gained a *"Type the response — always pass a generic"* section: every verb is `get<T = unknown>(…)`, so omitting the type leaves `data` as `unknown` and `data.first_name` won't compile — always call `http.get<User>(…)` and narrow on `error` first. Mirrored into `llms-full.txt`.
- **Sharper skill triggers.** The `overview` and `http-client` skill descriptions now fire on *making HTTP/API requests*, *replacing axios/fetch*, and *typing a response*, so an agent loads them instead of reverse-engineering usage from source. No code/API changes.

---

## [3.3.7]

### Changed

- **`llms.txt` blurb now uses the `>` blockquote convention** to match every other `@mongez/*` package, so the ecosystem index extracts it consistently. No code/API changes.

---

## [3.3.6]

### Added

- This changelog. No code changes — the package remains the fetch-based HTTP client with the `{ data, error }` result type, per-request cancellation, GET deduplication + retry, response caching, before/after interceptors, lifecycle events, and the `Resource` CRUD helper.

> Version history prior to 3.3.6 is available via the git tags and GitHub releases on [hassanzohdy/mongez-http](https://github.com/hassanzohdy/mongez-http). Future releases will be documented here.
