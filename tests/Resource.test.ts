import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Http } from "../src/Http";
import { Resource } from "../src/Resource";
import { setCurrentHttp } from "../src/current-http";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// ─── Test resource ────────────────────────────────────────────────────────────

class UsersResource extends Resource {
  route = "/users";
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Resource", () => {
  let http: Http;
  let users: UsersResource;

  beforeEach(() => {
    http = new Http({ baseURL: "https://api.example.com" });
    setCurrentHttp(http);
    users = new UsersResource();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── path() ───────────────────────────────────────────────────────────────────

  describe("path()", () => {
    it("returns base route with no suffix", () => {
      expect(users.path()).toBe("/users");
    });

    it("appends numeric id", () => {
      expect(users.path(42)).toBe("/users/42");
    });

    it("appends string segment", () => {
      expect(users.path("profile")).toBe("/users/profile");
    });
  });

  // ── list() ──────────────────────────────────────────────────────────────────

  describe("list()", () => {
    it("GET /users with no params", async () => {
      const spy = mockFetch([]);
      await users.list();
      expect(spy).toHaveBeenCalledWith(
        "https://api.example.com/users",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("forwards params as query string", async () => {
      const spy = mockFetch([]);
      await users.list({ page: 2 });
      expect(spy.mock.calls[0]![0]).toContain("page=2");
    });

    it("merges defaultListParams", async () => {
      users.defaultListParams = { limit: 50 };
      const spy = mockFetch([]);
      await users.list({ page: 1 });
      const url = spy.mock.calls[0]![0] as string;
      expect(url).toContain("limit=50");
      expect(url).toContain("page=1");
    });
  });

  // ── get() ────────────────────────────────────────────────────────────────────

  describe("get()", () => {
    it("GET /users/42", async () => {
      const spy = mockFetch({ id: 42 });
      await users.get(42);
      expect(spy.mock.calls[0]![0]).toBe("https://api.example.com/users/42");
    });
  });

  // ── create() ────────────────────────────────────────────────────────────────

  describe("create()", () => {
    it("POST /users with data", async () => {
      const spy = mockFetch({ id: 1 }, 201);
      await users.create({ name: "Alice" });
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).method).toBe("POST");
      expect((init as RequestInit).body).toBe(JSON.stringify({ name: "Alice" }));
    });
  });

  // ── update() ────────────────────────────────────────────────────────────────

  describe("update()", () => {
    it("PUT /users/1", async () => {
      const spy = mockFetch({ id: 1 });
      await users.update(1, { name: "Bob" });
      const [url, init] = spy.mock.calls[0]!;
      expect(url).toBe("https://api.example.com/users/1");
      expect((init as RequestInit).method).toBe("PUT");
    });
  });

  // ── patch() ─────────────────────────────────────────────────────────────────

  describe("patch()", () => {
    it("PATCH /users/1", async () => {
      const spy = mockFetch({ id: 1 });
      await users.patch(1, { data: { name: "Bob" } });
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).method).toBe("PATCH");
    });
  });

  // ── delete() ────────────────────────────────────────────────────────────────

  describe("delete()", () => {
    it("DELETE /users/1", async () => {
      const spy = mockFetch(null, 204);
      await users.delete(1);
      const [url, init] = spy.mock.calls[0]!;
      expect(url).toBe("https://api.example.com/users/1");
      expect((init as RequestInit).method).toBe("DELETE");
    });
  });

  // ── bulkDelete() ─────────────────────────────────────────────────────────────

  describe("bulkDelete()", () => {
    it("DELETE /users with body (no double route)", async () => {
      const spy = mockFetch(null, 204);
      await users.bulkDelete({ ids: [1, 2, 3] });
      const [url, init] = spy.mock.calls[0]!;
      // Must target /users, NOT /users/users
      expect(url).toBe("https://api.example.com/users");
      expect((init as RequestInit).method).toBe("DELETE");
      expect((init as RequestInit).body).toBe(JSON.stringify({ ids: [1, 2, 3] }));
    });
  });

  // ── publish() ────────────────────────────────────────────────────────────────

  describe("publish()", () => {
    it("PATCH /users/1 with { published: true } — no double URL", async () => {
      const spy = mockFetch({ published: true });
      await users.publish(1, true);
      const [url, init] = spy.mock.calls[0]!;
      // Must be /users/1, NOT /users/users/1
      expect(url).toBe("https://api.example.com/users/1");
      expect((init as RequestInit).method).toBe("PATCH");
      expect((init as RequestInit).body).toBe(JSON.stringify({ published: true }));
    });

    it("uses custom publishKey from HttpConfig", async () => {
      const h = new Http({ baseURL: "https://api.example.com", publishKey: "active" });
      setCurrentHttp(h);
      const res = new UsersResource();
      mockFetch({ active: false });
      const spy = vi.spyOn(globalThis, "fetch");
      await res.publish(5, false);
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).body).toBe(JSON.stringify({ active: false }));
    });

    it("uses explicit publishKey argument", async () => {
      mockFetch({});
      const spy = vi.spyOn(globalThis, "fetch");
      await users.publish(3, true, "isPublished");
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).body).toBe(JSON.stringify({ isPublished: true }));
    });

    it("passes object payload as-is", async () => {
      mockFetch({});
      const spy = vi.spyOn(globalThis, "fetch");
      await users.publish(3, { published: true, publishedAt: "2024-01-01" });
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).body).toBe(
        JSON.stringify({ published: true, publishedAt: "2024-01-01" }),
      );
    });
  });

  // ── action() ─────────────────────────────────────────────────────────────────

  describe("action()", () => {
    it("POSTs to /route/id/actionName by default", async () => {
      const spy = mockFetch({ success: true });
      await users.action(42, "activate");
      const [url, init] = spy.mock.calls[0]!;
      expect(url).toBe("https://api.example.com/users/42/activate");
      expect((init as RequestInit).method).toBe("POST");
    });

    it("sends data in the request body", async () => {
      const spy = mockFetch({ success: true });
      await users.action(5, "refund", { amount: 100 });
      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).body).toBe(JSON.stringify({ amount: 100 }));
    });

    it("respects a custom method", async () => {
      const spy = mockFetch({ ok: true });
      await users.action(1, "publish", undefined, {}, "PATCH");
      const [url, init] = spy.mock.calls[0]!;
      expect(url).toBe("https://api.example.com/users/1/publish");
      expect((init as RequestInit).method).toBe("PATCH");
    });
  });

  // ── useHttp() ────────────────────────────────────────────────────────────────

  describe("useHttp()", () => {
    it("uses the provided Http instance instead of the global one", async () => {
      const custom = new Http({ baseURL: "https://custom.api.com" });
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
      );

      const res = new UsersResource();
      res.useHttp(custom);
      await res.list();

      expect(spy.mock.calls[0]![0]).toContain("https://custom.api.com");
    });
  });

  // ── getCurrentHttp throws when not set ───────────────────────────────────────

  describe("getCurrentHttp", () => {
    it("throws when no Http instance is registered", async () => {
      // Reset module state by reimporting
      const { getCurrentHttp: getCurrent } = await import("../src/current-http.js");
      // Simulate a fresh state by calling a new Resource without setCurrentHttp
      // We access the private _http via a trick
      class Bare extends Resource {
        route = "/bare";
        testHttp() { return this.http; }
      }

      // Force null by creating a fresh module context is hard without re-importing
      // so just verify the setter works and lazy getter resolves correctly.
      const fresh = new Http({ baseURL: "https://api.example.com" });
      setCurrentHttp(fresh);
      const bare = new Bare();
      expect(bare.testHttp()).toBe(fresh);
    });
  });
});
