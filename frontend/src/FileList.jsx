import {
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

const sortFiles = (files, mode, mtime) => {
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
  depth,
  selected,
  kind,
  open,
  onClick,
}) {
  return (
    <button
      type="button"
      className={`tree-row tree-row--${kind}${selected ? " selected" : ""}`}
      style={{ paddingLeft: depth * 16 + 10 }}
      onClick={onClick}
      title={label}
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
  pathKey = "",
}) {
  const key = pathKey || "__root__";
  const opened = open[key] ?? true;
  const toggle = () => setOpen((prev) => ({ ...prev, [key]: !opened }));
  const label = d === 0 ? labelOverride : n;
  const files = useMemo(
    () => sortFiles(node.f || [], sortMode, mtime),
    [node.f, sortMode, mtime],
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
              pathKey={childPath}
            />
          );
        })}
      {opened &&
        files.map((f) => (
          <TreeRow
            key={f.p}
            kind="file"
            label={f.n}
            depth={d + 1}
            selected={sel === f.p}
            onClick={() => onSel(f.p)}
          />
        ))}
    </>
  );
}

export default forwardRef(function FileList({ sel, onSel, onLoaded }, ref) {
  const [tree, setTree] = useState({ d: {}, f: [] });
  const [paths, setPaths] = useState([]);
  const [open, setOpen] = useState({});
  const [loading, setLoading] = useState(true);
  const [sortOpen, setSortOpen] = useState(false);
  const [sortMode, setSortMode] = useState("mtime-desc");
  const [mtimeMap, setMtimeMap] = useState(new Map());
  const [rootLabel, setRootLabel] = useState("logs");
  const sortBtnRef = useRef(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  const fetchRoot = async () => {
    try {
      const d = await fetch("/api/root").then((r) => r.json());
      const p = d.Path || "";
      setRootLabel(p ? p.split(/[\\/]/).pop() : "logs");
    } catch {
      //
    }
  };

  const fetchList = async () => {
    setLoading(true);
    await fetchRoot();
    const list = await fetch("/api/list")
      .then((r) => r.json())
      .catch(() => []);
    const arr = Array.isArray(list) ? list : [];
    setPaths(arr);
    setTree(build(arr));
    setLoading(false);
    onLoaded?.(arr);
  };

  useEffect(() => {
    fetchList();
  }, []);

  useEffect(() => {
    if (!paths.length) return;
    let cancelled = false;
    const limit = 8;
    let idx = 0;
    const next = async () => {
      while (idx < paths.length) {
        const start = idx,
          end = Math.min(paths.length, start + limit);
        idx = end;
        await Promise.all(
          paths.slice(start, end).map(async (p) => {
            try {
              const res = await fetch(
                `/api/raw?path=${encodeURIComponent(p)}`,
                { method: "HEAD" },
              );
              const lm = res.headers.get("Last-Modified");
              const t = lm ? Date.parse(lm) : 0;
              if (!cancelled) {
                setMtimeMap((prev) => {
                  if (prev.get(p) === t) return prev;
                  const m = new Map(prev);
                  m.set(p, t);
                  return m;
                });
              }
            } catch {
              if (!cancelled) {
                setMtimeMap((prev) => {
                  if (prev.has(p)) return prev;
                  const m = new Map(prev);
                  m.set(p, 0);
                  return m;
                });
              }
            }
          }),
        );
      }
    };
    next();
    return () => {
      cancelled = true;
    };
  }, [paths]);

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

  return (
    <>
      <aside className="sidebar sidebar--explorer">
        <div className="sidebar-head">
          <div className="sidebar-head__eyebrow">Explorer</div>
          <div className="sidebar-head__title-row">
            <div className="sidebar-head__title">Log files</div>
            <div className="sidebar-head__meta">{paths.length.toLocaleString()}</div>
          </div>
        </div>

        <div className="toolbar sidebar-toolbar">
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

        <div className="sidebar-tree">
          {loading ? (
            <div className="sidebar-spinner-wrap">
              <div className="sidebar-spinner" />
            </div>
          ) : paths.length ? (
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
            />
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
