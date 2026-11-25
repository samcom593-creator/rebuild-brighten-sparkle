/** Bound private recording lookups and cancel their request on logout, unmount or timeout. */
export async function recordingRequest<T>(signal: AbortSignal, operation: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  if (signal.aborted) throw new Error("Recording lookup cancelled.");
  const controller = new AbortController();
  let cancel = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => {
      controller.abort();
      reject(new Error("Recording lookup did not finish."));
    };
  });
  signal.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, 20_000);
  try {
    return await Promise.race([cancelled, operation(controller.signal)]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}
