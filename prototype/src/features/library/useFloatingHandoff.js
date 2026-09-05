import { normalizeFloatingOpenAction } from "../../lib/ipcContracts.js";

/** 悬浮球到主窗口的请求序列和目标动作服务。 */
export function createFloatingHandoff(repository) {
  return Object.freeze({
    loadIndex() {
      return repository.loadIndex();
    },
    normalizeAction(action) {
      return normalizeFloatingOpenAction(action);
    },
  });
}

