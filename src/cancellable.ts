import type { HttpError } from "./HttpError";

/**
 * CancellableAsyncIterable — an AsyncIterable augmented with `.cancel()`, `.signal`,
 * and `.error`. Returned by Http.stream(). Use with `for await...of`.
 *
 * @example
 * const stream = http.stream<ChatChunk>('/chat', { method: 'POST', data: { messages } });
 * for await (const chunk of stream) {
 *   process(chunk);
 * }
 * // No try/catch needed — check .error after the loop:
 * if (stream.error) console.error('Stream failed:', stream.error.message);
 *
 * // Cancel from outside:
 * stream.cancel('component unmounted');
 */
export type CancellableAsyncIterable<T> = AsyncIterable<T> & {
  /** Abort the in-flight stream. Ends iteration silently. */
  cancel(reason?: string): void;
  /** The AbortSignal wired into this stream. */
  readonly signal: AbortSignal;
  /**
   * Set after iteration ends if the stream terminated due to an error.
   * `null` on clean completion or cancellation.
   *
   * The generator never throws — errors are caught, stored here, and the
   * iteration ends. Check this value after your `for await` loop.
   */
  readonly error: HttpError | null;
};

/**
 * CancellablePromise — a Promise augmented with `.cancel()` and `.signal`.
 *
 * Usage:
 *   const req = http.get<User[]>('/users');
 *   req.cancel('leaving page');
 *   const { data, error } = await req;
 *   // error.isAborted === true
 */
export type CancellablePromise<T> = Promise<T> & {
  /** Abort the in-flight request. */
  cancel(reason?: string): void;
  /** The AbortSignal wired into this request. */
  readonly signal: AbortSignal;
};

/**
 * Wraps a factory that accepts an AbortSignal and returns a Promise<T>.
 * Returns a CancellablePromise<T> whose .cancel() triggers that signal.
 *
 * If an external signal is provided (e.g. from React Query or useEffect),
 * aborting *either* signal cancels the request.
 */
export function makeCancellable<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  externalSignal?: AbortSignal,
): CancellablePromise<T> {
  const controller = new AbortController();

  // Forward external abort into our internal controller.
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", () => {
        controller.abort(externalSignal.reason);
      }, { once: true }); // { once: true } prevents a permanent listener when the signal is long-lived
    }
  }

  const promise = factory(controller.signal) as CancellablePromise<T>;

  promise.cancel = (reason?: string) => {
    controller.abort(reason ?? "cancelled");
  };

  Object.defineProperty(promise, "signal", {
    get: () => controller.signal,
    enumerable: false,
    configurable: false,
  });

  return promise;
}
