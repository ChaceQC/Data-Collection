import { useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getOperationError } from "../../lib/ipcContracts.js";

export function useLibraryReposition({
  files, navigationContext, isTauriRuntime, fileActions, reloadIndexPreservingState,
  invalidateDirectoryRequest, setPreviewEntryId, setSelectedId, setDirectoryError, showToast,
}) {
  const requestRef = useRef(null);
  const latest = useRef({ files, navigationContext });
  latest.current = { files, navigationContext };
  useEffect(() => () => { requestRef.current = null; }, []);

  async function openRepositionPicker(file) {
    if (!isTauriRuntime) {
      showToast("重新定位本地路径请在桌面应用中执行");
      return;
    }
    if (!file?.id || !file.invalid || file.directoryId) return;
    const request = { id: file.id, kind: file.kind, path: file.path, context: navigationContext };
    requestRef.current = request;
    const isCurrent = () => requestRef.current === request && latest.current.navigationContext === request.context;
    try {
      const selected = await open({
        directory: request.kind === "folder", multiple: false,
        title: request.kind === "folder" ? "重新选择资料文件夹" : "重新选择资料文件",
      });
      if (!selected || !isCurrent()) return;
      const current = latest.current.files.find((entry) => entry.id === request.id);
      if (!current?.invalid || current.path !== request.path || current.kind !== request.kind) return;
      const result = await fileActions.reposition(request.id, selected);
      const synchronized = await reloadIndexPreservingState(result.revision);
      if (!isCurrent()) return;
      if (!synchronized) {
        showToast("路径已保存，但界面同步失败，请刷新");
        return;
      }
      invalidateDirectoryRequest();
      setPreviewEntryId((id) => id === request.id ? null : id);
      setDirectoryError?.(null);
      setSelectedId(request.id);
      showToast("路径已更新");
    } catch (error) {
      if (isCurrent()) showToast(getOperationError(error, "重新定位失败，请选择可访问的同类型路径"));
    } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
  }

  return { openRepositionPicker };
}
