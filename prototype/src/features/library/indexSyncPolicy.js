export const INDEX_SYNC_RETRY_DELAYS = Object.freeze([250, 750]);

export function canRetrySync(error) {
  return error?.name !== "IpcContractError" && error?.retryable !== false
    && !String(error?.code || "").startsWith("invalid-");
}

export function waitForSyncRetry(delay, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, delay);
    signal.addEventListener("abort", done, { once: true });
  });
}
