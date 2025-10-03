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
  const byNameAsc = (a, b) =>
    a.n.localeCompare(b.n, undefined, { numeric: true, sensitivity: "base" });
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

const Row = ({ icon, label, depth, sel, onClick }) => (
  <div
    className={`row${sel ? " selected" : ""}`}
    style={{ paddingLeft: depth * 18 + 8 }}
    onClick={onClick}
  >
    <span style={{ width: 16, textAlign: "center" }}>{icon}</span>
    <span
      style={{
        flex: 1,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {label}
    </span>
  </div>
);

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
}) {
  const opened = open[n] ?? true;
  const toggle = () => setOpen({ ...open, [n]: !opened });
  const lbl = d === 0 ? labelOverride : n;
  const files = useMemo(
    () => sortFiles(node.f || [], sortMode, mtime),
    [node.f, sortMode, mtime],
  );

  return (
    <>
      <Row
        icon={opened ? "▾" : "▸"}
        label={lbl}
        depth={d}
        sel={false}
        onClick={toggle}
      />
      {opened &&
        files.map((f) => (
          <Row
            key={f.p}
            icon="📄"
            label={f.n}
            depth={d + 1}
            sel={sel === f.p}
            onClick={() => onSel(f.p)}
          />
        ))}
      {opened &&
        Object.entries(node.d).map(([k, v]) => (
          <Folder
            key={k}
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
      <aside className="sidebar">
        <div className="toolbar">
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

        {loading ? (
          <div style={{ padding: 20, textAlign: "center" }}>
            <div
              style={{
                width: 24,
                height: 24,
                border: "3px solid #6b7280",
                borderTop: "3px solid #e5e7eb",
                borderRadius: "50%",
                animation: "spin .8s linear infinite",
                margin: "0 auto",
              }}
            />
          </div>
        ) : (
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
        )}
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
