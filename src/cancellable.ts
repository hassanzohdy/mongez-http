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
      });
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
