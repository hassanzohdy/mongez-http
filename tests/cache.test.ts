import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Http } from "../src/Http";
import type { CacheDriver } from "../src/Http.types";

// ─── In-memory CacheDriver ────────────────────────────────────────────────────

function makeMemoryDriver(): CacheDriver & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => { store.set(k, v); },
    remove: async (k) => { store.delete(k); },
  };
}

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Http cache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores response in cache after first GET", async () => {
    const driver = makeMemoryDriver();
    const http = new Http({ baseURL: "https://api.example.com", cache: { driver, ttl: 60 } });

    mockFetch({ ok: true });
    await http.get("/ping");

    expect(driver.store.size).toBe(1);
  });

  it("serves cached response on second GET without calling fetch", async () => {
    const driver = makeMemoryDriver();
    const http = new Http({ baseURL: "https://api.example.com", cache: { driver, ttl: 60 } });

    mockFetch({ users: [1, 2] });
    await http.get("/users");

    const spy = vi.spyOn(globalThis, "fetch");
    const { data } = await http.get("/users");

    expect(spy).not.toHaveBeenCalled();
    expect(data).toEqual({ users: [1, 2] });
  });

  it("uses different cache keys for different params", async () => {
    const driver = makeMemoryDriver();
    const http = new Http({ baseURL: "https://api.example.com", cache: { driver, ttl: 60 } });

    mockFetch({ page: 1 });
    mockFetch({ page: 2 });

    await http.get("/users", { params: { page: 1 } });
    await http.get("/users", { params: { page: 2 } });

    expect(driver.store.size).toBe(2);
  });

  it("respects custom cacheKey override", async () => {
    const driver = makeMemoryDriver();
    const http = new Http({ baseURL: "https://api.example.com", cache: { driver, ttl: 60 } });

    mockFetch({ custom: true });
    await http.get("/users", { cacheKey: "my-key" });

    expect(driver.store.has("my-key")).toBe(true);
  });

  it("does not cache non-GET requests", async () => {
    const driver = makeMemoryDriver();
    const http = new Http({ baseURL: "https://api.example.com", cache: { driver, ttl: 60 } });

    mockFetch({ id: 1 }, 201);
    await http.post("/users", { name: "Alice" });

    expect(driver.store.size).toBe(0);
  });

  it("per-request cache:false bypasses global cache", async () => {
    const driver = makeMemoryDriver();
    driver.store.set("http:https://api.example.com/users", { stale: true });

    const http = new Http({ baseURL: "https://api.example.com", cache: { driver, ttl: 60 } });

    const spy = mockFetch({ fresh: true });
    const { data } = await http.get("/users", { cache: false });

    expect(spy).toHaveBeenCalledOnce();
    expect(data).toEqual({ fresh: true });
  });

  it("custom generateKey is called with url and params", async () => {
    const driver = makeMemoryDriver();
    const generateKey = vi.fn().mockReturnValue("custom-key");
    const http = new Http({
      baseURL: "https://api.example.com",
      cache: { driver, ttl: 60, generateKey },
    });

    mockFetch({});
    await http.get("/test", { params: { q: "search" } });

    expect(generateKey).toHaveBeenCalledWith(
      expect.stringContaining("/test"),
      expect.objectContaining({ q: "search" }),
    );
  });
});
