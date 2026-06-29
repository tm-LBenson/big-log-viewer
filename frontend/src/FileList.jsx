import {
  useCallback,
  useEffect,
  useState,
  useMemo,
  useRef,
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import "./App.css";

const NAME_COMPARE = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

const formatBytes = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = n;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
};

const SIZE_FILTERS = [
  { label: "Any size", value: 0 },
  { label: "1 MB+", value: 1024 ** 2 },
  { label: "100 MB+", value: 100 * 1024 ** 2 },
  { label: "1 GB+", value: 1024 ** 3 },
  { label: "10 GB+", value: 10 * 1024 ** 3 },
];

const formatDateTime = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(n).toLocaleString();
};

const build = (list) => {
  const root = { d: {}, f: [] };
  list.forEach((rel) => {
    const parts = rel.split(/[\\/]/);
    let cur = root;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) (cur.f ||= []).push({ n: p, p: rel });
      else cur = cur.d[p] ||= { d: {}, f: [] };
    });
  });
  return root;
};

const normalizeList = (data) => {
  const raw = Array.isArray(data) ? data : Array.isArray(data?.files) ? data.files : [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") {
        return { path: entry, modTime: 0, size: 0 };
      }
      const path = String(entry?.path || entry?.Path || "");
      if (!path) return null;
      return {
        path,
        modTime: Number(entry?.modTime || entry?.ModTime || 0),
        size: Number(entry?.size || entry?.Size || 0),
      };
    })
    .filter(Boolean);
};

const sortFiles = (files, mode, mtime, size) => {
  const byNameAsc = (a, b) => NAME_COMPARE(a.n, b.n);
  const byNameDesc = (a, b) => -byNameAsc(a, b);
  const byMtimeDesc = (a, b) => {
    const ma = mtime.get(a.p),
      mb = mtime.get(b.p);
    if (ma == null && mb == null) return byNameAsc(a, b);
    if (ma == null) return 1;
    if (mb == null) return -1;
    if (mb !== ma) return mb - ma;
    return byNameAsc(a, b);
  };
  const byMtimeAsc = (a, b) => {
    const ma = mtime.get(a.p),
      mb = mtime.get(b.p);
    if (ma == null && mb == null) return byNameAsc(a, b);
    if (ma == null) return 1;
    if (mb == null) return -1;
    if (ma !== mb) return ma - mb;
    return byNameAsc(a, b);
  };
  const bySizeDesc = (a, b) => {
    const sa = Number(size?.get(a.p) || 0);
    const sb = Number(size?.get(b.p) || 0);
    if (sb !== sa) return sb - sa;
    return byNameAsc(a, b);
  };
  const bySizeAsc = (a, b) => {
    const sa = Number(size?.get(a.p) || 0);
    const sb = Number(size?.get(b.p) || 0);
    if (sa !== sb) return sa - sb;
    return byNameAsc(a, b);
  };
  const arr = files.slice();
  switch (mode) {
    case "name-desc":
      arr.sort(byNameDesc);
      break;
    case "mtime-desc":
      arr.sort(byMtimeDesc);
      break;
    case "mtime-asc":
      arr.sort(byMtimeAsc);
      break;
    case "size-desc":
      arr.sort(bySizeDesc);
      break;
    case "size-asc":
      arr.sort(bySizeAsc);
      break;
    default:
      arr.sort(byNameAsc);
  }
  return arr;
};

const sortFolderEntries = (entries, mode) => {
  const dirSort = mode === "name-desc"
    ? (a, b) => -NAME_COMPARE(a[0], b[0])
    : (a, b) => NAME_COMPARE(a[0], b[0]);
  return entries.slice().sort(dirSort);
};

function FolderGlyph({ open }) {
  return (
    <svg
      viewBox="0 0 20 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 5.25c0-.97.78-1.75 1.75-1.75h3.1c.48 0 .95.2 1.27.56L9.7 5.2h5.05c.97 0 1.75.78 1.75 1.75v5.8c0 .97-.78 1.75-1.75 1.75H4.25c-.97 0-1.75-.78-1.75-1.75v-7.5Z"
        fill="currentColor"
        opacity={open ? "0.26" : "0.14"}
      />
      <path
        d="M2.5 5.25c0-.97.78-1.75 1.75-1.75h3.1c.48 0 .95.2 1.27.56L9.7 5.2h5.05c.97 0 1.75.78 1.75 1.75v5.8c0 .97-.78 1.75-1.75 1.75H4.25c-.97 0-1.75-.78-1.75-1.75v-7.5Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg
      viewBox="0 0 16 18"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 1.75h5l3.25 3.25v9.25c0 .97-.78 1.75-1.75 1.75h-6.5c-.97 0-1.75-.78-1.75-1.75V3.5C2.25 2.53 3.03 1.75 4 1.75Z"
        fill="currentColor"
        opacity="0.12"
      />
      <path
        d="M9 1.75v2.5c0 .55.45 1 1 1h2.25"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 1.75h5l3.25 3.25v9.25c0 .97-.78 1.75-1.75 1.75h-6.5c-.97 0-1.75-.78-1.75-1.75V3.5C2.25 2.53 3.03 1.75 4 1.75Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TreeRow({
  label,
  meta,
  detail,
  depth,
  selected,
  kind,
  open,
  onClick,
}) {
  const title = [label, meta, detail].filter(Boolean).join("\n");
  return (
    <button
      type="button"
      className={`tree-row tree-row--${kind}${selected ? " selected" : ""}`}
      style={{ paddingLeft: depth * 16 + 10 }}
      onClick={onClick}
      title={title}
    >
      <span
        className={`tree-row__twisty${kind === "folder" ? "" : " tree-row__twisty--spacer"}`}
        aria-hidden="true"
      >
        {kind === "folder" ? (open ? "▾" : "▸") : "•"}
      </span>
      <span className="tree-row__icon" aria-hidden="true">
        {kind === "folder" ? <FolderGlyph open={open} /> : <FileGlyph />}
      </span>
      <span className="tree-row__label">{label}</span>
      {meta ? <span className="tree-row__meta">{meta}</span> : null}
    </button>
  );
}

function Folder({
  n,
  node,
  d,
  open,
  setOpen,
  sel,
  onSel,
  labelOverride,
  sortMode,
  mtime,
  size,
  pathKey = "",
}) {
  const key = pathKey || "__root__";
  const opened = open[key] ?? true;
  const toggle = () => setOpen((prev) => ({ ...prev, [key]: !opened }));
  const label = d === 0 ? labelOverride : n;
  const files = useMemo(
    () => sortFiles(node.f || [], sortMode, mtime, size),
    [node.f, sortMode, mtime, size],
  );
  const folders = useMemo(
    () => sortFolderEntries(Object.entries(node.d || {}), sortMode),
    [node.d, sortMode],
  );

  return (
    <>
      <TreeRow
        kind="folder"
        label={label}
        depth={d}
        selected={false}
        open={opened}
        onClick={toggle}
      />
      {opened &&
        folders.map(([k, v]) => {
          const childPath = pathKey ? `${pathKey}/${k}` : k;
          return (
            <Folder
              key={childPath}
              n={k}
              node={v}
              d={d + 1}
              open={open}
              setOpen={setOpen}
              sel={sel}
              onSel={onSel}
              labelOverride={labelOverride}
              sortMode={sortMode}
              mtime={mtime}
              size={size}
              pathKey={childPath}
            />
          );
        })}
      {opened &&
        files.map((f) => {
          const fileSize = size?.get(f.p) || 0;
          const modified = mtime?.get(f.p) || 0;
          return (
            <TreeRow
              key={f.p}
              kind="file"
              label={f.n}
              meta={formatBytes(fileSize)}
              detail={formatDateTime(modified)}
              depth={d + 1}
              selected={sel === f.p}
              onClick={() => onSel(f.p)}
            />
          );
        })}
    </>
  );
}

export default forwardRef(function FileList({ sel, recentFiles = [], onSel, onLoaded }, ref) {
  const [paths, setPaths] = useState([]);
  const [open, setOpen] = useState({});
  const [loading, setLoading] = useState(true);
  const [sortOpen, setSortOpen] = useState(false);
  const [sortMode, setSortMode] = useState("mtime-desc");
  const [filterText, setFilterText] = useState("");
  const [sizeFilter, setSizeFilter] = useState(0);
  const [mtimeMap, setMtimeMap] = useState(new Map());
  const [sizeMap, setSizeMap] = useState(new Map());
  const [rootLabel, setRootLabel] = useState("logs");
  const sortBtnRef = useRef(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  const fetchRoot = useCallback(async () => {
    try {
      const d = await fetch("/api/root").then((r) => r.json());
      const p = d.Path || "";
      setRootLabel(p ? p.split(/[\\/]/).pop() : "logs");
    } catch {
      //
    }
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    await fetchRoot();
    const data = await fetch("/api/list?details=1")
      .then((r) => r.json())
      .catch(() => []);
    const items = normalizeList(data);
    const arr = items.map((item) => item.path);
    setMtimeMap(new Map(items.map((item) => [item.path, item.modTime])));
    setSizeMap(new Map(items.map((item) => [item.path, item.size])));
    setPaths(arr);
    setLoading(false);
    onLoaded?.(arr);
  }, [fetchRoot, onLoaded]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    const onDocClick = (e) => {
      const menuEl = document.getElementById("sort-menu");
      const inMenu = menuEl && menuEl.contains(e.target);
      const inBtn = sortBtnRef.current && sortBtnRef.current.contains(e.target);
      if (!inMenu && !inBtn) setSortOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useLayoutEffect(() => {
    if (!sortOpen || !sortBtnRef.current) return;
    const r = sortBtnRef.current.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 6, left: r.left });
  }, [sortOpen]);

  useImperativeHandle(ref, () => ({ reload: () => fetchList() }));

  const visiblePaths = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    const minSize = Number(sizeFilter || 0);
    return paths.filter((p) => {
      if (needle && !p.toLowerCase().includes(needle)) return false;
      if (minSize > 0 && Number(sizeMap.get(p) || 0) < minSize) return false;
      return true;
    });
  }, [filterText, paths, sizeFilter, sizeMap]);
  const tree = useMemo(() => build(visiblePaths), [visiblePaths]);
  const pathSet = useMemo(() => new Set(paths), [paths]);
  const visibleRecentFiles = useMemo(
    () => recentFiles.filter((path) => pathSet.has(path)).slice(0, 6),
    [pathSet, recentFiles],
  );
  const countLabel =
    visiblePaths.length === paths.length
      ? paths.length.toLocaleString()
      : `${visiblePaths.length.toLocaleString()} / ${paths.length.toLocaleString()}`;

  return (
    <>
      <aside className="sidebar sidebar--explorer">
        <div className="sidebar-head">
          <div className="sidebar-head__eyebrow">Explorer</div>
          <div className="sidebar-head__title-row">
            <div className="sidebar-head__title">Log files</div>
            <div className="sidebar-head__meta">{countLabel}</div>
          </div>
        </div>

        <div className="toolbar sidebar-toolbar">
          <input
            className="field sidebar-filter"
            type="search"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="filter files..."
            aria-label="Filter log files"
          />
          <select
            className="field sidebar-size-filter"
            value={sizeFilter}
            onChange={(e) => setSizeFilter(Number(e.target.value))}
            aria-label="Filter by minimum file size"
          >
            {SIZE_FILTERS.map((item) => (
              <option
                key={item.value}
                value={item.value}
              >
                {item.label}
              </option>
            ))}
          </select>
          <button
            className="btn btn--primary"
            onClick={() => fetchList()}
          >
            Refresh
          </button>
          <div
            style={{ position: "relative" }}
            ref={sortBtnRef}
          >
            <button
              className="btn"
              onClick={() => setSortOpen((v) => !v)}
            >
              Sort…
            </button>
          </div>
        </div>

        {!loading && visibleRecentFiles.length ? (
          <div className="sidebar-recent">
            <div className="sidebar-section-title">Recent</div>
            {visibleRecentFiles.map((path) => {
              const label = path.split(/[\\/]/).pop();
              return (
                <button
                  key={path}
                  type="button"
                  className={`sidebar-recent__item${sel === path ? " selected" : ""}`}
                  title={path}
                  onClick={() => onSel(path)}
                >
                  <span className="sidebar-recent__name">{label}</span>
                  <span className="sidebar-recent__meta">
                    {formatBytes(sizeMap.get(path))}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="sidebar-tree">
          {loading ? (
            <div className="sidebar-spinner-wrap">
              <div className="sidebar-spinner" />
            </div>
          ) : visiblePaths.length ? (
            <Folder
              n=""
              node={tree}
              d={0}
              open={open}
              setOpen={setOpen}
              sel={sel}
              onSel={onSel}
              labelOverride={rootLabel}
              sortMode={sortMode}
              mtime={mtimeMap}
              size={sizeMap}
            />
          ) : paths.length ? (
            <div className="sidebar-empty">No files match the current filters.</div>
          ) : (
            <div className="sidebar-empty">No files found in the current log root.</div>
          )}
        </div>
      </aside>

      {sortOpen &&
        createPortal(
          <div
            id="sort-menu"
            className="menu"
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              zIndex: 10000,
            }}
          >
            <MenuItem
              label="Modified (newest first)"
              active={sortMode === "mtime-desc"}
              onClick={() => {
                setSortMode("mtime-desc");
                setSortOpen(false);
              }}
            />
            <MenuItem
              label="Modified (oldest first)"
              active={sortMode === "mtime-asc"}
              onClick={() => {
                setSortMode("mtime-asc");
                setSortOpen(false);
              }}
            />
            <MenuItem
              label="Size (largest first)"
              active={sortMode === "size-desc"}
              onClick={() => {
                setSortMode("size-desc");
                setSortOpen(false);
              }}
            />
            <MenuItem
              label="Size (smallest first)"
              active={sortMode === "size-asc"}
              onClick={() => {
                setSortMode("size-asc");
                setSortOpen(false);
              }}
            />
            <div style={{ height: 6 }} />
            <MenuItem
              label="Name (A→Z)"
              active={sortMode === "name-asc"}
              onClick={() => {
                setSortMode("name-asc");
                setSortOpen(false);
              }}
            />
            <MenuItem
              label="Name (Z→A)"
              active={sortMode === "name-desc"}
              onClick={() => {
                setSortMode("name-desc");
                setSortOpen(false);
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
});

function MenuItem({ label, active, onClick }) {
  return (
    <div
      className="menu-item"
      onClick={onClick}
    >
      <span className="menu-check">{active ? "✓" : ""}</span>
      <span>{label}</span>
    </div>
  );
}
