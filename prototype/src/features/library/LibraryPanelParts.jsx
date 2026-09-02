import { useEffect, useRef } from "react";
import {
  Copy,
  FolderOpen,
  Funnel,
  X,
} from "@phosphor-icons/react";
import {
  getDisplayType,
  getEntryLocation,
  getMetadataSearchHit,
  getSearchTextRanges,
} from "./libraryModel";

const MODIFIED_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function LibraryFilterMenu({ files, groups, filters, onChange, onManageGroups }) {
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const types = [...new Set((files || []).map(getDisplayType).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const tags = [...new Set((files || []).flatMap((file) => Array.isArray(file.tags) ? file.tags : []))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const count = Number(Boolean(filters.type)) + filters.tags.length + filters.groupIds.length;

  function closeMenu(restoreFocus = false) {
    if (!menuRef.current?.open) return;
    menuRef.current.open = false;
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    function closeOnOutsidePointer(event) {
      if (!menuRef.current?.contains(event.target)) closeMenu();
    }
    function closeOnEscape(event) {
      if (event.key === "Escape" && menuRef.current?.open) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function toggle(key, value) {
    const current = filters[key];
    onChange({ ...filters, [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] });
  }

  return (
    <details ref={menuRef} className="library-filter-menu">
      <summary ref={triggerRef} className="filter-menu-trigger"><Funnel size={16} weight="regular" aria-hidden="true" /><span>筛选</span>{count > 0 && <strong>{count}</strong>}</summary>
      <div className="filter-menu-content" role="group" aria-label="组合筛选">
        <label className="filter-type-control"><span>类型</span><select value={filters.type} onChange={(event) => onChange({ ...filters, type: event.target.value })}><option value="">全部类型</option>{types.map((type) => <option value={type} key={type}>{type}</option>)}</select></label>
        <FilterCheckboxes legend="分组" values={groups.map((group) => ({ value: group.id, label: group.name }))} selected={filters.groupIds} onToggle={(value) => toggle("groupIds", value)} emptyLabel="还没有分组" />
        <FilterCheckboxes legend="标签" values={tags.map((tag) => ({ value: tag, label: tag }))} selected={filters.tags} onToggle={(value) => toggle("tags", value)} emptyLabel="还没有标签" />
        <div className="filter-menu-actions">
          <button type="button" className="text-button" disabled={!count} onClick={() => onChange({ type: "", tags: [], groupIds: [] })}>清除筛选</button>
          <button type="button" className="text-button" onClick={() => { closeMenu(); onManageGroups?.(); }}>管理分组</button>
        </div>
      </div>
    </details>
  );
}

function FilterCheckboxes({ legend, values, selected, onToggle, emptyLabel }) {
  return (
    <fieldset className="filter-checkboxes">
      <legend>{legend}</legend>
      {values.length ? values.map(({ value, label }) => <label key={value}><input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} /><span>{label}</span></label>) : <span className="filter-empty-label">{emptyLabel}</span>}
    </fieldset>
  );
}

export function getActiveFilterChips(filters, groups) {
  const chips = [];
  if (filters.type) chips.push({ key: "type", label: `类型：${filters.type}` });
  filters.tags.forEach((tag) => chips.push({ key: `tag:${tag}`, value: tag, label: `标签：${tag}` }));
  filters.groupIds.forEach((groupId) => {
    const groupName = groups.find((group) => group.id === groupId)?.name || "未知分组";
    chips.push({ key: `group:${groupId}`, value: groupId, label: `分组：${groupName}` });
  });
  return chips;
}

export function EntryLocation({ entry, directoryView, onCopy, onReveal }) {
  const location = getEntryLocation(entry, directoryView);
  const canReveal = !entry.invalid
    && typeof onReveal === "function"
    && (!directoryView || (entry.directoryId && Array.isArray(entry.relativePath)));
  return (
    <details className="file-location" onClick={(event) => event.stopPropagation()}>
      <summary title={location.fullPath}><FolderOpen size={14} weight="regular" aria-hidden="true" /><span>{location.displayPath}</span></summary>
      <div className="file-location-expanded">
        <code>{location.fullPath}</code>
        <button type="button" className="icon-button" aria-label="复制资料位置" title="复制位置" onClick={() => onCopy?.(entry, directoryView)}><Copy size={15} weight="regular" aria-hidden="true" /></button>
        {canReveal && <button type="button" className="location-reveal-button" onClick={() => onReveal(entry, directoryView)}><FolderOpen size={14} weight="regular" aria-hidden="true" /><span>定位</span></button>}
      </div>
    </details>
  );
}

export function EntryMetadata({ entry, onTagClick }) {
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  if (!tags.length) return null;
  return (
    <div className="file-entry-metadata">
      {tags.slice(0, 4).map((tag) => onTagClick ? (
        <button type="button" className="file-tag-chip" key={tag} title={`按标签“${tag}”筛选`} onClick={(event) => { event.stopPropagation(); onTagClick(tag); }}>{tag}</button>
      ) : <span className="file-tag-chip" key={tag}>{tag}</span>)}
      {tags.length > 4 && <span className="file-tag-overflow">+{tags.length - 4}</span>}
    </div>
  );
}

export function getGroupName(entry, groups) {
  return groups.find((group) => group.id === entry.groupId)?.name || "未分组";
}

export function getModifiedLabel(file) {
  if (file.modified) return file.modified;
  if (!Number.isFinite(file.modifiedAt) || file.modifiedAt <= 0) return "未知";
  return MODIFIED_FORMATTER.format(new Date(file.modifiedAt * 1000));
}

export function getNavigationLabel(activeNav) {
  return { recent: "最近添加", "recent-opened": "最近打开", favorites: "收藏", invalid: "失效路径" }[activeNav] || "资料库";
}

export function SearchHitSummary({ entry, searchMode, searchResult, searchQuery, useRegex, directoryView, groups = [] }) {
  if (!searchQuery) return null;
  if (searchMode === "content") {
    if (!searchResult) return null;
    const snippet = searchResult.snippets?.[0];
    return (
      <div className="search-hit-summary" aria-label="正文搜索命中">
        <span className="search-hit-field">命中正文 · {searchResult.matchCount}{searchResult.matchesTruncated ? "+" : ""} 处</span>
        {snippet && <HighlightedText text={snippet.text} ranges={snippet.ranges} characterRanges />}
      </div>
    );
  }
  const hit = getMetadataSearchHit(entry, searchQuery, { useRegex, directoryView, groups });
  if (!hit) return null;
  const ranges = hit.key === "name" ? getSearchTextRanges(hit.value, searchQuery, useRegex) : [];
  return (
    <div className="search-hit-summary" aria-label={`命中${hit.label}`}>
      <span className="search-hit-field">命中{hit.label}</span>
      {ranges.length > 0 && <HighlightedText text={hit.value} ranges={ranges} />}
    </div>
  );
}

function HighlightedText({ text, ranges, characterRanges = false }) {
  const value = String(text ?? "");
  const segments = [];
  let cursor = 0;
  for (const range of ranges || []) {
    const start = Math.max(cursor, Number(range.start) || 0);
    const end = Math.max(start, Number(range.end) || 0);
    const before = characterRanges ? Array.from(value).slice(cursor, start).join("") : value.slice(cursor, start);
    const matched = characterRanges ? Array.from(value).slice(start, end).join("") : value.slice(start, end);
    if (before) segments.push(<span key={`before-${cursor}`}>{before}</span>);
    if (matched) segments.push(<mark key={`match-${start}-${end}`}>{matched}</mark>);
    cursor = end;
  }
  const tail = characterRanges ? Array.from(value).slice(cursor).join("") : value.slice(cursor);
  if (tail) segments.push(<span key={`tail-${cursor}`}>{tail}</span>);
  return <span className="search-hit-snippet">{segments.length ? segments : value}</span>;
}

export function getEmptyTitle({ activeNav, directoryView, searchQuery, filters }) {
  if (searchQuery) return "没有找到匹配的资料";
  if (filters.type || filters.tags.length || filters.groupIds.length) return "没有符合筛选条件的资料";
  if (directoryView) return "文件夹为空";
  if (activeNav === "favorites") return "还没有收藏的资料";
  if (activeNav === "invalid") return "没有失效路径";
  if (activeNav === "recent") return "还没有最近添加的资料";
  if (activeNav === "recent-opened") return "还没有最近打开的资料";
  return "还没有登记资料";
}

export function getEmptyDescription({ activeNav, directoryView, searchQuery, filters }) {
  if (searchQuery) return "可以清空搜索，或导入新的资料。";
  if (filters.type || filters.tags.length || filters.groupIds.length) return "清除筛选，或调整类型、标签和分组。";
  if (directoryView) return "返回上一级，或选择其他文件夹继续浏览。";
  if (activeNav === "favorites") return "在资料行操作中添加收藏。";
  if (activeNav === "invalid") return "失效记录会在原路径不可用时显示。";
  if (activeNav === "recent-opened") return "成功预览或用默认程序打开的资料会显示在这里。";
  return "从上方选择文件或文件夹开始建立索引。";
}

export function getEmptyActions({ activeNav, directoryView, searchQuery, filters, onClearSearch, onClearFilters, onOpenBreadcrumb, onImport, onManageGroups }) {
  if (searchQuery) return <button type="button" className="text-button" onClick={onClearSearch}>清空搜索</button>;
  if (filters.type || filters.tags.length || filters.groupIds.length) return <button type="button" className="text-button" onClick={onClearFilters}>清除筛选</button>;
  if (directoryView) return <button type="button" className="text-button" onClick={() => onOpenBreadcrumb(-1)}>返回资料库</button>;
  if (activeNav === "library" || activeNav === "recent" || activeNav === "recent-opened" || activeNav === "favorites" || activeNav === "invalid") return <button type="button" className="text-button" onClick={onImport}>导入资料</button>;
  if (onManageGroups) return <button type="button" className="text-button" onClick={onManageGroups}>管理分组</button>;
  return null;
}

export function EmptyState({ icon, title, description, actions }) {
  return <div className="empty-state">{icon}<strong>{title}</strong><span>{description}</span>{actions && <div className="empty-state-actions">{actions}</div>}</div>;
}
