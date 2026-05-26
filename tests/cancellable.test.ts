import { describe, expect, it, vi } from "vitest";
import { makeCancellable } from "../src/cancellable";

describe("makeCancellable", () => {
  it("resolves normally when not cancelled", async () => {
    const p = makeCancellable((signal) => {
      void signal;
      return Promise.resolve(42);
    });

    await expect(p).resolves.toBe(42);
  });

  it("exposes .cancel() and .signal", () => {
    const p = makeCancellable(() => new Promise(() => {}));
    expect(typeof p.cancel).toBe("function");
    expect(p.signal).toBeInstanceOf(AbortSignal);
  });

  it("signal is not aborted before cancel()", () => {
    const p = makeCancellable(() => new Promise(() => {}));
    expect(p.signal.aborted).toBe(false);
  });

  it("signal is aborted after cancel()", () => {
    const p = makeCancellable(() => new Promise(() => {}));
    p.cancel("test");
    expect(p.signal.aborted).toBe(true);
  });

  it("forwards an external signal abort", async () => {
    const ext = new AbortController();
    let capturedSignal: AbortSignal | null = null;

    const p = makeCancellable((signal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    }, ext.signal);

    ext.abort("external");

    // Give microtask queue a turn.
    await Promise.resolve();
    expect(capturedSignal!.aborted).toBe(true);
  });

  it("forwards an already-aborted external signal immediately", () => {
    const ext = new AbortController();
    ext.abort("pre-aborted");

    let capturedSignal: AbortSignal | null = null;
    makeCancellable((signal) => {
      capturedSignal = signal;
      return new Promise(() => {});
    }, ext.signal);

    expect(capturedSignal!.aborted).toBe(true);
  });

  it("cancel reason is propagated to the signal", () => {
    const p = makeCancellable(() => new Promise(() => {}));
    p.cancel("leaving page");
    expect(p.signal.reason).toBe("leaving page");
  });
});
