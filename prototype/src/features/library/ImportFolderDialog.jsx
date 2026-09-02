import { useMemo, useRef, useState } from "react";
import { FolderOpen } from "@phosphor-icons/react";
import { Dialog } from "../../components/Dialog.jsx";
import {
  DEFAULT_RECURSIVE_IMPORT_POLICY,
  RECURSIVE_IMPORT_DEPTH_OPTIONS,
  RECURSIVE_IMPORT_ENTRY_OPTIONS,
  describeRecursiveImportPolicy,
  normalizeRecursiveImportPolicy,
} from "./recursiveImportModel.js";

export function ImportFolderDialog({ folderName, busy = false, onCancel, onConfirm }) {
  const [mode, setMode] = useState("register");
  const [policy, setPolicy] = useState(DEFAULT_RECURSIVE_IMPORT_POLICY);
  const registerRef = useRef(null);
  const normalizedPolicy = useMemo(() => normalizeRecursiveImportPolicy(policy), [policy]);
  const isRecursive = mode === "recursive";

  function updatePolicy(field, value) {
    setPolicy((current) => normalizeRecursiveImportPolicy({ ...current, [field]: value }));
  }

  function confirm() {
    onConfirm?.(mode, normalizedPolicy);
  }

  return (
    <Dialog
      title="导入文件夹"
      description={`已选择“${folderName || "所选文件夹"}”。请选择本次导入方式；导入只保存索引元数据，不会修改原文件。`}
      busy={busy}
      onClose={onCancel}
      initialFocusRef={registerRef}
      className="folder-import-dialog"
      footer={(
        <>
          <button type="button" className="dialog-button dialog-button-secondary" disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" className="dialog-button dialog-button-primary" disabled={busy} onClick={confirm}>{isRecursive ? "开始扫描并导入" : "登记文件夹"}</button>
        </>
      )}
    >
      <fieldset className="folder-import-modes">
        <legend>导入方式</legend>
        <label className="folder-import-mode">
          <input ref={registerRef} type="radio" name="folder-import-mode" value="register" checked={!isRecursive} onChange={() => setMode("register")} />
          <span><strong>登记文件夹</strong><small>只保存这个文件夹本身，之后可以按需浏览子目录。</small></span>
        </label>
        <label className="folder-import-mode">
          <input type="radio" name="folder-import-mode" value="recursive" checked={isRecursive} onChange={() => setMode("recursive")} />
          <span><strong>导入文件夹内资料</strong><small>扫描当前文件夹及子目录，按下面策略登记普通文件。</small></span>
        </label>
      </fieldset>

      {isRecursive ? (
        <div className="recursive-import-options">
          <div className="recursive-import-scope">
            <FolderOpen size={18} weight="regular" aria-hidden="true" />
            <div><strong>扫描范围</strong><span>所选文件夹及其子目录；不会跟随符号链接或 Windows 重解析点。</span></div>
          </div>
          <label className="dialog-field" htmlFor="recursive-import-depth">
            <span>递归深度上限</span>
            <select id="recursive-import-depth" value={normalizedPolicy.maxDepth} onChange={(event) => updatePolicy("maxDepth", Number(event.target.value))}>
              {RECURSIVE_IMPORT_DEPTH_OPTIONS.map((value) => <option key={value} value={value}>{value} 层</option>)}
            </select>
          </label>
          <label className="dialog-field" htmlFor="recursive-import-entries">
            <span>最大登记条目</span>
            <select id="recursive-import-entries" value={normalizedPolicy.maxEntries} onChange={(event) => updatePolicy("maxEntries", Number(event.target.value))}>
              {RECURSIVE_IMPORT_ENTRY_OPTIONS.map((value) => <option key={value} value={value}>{value.toLocaleString("zh-CN")} 项</option>)}
            </select>
          </label>
          <label className="dialog-checkbox">
            <input type="checkbox" checked={normalizedPolicy.skipHidden} onChange={(event) => updatePolicy("skipHidden", event.target.checked)} />
            <span>跳过隐藏和系统项</span>
          </label>
          <label className="dialog-checkbox">
            <input type="checkbox" checked={normalizedPolicy.includeUnsupported} onChange={(event) => updatePolicy("includeUnsupported", event.target.checked)} />
            <span>包含暂不支持预览的普通文件</span>
          </label>
          <p className="dialog-hint">{describeRecursiveImportPolicy(normalizedPolicy)}。扫描任务最多持续 30 秒，可随时取消；取消或超时会保留已完成部分。</p>
        </div>
      ) : (
        <p className="dialog-hint folder-import-register-hint">登记后只在索引中保留文件夹路径和元数据，不会自动导入子文件，也不会复制、移动或删除原文件。</p>
      )}
    </Dialog>
  );
}
