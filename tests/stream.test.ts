import { afterEach, describe, expect, it, vi } from "vitest";
import { Http } from "../src/Http";
import { HttpError } from "../src/HttpError";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

function streamResponse(body: string, status = 200, contentType = "text/event-stream") {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    { status, headers: { "Content-Type": contentType } },
  );
}

/** Collect all chunks from a CancellableAsyncIterable into an array. */
async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const chunk of iterable) {
    results.push(chunk);
  }
  return results;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Http.stream()", () => {
  const http = new Http({ baseURL: "https://api.example.com" });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── SSE (default) ────────────────────────────────────────────────────────────

  describe("SSE format (default)", () => {
    it("yields parsed JSON objects from data: lines", async () => {
      const body = [
        "data: {\"id\":1}\n",
        "\n",
        "data: {\"id\":2}\n",
        "\n",
        "data: [DONE]\n",
        "\n",
      ].join("");

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(streamResponse(body));

      const chunks = await collect(http.stream("/chat"));
      expect(chunks).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("skips [DONE] sentinel", async () => {
      const body = "data: {\"ok\":true}\n\ndata: [DONE]\n\n";
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(streamResponse(body));

      const chunks = await collect(http.stream("/events"));
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ ok: true });
    });

    it("skips non-data lines (event:, id:, comment)", async () => {
      const body = [
        "event: message\n",
        "id: 1\n",
        ": keep-alive\n",
        "data: {\"text\":\"hello\"}\n",
        "\n",
      ].join("");

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(streamResponse(body));

      const chunks = await collect(http.stream("/events"));
      expect(chunks).toEqual([{ text: "hello" }]);
    });

    it("yields raw string when data line is not valid JSON", async () => {
      const body = "data: plain text\n\n";
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(streamResponse(body));

      const chunks = await collect(http.stream("/text"));
      expect(chunks).toEqual(["plain text"]);
    });
  });

  // ── NDJSON ──────────────────────────────────────────────────────────────────

  describe("NDJSON format", () => {
    it("yields one parsed object per non-empty line", async () => {
      const body = '{"id":1}\n{"id":2}\n{"id":3}\n';
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        streamResponse(body, 200, "application/x-ndjson"),
      );

      const chunks = await collect(
        http.stream("/logs", { format: "ndjson" }),
      );
      expect(chunks).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });

    it("skips blank lines", async () => {
      const body = '{"a":1}\n\n{"b":2}\n';
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        streamResponse(body, 200, "application/x-ndjson"),
      );

      const chunks = await collect(http.stream("/logs", { format: "ndjson" }));
      expect(chunks).toHaveLength(2);
    });
  });

  // ── POST streaming ────────────────────────────────────────────────────────────

  describe("POST stream", () => {
    it("sends POST with JSON body", async () => {
      const body = "data: {\"token\":\"Hi\"}\n\ndata: [DONE]\n\n";
      const spy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(streamResponse(body));

      await collect(
        http.stream("/chat", { method: "POST", data: { messages: [] } }),
      );

      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).method).toBe("POST");
      expect((init as RequestInit).body).toBe(JSON.stringify({ messages: [] }));
    });
  });

  // ── Custom parseLine ─────────────────────────────────────────────────────────

  describe("custom parseLine", () => {
    it("uses the provided parser instead of the built-in one", async () => {
      const body = "ITEM:foo\nITEM:bar\n";
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        streamResponse(body, 200, "text/plain"),
      );

      const chunks = await collect(
        http.stream("/custom", {
          format: "ndjson",
          parseLine: (line) => {
            if (!line.startsWith("ITEM:")) return undefined;
            return line.slice(5);
          },
        }),
      );

      expect(chunks).toEqual(["foo", "bar"]);
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("sets .error on non-ok response (does not throw)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const stream = http.stream("/secure");
      const chunks = await collect(stream);

      expect(chunks).toHaveLength(0);
      expect(stream.error).toBeInstanceOf(HttpError);
      expect(stream.error!.isUnauthorized).toBe(true);
    });

    it(".error has correct status and predicate", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("{}", { status: 403, headers: { "Content-Type": "application/json" } }),
      );

      const stream = http.stream("/forbidden");
      await collect(stream);

      expect(stream.error!.status).toBe(403);
      expect(stream.error!.isForbidden).toBe(true);
    });

    it(".error is null on clean completion", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        streamResponse("data: {}\n\n"),
      );

      const stream = http.stream("/ok");
      await collect(stream);

      expect(stream.error).toBeNull();
    });

    it("ends silently on network error when cancelled", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
        new DOMException("Aborted", "AbortError"),
      );

      const stream = http.stream("/chat");
      stream.cancel();

      // Should not throw — iteration just ends silently.
      const chunks = await collect(stream);
      expect(chunks).toHaveLength(0);
      expect(stream.error).toBeNull(); // cancelled, not an error
    });
  });

  // ── SSE proper parsing ────────────────────────────────────────────────────────

  describe("SSE proper parsing", () => {
    it("concatenates multi-line data fields with newline", async () => {
      // RFC 8895: multiple data: lines in one event are joined with '\n'
      const body = "data: line one\ndata: line two\n\n";
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(streamResponse(body));

      const chunks = await collect(http.stream("/multi"));
      // "line one\nline two" is not valid JSON — yields raw string
      expect(chunks).toEqual(["line one\nline two"]);
    });

    it("extracts data from event with id and event fields", async () => {
      const body = "id: 42\nevent: update\ndata: {\"v\":7}\n\n";
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(streamResponse(body));

      const chunks = await collect(http.stream("/sse-fields"));
      expect(chunks).toEqual([{ v: 7 }]);
    });
  });

  // ── SSE reconnect ─────────────────────────────────────────────────────────────

  describe("SSE reconnect", () => {
    it("reconnects and sends Last-Event-ID after normal stream end", async () => {
      // First response: one event with id:5, then stream ends.
      const first = streamResponse("id: 5\ndata: {\"seq\":1}\n\n");
      // Second response: one more event, then stream ends.
      const second = streamResponse("data: {\"seq\":2}\n\n");
      // Third call: we cancel before a third would fire.

      const spy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);

      const stream = http.stream<{ seq: number }>("/events", {
        reconnect: true,
        reconnectDelay: 0, // instant reconnect in tests
        maxReconnectAttempts: 1,
      });

      const chunks = await collect(stream);

      // Both events collected across reconnect.
      expect(chunks).toEqual([{ seq: 1 }, { seq: 2 }]);
      // Second call must include Last-Event-ID header.
      const [, secondInit] = spy.mock.calls[1]!;
      expect((secondInit as RequestInit).headers as Record<string, string>).toMatchObject({
        "Last-Event-ID": "5",
      });
    });
  });

  // ── cancel() ─────────────────────────────────────────────────────────────────

  describe("cancel()", () => {
    it("signal is not aborted before cancel()", () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(streamResponse(""));
      const stream = http.stream("/chat");
      expect(stream.signal.aborted).toBe(false);
    });

    it("signal is aborted after cancel()", () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(streamResponse(""));
      const stream = http.stream("/chat");
      stream.cancel("test");
      expect(stream.signal.aborted).toBe(true);
    });

    it("cancel reason is propagated to signal", () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(streamResponse(""));
      const stream = http.stream("/chat");
      stream.cancel("leaving page");
      expect(stream.signal.reason).toBe("leaving page");
    });
  });

  // ── Auth forwarded ───────────────────────────────────────────────────────────

  describe("auth", () => {
    it("attaches Authorization header to stream request", async () => {
      const client = new Http({
        baseURL: "https://api.example.com",
        auth: "Bearer stream-token",
      });

      const spy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(streamResponse("data: {}\n\n"));

      await collect(client.stream("/chat"));

      const [, init] = spy.mock.calls[0]!;
      expect((init as RequestInit).headers as Record<string, string>).toMatchObject({
        Authorization: "Bearer stream-token",
      });
    });
  });

  // ── Chunked across network packets ───────────────────────────────────────────

  describe("chunked delivery", () => {
    it("handles a data line split across two chunks", async () => {
      // Simulate the network delivering "data: {" in one chunk and '"id":1}\n\n' in the next.
      const part1 = encoder.encode('data: {"id":');
      const part2 = encoder.encode('1}\n\ndata: [DONE]\n\n');

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(part1);
              controller.enqueue(part2);
              controller.close();
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } },
        ),
      );

      const chunks = await collect(http.stream("/chat"));
      expect(chunks).toEqual([{ id: 1 }]);
    });
  });
});
