import { canRetrySync, INDEX_SYNC_RETRY_DELAYS, waitForSyncRetry } from "../library/indexSyncPolicy.js";

export function createPreviewOutcomeReporter({ record, onError }) {
  const controller = new AbortController();
  let persistedStatus = "";
  let pending = Promise.resolve();
  return {
    cancel() { controller.abort(); },
    report(status) {
      const result = pending.then(async () => {
        if (controller.signal.aborted || persistedStatus === status) return false;
        for (let attempt = 0; attempt <= INDEX_SYNC_RETRY_DELAYS.length; attempt += 1) {
          if (controller.signal.aborted) return false;
          try {
            await record(status);
            if (controller.signal.aborted) return false;
            persistedStatus = status;
            return true;
          } catch (error) {
            if (controller.signal.aborted || error?.code === "preview-stale") return false;
            if (!canRetrySync(error) || attempt === INDEX_SYNC_RETRY_DELAYS.length) {
              onError();
              return false;
            }
            await waitForSyncRetry(INDEX_SYNC_RETRY_DELAYS[attempt], controller.signal);
          }
        }
        return false;
      });
      pending = result;
      return result;
    },
  };
}
