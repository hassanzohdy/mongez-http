// @vitest-environment node
//
// Server-side safety. Every other suite runs under happy-dom, where `window` exists and
// the library behaves as it always has. This file runs with no `window` at all — the SSR,
// Node-service, worker and multi-tenant case — where sharing a response between callers is
// a cross-user data leak rather than an optimisation.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Http } from "../src/Http";
import type { CacheDriver } from "../src/Http.types";

function mockJsonFetch(body: unknown = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

/** Minimal in-memory driver; records every key it is asked about. */
function memoryDriver(): CacheDriver & { keys: string[]; store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const keys: string[] = [];
  return {
    store,
    keys,
    async get<T>(key: string): Promise<T | null> {
      keys.push(key);
      return (store.get(key) as T) ?? null;
    },
    set(key: string, value: unknown): void {
      store.set(key, value);
    },
    remove(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
  };
}

describe("server-side safety (no window)", () => {
  let http: Http;

  beforeEach(() => {
    http = new Http({ baseURL: "https://api.example.com" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("confirms the environment really has no window", () => {
    expect(typeof window).toBe("undefined");
  });

  // ── GET deduplication ──────────────────────────────────────────────────────

  describe("GET deduplication", () => {
    it("is off by default, so callers with different credentials never share a response", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        const auth = (init as RequestInit).headers as Record<string, string>;
        return new Response(JSON.stringify({ token: auth["Authorization"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const [a, b] = await Promise.all([
        http.get<{ token: string }>("/me", { headers: { Authorization: "Bearer alice" } }),
        http.get<{ token: string }>("/me", { headers: { Authorization: "Bearer bob" } }),
      ]);

      expect(spy).toHaveBeenCalledTimes(2);
      // The regression this guards: both callers receiving the first caller's response.
      expect(a.data!.token).toBe("Bearer alice");
      expect(b.data!.token).toBe("Bearer bob");
    });

    it("throws when deduplication is opted into without an identity-aware key", () => {
      const client = new Http({ baseURL: "https://api.example.com", dedupe: true });

      expect(() => client.get("/me")).toThrow(/dedupeKey/);
    });

    it("ignores the config dedupeKey generator, which cannot see credentials", () => {
      const client = new Http({
        baseURL: "https://api.example.com",
        dedupe: true,
        dedupeKey: (url) => url,
      });

      // A URL-only generator looks like a fix and is not one — it still collapses
      // two different users onto one in-flight fetch.
      expect(() => client.get("/me")).toThrow(/dedupeKey/);
    });

    it("shares a fetch when callers opt in with the same explicit key", async () => {
      const client = new Http({ baseURL: "https://api.example.com", dedupe: true });
      const spy = mockJsonFetch({ id: 1 });

      const [a, b] = await Promise.all([
        client.get("/me", { dedupeKey: "me:1" }),
        client.get("/me", { dedupeKey: "me:1" }),
      ]);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(a.data).toEqual({ id: 1 });
      expect(b.data).toEqual({ id: 1 });
    });

    it("keeps different identities apart when their keys differ", async () => {
      const client = new Http({ baseURL: "https://api.example.com", dedupe: true });
      const spy = mockJsonFetch({ id: 1 });

      await Promise.all([
        client.get("/me", { dedupeKey: "me:alice" }),
        client.get("/me", { dedupeKey: "me:bob" }),
      ]);

      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("per-request dedupe:true also requires a key", () => {
      expect(() => http.get("/me", { dedupe: true })).toThrow(/dedupeKey/);
    });

    it("non-GET methods are unaffected", async () => {
      const spy = mockJsonFetch({ ok: true });

      const { error } = await http.post("/users", { name: "Ada" });

      expect(error).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Response cache ─────────────────────────────────────────────────────────

  describe("response cache", () => {
    it("stays completely inert when no driver is configured", async () => {
      const spy = mockJsonFetch({ ok: true });

      // The cache is opt-in — an unconfigured instance must not go near it,
      // and must not trip the identity-key requirement either.
      const { error } = await http.get("/users");

      expect(error).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("throws when enabled without an identity-aware key", async () => {
      const client = new Http({
        baseURL: "https://api.example.com",
        cache: { driver: memoryDriver() },
      });
      mockJsonFetch({ ok: true });

      await expect(client.get("/me")).rejects.toThrow(/cacheKey/);
    });

    it("accepts an explicit per-request cacheKey", async () => {
      const driver = memoryDriver();
      const client = new Http({
        baseURL: "https://api.example.com",
        cache: { driver },
      });
      const spy = mockJsonFetch({ id: 1 });

      await client.get("/me", { cacheKey: "me:alice" });
      const second = await client.get("/me", { cacheKey: "me:alice" });

      expect(spy).toHaveBeenCalledTimes(1); // second call served from cache
      expect(second.data).toEqual({ id: 1 });
      expect(driver.store.has("me:alice")).toBe(true);
    });

    it("keeps two identities in separate cache entries", async () => {
      const driver = memoryDriver();
      const client = new Http({
        baseURL: "https://api.example.com",
        cache: { driver },
      });
      const spy = mockJsonFetch({ id: 1 });

      await client.get("/me", { cacheKey: "me:alice" });
      await client.get("/me", { cacheKey: "me:bob" });

      expect(spy).toHaveBeenCalledTimes(2);
      expect([...driver.store.keys()]).toEqual(["me:alice", "me:bob"]);
    });

    it("accepts a generateKey that scopes entries to the caller", async () => {
      const driver = memoryDriver();
      const client = new Http({
        baseURL: "https://api.example.com",
        cache: { driver, generateKey: (url) => `u:alice:${url}` },
      });
      mockJsonFetch({ id: 1 });

      await client.get("/me");

      expect([...driver.store.keys()]).toEqual(["u:alice:https://api.example.com/me"]);
    });

    it("per-request cache:false opts back out entirely", async () => {
      const client = new Http({
        baseURL: "https://api.example.com",
        cache: { driver: memoryDriver() },
      });
      const spy = mockJsonFetch({ ok: true });

      const { error } = await client.get("/me", { cache: false });

      expect(error).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ── fetchInit ──────────────────────────────────────────────────────────────

  describe("fetchInit", () => {
    it("reaches fetch on the server, where Next.js reads it", async () => {
      const client = new Http({
        baseURL: "https://api.example.com",
        fetchInit: { next: { revalidate: 60, tags: ["news"] } },
      });
      const spy = mockJsonFetch({});

      await client.get("/news");

      const init = spy.mock.calls[0]![1] as unknown as Record<string, unknown>;
      expect(init["next"]).toEqual({ revalidate: 60, tags: ["news"] });
    });
  });
});
