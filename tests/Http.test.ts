import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Http } from "../src/Http";
import { HttpError } from "../src/HttpError";

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

function mockFetch(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  const contentType =
    typeof body === "object" ? "application/json" : "text/plain";

  const response = new Response(
    typeof body === "object" ? JSON.stringify(body) : String(body),
    {
      status,
      headers: { "Content-Type": contentType, ...headers },
    },
  );

  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);
}

function mockFetchError(message = "Failed to fetch") {
  return vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValueOnce(new TypeError(message));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Http", () => {
  let http: Http;

  beforeEach(() => {
    http = new Http({ baseURL: "https://api.example.com" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── GET ──────────────────────────────────────────────────────────────────────

  describe("get()", () => {
    it("returns data on success", async () => {
      mockFetch({ users: [] });
      const { data, error } = await http.get("/users");
      expect(error).toBeNull();
      expect(data).toEqual({ users: [] });
    });

    it("returns error on 404", async () => {
      mockFetch({ message: "Not found" }, 404);
      const { data, error } = await http.get("/missing");
      expect(data).toBeNull();
      expect(error).toBeInstanceOf(HttpError);
      expect(error!.status).toBe(404);
      expect(error!.isNotFound).toBe(true);
    });

    it("appends query params to URL", async () => {
      const spy = mockFetch([]);
      await http.get("/users", { params: { page: 2, limit: 20 } });
      expect(spy).toHaveBeenCalledWith(
        "https://api.example.com/users?page=2&limit=20",
        expect.anything(),
      );
    });

    it("handles array params", async () => {
      const spy = mockFetch([]);
      await http.get("/users", { params: { ids: [1, 2, 3] } });
      const url = spy.mock.calls[0]![0] as string;
      expect(url).toContain("ids=1");
      expect(url).toContain("ids=2");
      expect(url).toContain("ids=3");
    });

    it("omits null/undefined params", async () => {
      const spy = mockFetch([]);
      await http.get("/users", { params: { page: null, limit: undefined, q: "x" } });
      const url = spy.mock.calls[0]![0] as string;
      expect(url).not.toContain("page");
      expect(url).not.toContain("limit");
      expect(url).toContain("q=x");
    });
  });

  // ── POST ─────────────────────────────────────────────────────────────────────

  describe("post()", () => {
    it("sends JSON body and Content-Type header", async () => {
      const spy = mockFetch({ id: 1 }, 201);
      await http.post("/users", { name: "Alice" });

      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).body).toBe(JSON.stringify({ name: "Alice" }));
      expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
        "Content-Type": "application/json",
      });
    });

    it("does not set Content-Type for FormData", async () => {
      const spy = mockFetch({ id: 1 }, 201);
      const fd = new FormData();
      fd.append("name", "Alice");
      await http.post("/users", fd);

      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).headers as Record<string, string>).not.toHaveProperty(
        "Content-Type",
      );
    });
  });

  // ── PUT → POST (putToPost) ────────────────────────────────────────────────────

  describe("putToPost", () => {
    it("converts PUT to POST and appends _method", async () => {
      const client = new Http({ baseURL: "https://api.example.com", putToPost: true });
      const spy = mockFetch({ ok: true });
      await client.put("/users/1", { name: "Bob" });

      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).method).toBe("POST");
      expect((init as RequestInit).body).toContain('"_method":"PUT"');
    });

    it("respects custom putMethodKey", async () => {
      const client = new Http({
        baseURL: "https://api.example.com",
        putToPost: true,
        putMethodKey: "_httpMethod",
      });
      mockFetch({ ok: true });
      const spy = vi.spyOn(globalThis, "fetch");
      await client.put("/users/1", { x: 1 });

      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).body).toContain('"_httpMethod":"PUT"');
    });
  });

  // ── DELETE ───────────────────────────────────────────────────────────────────

  describe("delete()", () => {
    it("sends DELETE request", async () => {
      const spy = mockFetch(null, 204);
      await http.delete("/users/1");
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).method).toBe("DELETE");
    });

    it("supports body via options.data", async () => {
      const spy = mockFetch(null, 204);
      await http.delete("/users", { data: { ids: [1, 2] } });
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).body).toBe(JSON.stringify({ ids: [1, 2] }));
    });
  });

  // ── Auth ─────────────────────────────────────────────────────────────────────

  describe("auth", () => {
    it("attaches static Authorization header", async () => {
      const client = new Http({
        baseURL: "https://api.example.com",
        auth: "Bearer token123",
      });
      const spy = mockFetch({});
      await client.get("/me");
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
        Authorization: "Bearer token123",
      });
    });

    it("calls auth factory before each request", async () => {
      const authFn = vi.fn().mockReturnValue("Bearer dynamic");
      const client = new Http({ baseURL: "https://api.example.com", auth: authFn });
      mockFetch({});
      await client.get("/me");
      expect(authFn).toHaveBeenCalledOnce();
    });

    it("skips header when auth factory returns null", async () => {
      const client = new Http({ baseURL: "https://api.example.com", auth: () => null });
      const spy = mockFetch({});
      await client.get("/me");
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).headers as Record<string, string>).not.toHaveProperty(
        "Authorization",
      );
    });
  });

  // ── Network error ─────────────────────────────────────────────────────────────

  describe("network errors", () => {
    it("returns isNetwork=true on fetch rejection", async () => {
      mockFetchError("Failed to fetch");
      const { data, error } = await http.get("/users");
      expect(data).toBeNull();
      expect(error!.isNetwork).toBe(true);
      expect(error!.status).toBeNull();
    });
  });

  // ── Cancel ──────────────────────────────────────────────────────────────────

  describe("cancel()", () => {
    it("returns isAborted=true when cancelled", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      );

      const req = http.get("/slow");
      req.cancel();
      const { data, error } = await req;
      expect(data).toBeNull();
      expect(error!.isAborted).toBe(true);
    });
  });

  // ── throw option ─────────────────────────────────────────────────────────────

  describe("throw option", () => {
    it("throws HttpError when throw:true and request fails", async () => {
      mockFetch({ message: "Not found" }, 404);
      await expect(http.get("/missing", { throw: true })).rejects.toBeInstanceOf(
        HttpError,
      );
    });
  });

  // ── Interceptors ─────────────────────────────────────────────────────────────

  describe("interceptors", () => {
    it("before interceptor can modify headers", async () => {
      const spy = mockFetch({});
      http.before((req) => ({ ...req, headers: { ...req.headers, "X-Custom": "yes" } }));
      await http.get("/test");
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
        "X-Custom": "yes",
      });
    });

    it("after interceptor can transform result", async () => {
      mockFetch({ items: [1, 2] });
      http.after((result) => {
        if (result.data) {
          return { ...result, data: (result.data as { items: number[] }).items };
        }
      });
      const { data } = await http.get("/test");
      expect(data).toEqual([1, 2]);
    });
  });

  // ── Retry ────────────────────────────────────────────────────────────────────

  describe("retry", () => {
    it("retries on 500 and succeeds on second attempt", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ err: true }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );

      const client = new Http({
        baseURL: "https://api.example.com",
        retry: { attempts: 1, delay: 0, backoff: false },
      });

      const { data, error } = await client.get("/unstable");
      expect(error).toBeNull();
      expect(data).toEqual({ ok: true });
    });

    it("returns error after all retries exhausted", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ err: true }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new Http({
        baseURL: "https://api.example.com",
        retry: { attempts: 2, delay: 0, backoff: false },
      });

      const { error } = await client.get("/down");
      expect(error!.status).toBe(503);
    });

    it("does not retry on 400", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new Http({
        baseURL: "https://api.example.com",
        retry: { attempts: 3, delay: 0 },
      });

      await client.get("/bad-request");
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Cache ────────────────────────────────────────────────────────────────────

  describe("cache", () => {
    it("returns cached value on second call", async () => {
      const store = new Map<string, unknown>();
      const driver = {
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: unknown) => { store.set(k, v); },
      };

      const client = new Http({
        baseURL: "https://api.example.com",
        cache: { driver, ttl: 60 },
      });

      mockFetch({ users: [1] });
      await client.get("/users");

      // Second call — fetch should NOT be called.
      const spy = vi.spyOn(globalThis, "fetch");
      const { data } = await client.get("/users");
      expect(spy).not.toHaveBeenCalled();
      expect(data).toEqual({ users: [1] });
    });

    it("skips cache when cache:false per-request", async () => {
      const store = new Map<string, unknown>();
      store.set("http:https://api.example.com/users", { old: true });

      const driver = {
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: unknown) => { store.set(k, v); },
      };

      const client = new Http({
        baseURL: "https://api.example.com",
        cache: { driver, ttl: 60 },
      });

      const spy = mockFetch({ fresh: true });
      const { data } = await client.get("/users", { cache: false });
      expect(spy).toHaveBeenCalledOnce();
      expect(data).toEqual({ fresh: true });
    });
  });

  // ── responseType ─────────────────────────────────────────────────────────────

  describe("responseType", () => {
    it("text: returns raw string regardless of Content-Type", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response('{"id":1}', {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const { data } = await http.get("/raw", { responseType: "text" });
      expect(data).toBe('{"id":1}');
    });

    it("json: parses body as JSON regardless of Content-Type", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response('{"id":2}', {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      );
      const { data } = await http.get("/data", { responseType: "json" });
      expect(data).toEqual({ id: 2 });
    });

    it("blob: returns a Blob instance", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]).buffer, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      );
      const { data } = await http.get("/image.png", { responseType: "blob" });
      expect(data).toBeInstanceOf(Blob);
    });

    it("arrayBuffer: returns an ArrayBuffer", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(new Uint8Array([10, 20, 30]).buffer, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      );
      const { data } = await http.get("/binary", { responseType: "arrayBuffer" });
      expect(data).toBeInstanceOf(ArrayBuffer);
    });
  });

  // ── onDownloadProgress ────────────────────────────────────────────────────────

  describe("onDownloadProgress", () => {
    it("fires callback with loaded/total/percent as chunks arrive", async () => {
      const payload = JSON.stringify({ users: [1, 2, 3] });
      const encoded = new TextEncoder().encode(payload);
      const half = Math.floor(encoded.length / 2);
      const chunk1 = encoded.slice(0, half);
      const chunk2 = encoded.slice(half);

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(chunk1);
              controller.enqueue(chunk2);
              controller.close();
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Content-Length": String(encoded.length),
            },
          },
        ),
      );

      const events: { loaded: number; total: number | null }[] = [];
      const { data, error } = await http.get("/users", {
        onDownloadProgress: (e) => events.push({ loaded: e.loaded, total: e.total }),
      });

      expect(error).toBeNull();
      expect(data).toEqual({ users: [1, 2, 3] });
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[events.length - 1]!.loaded).toBe(encoded.length);
      expect(events[0]!.total).toBe(encoded.length);
    });

    it("total is null when Content-Length is absent", async () => {
      const encoded = new TextEncoder().encode("hello");

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoded);
              controller.close();
            },
          }),
          { status: 200, headers: { "Content-Type": "text/plain" } },
        ),
      );

      const events: { total: number | null; percent: number | null }[] = [];
      await http.get("/text", {
        responseType: "text",
        onDownloadProgress: (e) => events.push({ total: e.total, percent: e.percent }),
      });

      expect(events[0]!.total).toBeNull();
      expect(events[0]!.percent).toBeNull();
    });
  });

  // ── extend() ─────────────────────────────────────────────────────────────────

  describe("extend()", () => {
    it("creates a new instance with merged config", () => {
      const base = new Http({ baseURL: "https://api.example.com", timeout: 5000 });
      const extended = base.extend({ headers: { "X-App": "1" } });
      expect(extended.getConfig().baseURL).toBe("https://api.example.com");
      expect(extended.getConfig().timeout).toBe(5000);
      expect(extended.getConfig().headers).toEqual({ "X-App": "1" });
    });

    it("does not mutate the parent instance", () => {
      const base = new Http({ baseURL: "https://api.example.com" });
      base.extend({ headers: { "X-App": "1" } });
      expect(base.getConfig().headers).toBeUndefined();
    });
  });

  // ── request deduplication ────────────────────────────────────────────────────

  describe("GET deduplication", () => {
    it("shares one fetch for two concurrent calls to the same URL", async () => {
      const spy = mockFetch({ users: [] });

      const [r1, r2] = await Promise.all([
        http.get("/users"),
        http.get("/users"),
      ]);

      // Only one actual fetch should have fired.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(r1.data).toEqual({ users: [] });
      expect(r2.data).toEqual({ users: [] });
    });

    it("last caller cancelling aborts the shared fetch", async () => {
      // A fetch that never resolves on its own — only an abort unblocks it.
      vi.spyOn(globalThis, "fetch").mockImplementation(
        () => new Promise<Response>(() => {}),
      );

      const req1 = http.get("/slow2");
      const req2 = http.get("/slow2");

      // Both callers cancel synchronously → ref count drops to 0 → sharedController
      // is aborted. The early-abort check in executeSingle() catches this the moment
      // the async execute() body runs, so both promises resolve with isAborted=true.
      req1.cancel();
      req2.cancel();

      const [res1, res2] = await Promise.all([req1, req2]);
      expect(res1.error!.isAborted).toBe(true);
      expect(res2.error!.isAborted).toBe(true);
    });

    it("partial cancel does not abort the shared fetch", async () => {
      // Standard mock — resolves immediately on the first microtask.
      mockFetch({ ok: true });

      const req1 = http.get("/shared");
      const req2 = http.get("/shared");

      // Only one caller cancels. ref count stays at 1 → shared fetch continues.
      req1.cancel();

      // req2 still receives the successful response.
      const { data, error } = await req2;
      expect(error).toBeNull();
      expect(data).toEqual({ ok: true });
    });

    it("sequential calls create separate fetches", async () => {
      const spy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );

      await http.get("/seq");
      await http.get("/seq");

      // After the first awaited call completes, the entry is removed from the
      // in-flight map and the second call creates a fresh fetch.
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  // ── options() ────────────────────────────────────────────────────────────────

  describe("options()", () => {
    it("sends an OPTIONS request", async () => {
      const spy = mockFetch({});
      await http.options("/endpoint");
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).method).toBe("OPTIONS");
    });
  });

  // ── request() ────────────────────────────────────────────────────────────────

  describe("request()", () => {
    it("sends a SEARCH request (non-standard verb)", async () => {
      const spy = mockFetch([]);
      await http.request("SEARCH", "/users", undefined);
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).method).toBe("SEARCH");
    });
  });

  // ── invalidate / invalidateAll ────────────────────────────────────────────────

  describe("invalidate()", () => {
    it("calls driver.remove() with the given key", async () => {
      const removeSpy = vi.fn();
      const client = new Http({
        baseURL: "https://api.example.com",
        cache: { driver: { get: async () => null, set: vi.fn(), remove: removeSpy } },
      });

      await client.invalidate("my-cache-key");
      expect(removeSpy).toHaveBeenCalledWith("my-cache-key");
    });

    it("does nothing when driver has no remove()", async () => {
      const client = new Http({
        baseURL: "https://api.example.com",
        cache: { driver: { get: async () => null, set: vi.fn() } },
      });

      // Should not throw.
      await client.invalidate("key");
    });
  });

  describe("invalidateAll()", () => {
    it("calls driver.clear()", async () => {
      const clearSpy = vi.fn();
      const client = new Http({
        baseURL: "https://api.example.com",
        cache: { driver: { get: async () => null, set: vi.fn(), clear: clearSpy } },
      });

      await client.invalidateAll();
      expect(clearSpy).toHaveBeenCalledOnce();
    });
  });

  // ── retry with jitter ─────────────────────────────────────────────────────────

  describe("retry with jitter", () => {
    it("succeeds on second attempt when jitter is enabled", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ err: true }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );

      const client = new Http({
        baseURL: "https://api.example.com",
        retry: { attempts: 1, delay: 0, backoff: false, jitter: true },
      });

      const { data, error } = await client.get("/unstable-jitter");
      expect(error).toBeNull();
      expect(data).toEqual({ ok: true });
    });
  });

  // ── after interceptor on error branch ─────────────────────────────────────────

  describe("after interceptor on error", () => {
    it("runs after interceptors when the request fails", async () => {
      mockFetch({ code: "NOT_FOUND" }, 404);

      const seen: unknown[] = [];
      http.after((result) => {
        seen.push(result.error);
      });

      const { error } = await http.get("/missing-after");
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(error);
    });
  });

  // ── mode ─────────────────────────────────────────────────────────────────────

  describe("mode option", () => {
    it("forwards global mode to fetch", async () => {
      const client = new Http({ baseURL: "https://api.example.com", mode: "no-cors" });
      const spy = mockFetch({});
      await client.get("/test");
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).mode).toBe("no-cors");
    });

    it("per-request mode overrides global mode", async () => {
      const client = new Http({ baseURL: "https://api.example.com", mode: "cors" });
      const spy = mockFetch({});
      await client.get("/test", { mode: "same-origin" });
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).mode).toBe("same-origin");
    });
  });

  // ── keepalive ─────────────────────────────────────────────────────────────────

  describe("keepalive option", () => {
    it("forwards global keepalive to fetch", async () => {
      const client = new Http({ baseURL: "https://api.example.com", keepalive: true });
      const spy = mockFetch({});
      await client.post("/beacon", { event: "unload" });
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).keepalive).toBe(true);
    });

    it("per-request keepalive overrides global keepalive", async () => {
      const client = new Http({ baseURL: "https://api.example.com", keepalive: false });
      const spy = mockFetch({});
      await client.post("/beacon", { event: "unload" }, { keepalive: true });
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).keepalive).toBe(true);
    });
  });

  // ── default params ───────────────────────────────────────────────────────────

  describe("default params (HttpConfig.params)", () => {
    it("appends default params to every request", async () => {
      const client = new Http({
        baseURL: "https://api.example.com",
        params: { api_key: "xyz", version: "v2" },
      });
      const spy = mockFetch([]);
      await client.get("/items");
      const url = spy.mock.calls[0]![0] as string;
      expect(url).toContain("api_key=xyz");
      expect(url).toContain("version=v2");
    });

    it("per-request params are merged on top (request wins on conflict)", async () => {
      const client = new Http({
        baseURL: "https://api.example.com",
        params: { version: "v1", locale: "en" },
      });
      const spy = mockFetch([]);
      await client.get("/items", { params: { version: "v3", page: 2 } });
      const url = spy.mock.calls[0]![0] as string;
      expect(url).toContain("version=v3");  // request overrides config
      expect(url).toContain("locale=en");   // config default preserved
      expect(url).toContain("page=2");
    });
  });

  // ── redirect ─────────────────────────────────────────────────────────────────

  describe("redirect option", () => {
    it("forwards global redirect to fetch", async () => {
      const client = new Http({ baseURL: "https://api.example.com", redirect: "error" });
      const spy = mockFetch({});
      await client.get("/test");
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).redirect).toBe("error");
    });

    it("per-request redirect overrides global redirect", async () => {
      const client = new Http({ baseURL: "https://api.example.com", redirect: "follow" });
      const spy = mockFetch({});
      await client.get("/test", { redirect: "manual" });
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).redirect).toBe("manual");
    });
  });

  // ── HttpError.headers and HttpError.request ───────────────────────────────────

  describe("HttpError.headers and HttpError.request", () => {
    it("error.headers contains response headers on HTTP error", async () => {
      mockFetch({ msg: "gone" }, 410, { "x-request-id": "abc123" });
      const { error } = await http.get("/gone");
      expect(error!.headers).toMatchObject({ "x-request-id": "abc123" });
    });

    it("error.headers is null on network error", async () => {
      mockFetchError("Connection refused");
      const { error } = await http.get("/unreachable");
      expect(error!.headers).toBeNull();
    });

    it("error.request contains the outgoing request", async () => {
      mockFetch({ msg: "not found" }, 404);
      const { error } = await http.get("/missing");
      expect(error!.request).not.toBeNull();
      expect(error!.request!.url).toContain("/missing");
      expect(error!.request!.method).toBe("GET");
    });
  });

  // ── onRetry callback ─────────────────────────────────────────────────────────

  describe("onRetry callback", () => {
    it("fires onRetry before each retry attempt", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({}), { status: 503, headers: { "Content-Type": "application/json" } }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
        );

      const retryCalls: Array<{ attempt: number; delay: number }> = [];
      const client = new Http({
        baseURL: "https://api.example.com",
        retry: {
          attempts: 1,
          delay: 0,
          backoff: false,
          onRetry: (attempt, _err, delay) => retryCalls.push({ attempt, delay }),
        },
      });

      const { data } = await client.get("/unstable");
      expect(data).toEqual({ ok: true });
      expect(retryCalls).toHaveLength(1);
      expect(retryCalls[0]!.attempt).toBe(1); // 1-based
    });
  });

  // ── after interceptor replay() ────────────────────────────────────────────────

  describe("after interceptor replay()", () => {
    it("replay() retries the request with fresh auth (token-refresh pattern)", async () => {
      let tokenVersion = 1;

      const client = new Http({
        baseURL: "https://api.example.com",
        auth: () => `Bearer token-v${tokenVersion}`,
      });

      const spy = vi.spyOn(globalThis, "fetch")
        // First call: 401
        .mockResolvedValueOnce(
          new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } }),
        )
        // Second call (replay): 200
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 1 }), { status: 200, headers: { "Content-Type": "application/json" } }),
        );

      client.after(async (result, { replay }) => {
        if (result.error?.isUnauthorized) {
          tokenVersion = 2; // "refresh token"
          return replay();
        }
      });

      const { data, error } = await client.get("/profile");
      expect(error).toBeNull();
      expect(data).toEqual({ id: 1 });
      // Second call must use the new token.
      const [, secondInit] = spy.mock.calls[1]!;
      expect((secondInit as RequestInit).headers as Record<string, string>).toMatchObject({
        Authorization: "Bearer token-v2",
      });
    });

    it("replay() is a no-op inside a replayed request (prevents infinite loops)", async () => {
      const client = new Http({ baseURL: "https://api.example.com" });

      // Always 401 — even after replay, so without the guard this would loop forever.
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } }),
      );

      client.after(async (result, { replay }) => {
        if (result.error?.isUnauthorized) {
          return replay(); // on the replayed request replay() is a no-op (returns current result)
        }
      });

      const { error } = await client.get("/locked");
      expect(error!.isUnauthorized).toBe(true);
      // Exactly 2 network calls: original + 1 replay, NOT an infinite loop.
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  // ── responseType: "stream" ───────────────────────────────────────────────────

  describe('responseType: "stream"', () => {
    it("returns response.body as a ReadableStream on success", async () => {
      const encoder = new TextEncoder();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode("chunk"));
              controller.close();
            },
          }),
          { status: 200, headers: { "Content-Type": "application/octet-stream" } },
        ),
      );

      const { data, error } = await http.get("/file.bin", { responseType: "stream" });
      expect(error).toBeNull();
      expect(data).toBeInstanceOf(ReadableStream);
    });

    it("the caller can read chunks from the returned stream", async () => {
      const encoder = new TextEncoder();
      const payload = "hello binary world";
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(payload));
              controller.close();
            },
          }),
          { status: 200, headers: { "Content-Type": "application/octet-stream" } },
        ),
      );

      const { data } = await http.get<ReadableStream>("/download", { responseType: "stream" });
      const reader = (data as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value!);
      }
      expect(new TextDecoder().decode(chunks[0])).toBe(payload);
    });

    it("returns error on non-ok response — body is still populated in HttpError", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const { data, error } = await http.get("/missing", { responseType: "stream" });
      expect(data).toBeNull();
      expect(error).toBeInstanceOf(HttpError);
      expect(error!.status).toBe(404);
      expect(error!.isNotFound).toBe(true);
    });

    it("does not consume the body — stream is handed to caller untouched", async () => {
      const encoder = new TextEncoder();
      const readSpy = vi.fn();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("data"));
          controller.close();
        },
        pull: readSpy,
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      );

      const { data } = await http.get("/raw", { responseType: "stream" });
      // The library must not have pulled from the stream before handing it over.
      expect(readSpy).not.toHaveBeenCalled();
      expect(data).toBeInstanceOf(ReadableStream);
    });
  });

  // ── serializer (item 11) ─────────────────────────────────────────────────────

  describe("HttpConfig.serializer", () => {
    it("uses custom serializer for plain object data", async () => {
      const client = new Http({
        baseURL: "https://api.example.com",
        serializer: (data) => ({
          body: `CUSTOM:${JSON.stringify(data)}`,
          contentType: "application/custom",
        }),
      });
      const spy = mockFetch({ ok: true });
      await client.post("/data", { x: 1 });
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).body).toBe('CUSTOM:{"x":1}');
      expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
        "Content-Type": "application/custom",
      });
    });

    it("skips serializer for FormData (passes through unchanged)", async () => {
      const serializerSpy = vi.fn(() => ({ body: "nope", contentType: "x" }));
      const client = new Http({
        baseURL: "https://api.example.com",
        serializer: serializerSpy,
      });
      const spy = mockFetch({ ok: true });
      const fd = new FormData();
      fd.append("name", "Alice");
      await client.post("/upload", fd);
      expect(serializerSpy).not.toHaveBeenCalled();
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).body).toBeInstanceOf(FormData);
    });

    it("skips serializer when data is a string", async () => {
      const serializerSpy = vi.fn(() => ({ body: "nope", contentType: "x" }));
      const client = new Http({
        baseURL: "https://api.example.com",
        serializer: serializerSpy,
      });
      mockFetch({ ok: true });
      await client.post("/text", "raw body");
      expect(serializerSpy).not.toHaveBeenCalled();
    });
  });

  // ── http.all() / http.race() (item 12) ───────────────────────────────────────

  describe("http.all()", () => {
    it("fires all requests and returns all results in order", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ a: 1 }), { status: 200, headers: { "Content-Type": "application/json" } }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ b: 2 }), { status: 200, headers: { "Content-Type": "application/json" } }),
        );

      const results = await http.all([
        http.get("/a"),
        http.get("/b"),
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]!.data).toEqual({ a: 1 });
      expect(results[1]!.data).toEqual({ b: 2 });
    });

    it("cancel() cancels all inner requests", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(
        () => new Promise<Response>(() => {}),
      );

      const r1 = http.get("/slow-all-a");
      const r2 = http.get("/slow-all-b");
      const batch = http.all([r1, r2]);

      batch.cancel("batch-aborted");

      const results = await batch;
      expect(results[0]!.error!.isAborted).toBe(true);
      expect(results[1]!.error!.isAborted).toBe(true);
    });

    it("exposes a signal that reflects the cancel state", () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
      );
      const batch = http.all([http.get("/x")]);
      expect(batch.signal.aborted).toBe(false);
      batch.cancel();
      expect(batch.signal.aborted).toBe(true);
    });
  });

  describe("http.race()", () => {
    it("returns the first result to arrive and cancels others", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ winner: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
        )
        // The second mock never resolves — simulates a slow mirror.
        .mockImplementationOnce(() => new Promise<Response>(() => {}));

      const result = await http.race([
        http.get("/fast-mirror"),
        http.get("/slow-mirror"),
      ]);

      expect(result.data).toEqual({ winner: true });
    });

    it("exposes a cancel() that aborts all inner requests", () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(
        () => new Promise<Response>(() => {}),
      );

      const r1 = http.get("/race-a");
      const r2 = http.get("/race-b");
      const race = http.race([r1, r2]);

      expect(race.signal.aborted).toBe(false);
      race.cancel("left page");
      expect(race.signal.aborted).toBe(true);
    });
  });

  // ── fetchCache option (item 13) ───────────────────────────────────────────────

  describe("fetchCache option", () => {
    it("forwards global fetchCache to fetch", async () => {
      const client = new Http({ baseURL: "https://api.example.com", fetchCache: "no-store" });
      const spy = mockFetch({});
      await client.get("/test");
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).cache).toBe("no-store");
    });

    it("per-request fetchCache overrides global", async () => {
      const client = new Http({ baseURL: "https://api.example.com", fetchCache: "default" });
      const spy = mockFetch({});
      await client.get("/test", { fetchCache: "reload" });
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).cache).toBe("reload");
    });

    it("fetchCache is undefined when not set (fetch uses its own default)", async () => {
      const spy = mockFetch({});
      await http.get("/test");
      const [, init] = spy.mock.calls[0]!;
      // When neither global nor per-request fetchCache is set, the value
      // should be undefined so the browser uses its own default behaviour.
      expect((init as RequestInit).cache).toBeUndefined();
    });
  });

  // ── dedupeKey customization (item 14) ────────────────────────────────────────

  describe("dedupeKey customization", () => {
    it("uses custom dedupeKey to share one fetch for different params on the same URL", async () => {
      const client = new Http({
        baseURL: "https://api.example.com",
        // Deduplicate on URL only — different params still share one in-flight request.
        dedupeKey: (url) => url,
      });
      const spy = mockFetch({ data: [] });

      const [r1, r2] = await Promise.all([
        client.get("/users", { params: { page: 1 } }),
        client.get("/users", { params: { page: 2 } }),
      ]);

      // Only one real fetch despite different params.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(r1.data).toEqual({ data: [] });
      expect(r2.data).toEqual({ data: [] });
    });

    it("without custom dedupeKey, different params produce separate fetches", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }),
      );

      await Promise.all([
        http.get("/items", { params: { page: 1 } }),
        http.get("/items", { params: { page: 2 } }),
      ]);

      // Default dedup key includes params, so these are treated as separate requests.
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  // ── before interceptor options argument (item 15) ────────────────────────────

  describe("before interceptor options argument", () => {
    it("receives per-request options as the second argument", async () => {
      mockFetch({});
      let capturedOpts: Record<string, unknown> | null = null;

      http.before((_req, opts) => {
        capturedOpts = opts as Record<string, unknown>;
      });

      await http.get("/test", { params: { page: 1 }, timeout: 5000 });

      expect(capturedOpts).not.toBeNull();
      expect(capturedOpts!["params"]).toEqual({ page: 1 });
      expect(capturedOpts!["timeout"]).toBe(5000);
    });

    it("allows before interceptor to conditionally modify request based on options", async () => {
      const spy = mockFetch({});

      http.before((req, opts) => {
        // Add a debug header only for requests with a timeout.
        if ((opts as { timeout?: number }).timeout) {
          return { ...req, headers: { ...req.headers, "X-Has-Timeout": "yes" } };
        }
      });

      await http.get("/timed", { timeout: 10000 });

      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
        "X-Has-Timeout": "yes",
      });
    });

    it("before interceptor with only one param still works (backward compat)", async () => {
      const spy = mockFetch({});

      // A function that takes only req (no options) must still be accepted.
      http.before((req) => ({ ...req, headers: { ...req.headers, "X-Legacy": "1" } }));

      await http.get("/legacy");

      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
        "X-Legacy": "1",
      });
    });
  });

  // ── extend() ─────────────────────────────────────────────────────────────────
});
