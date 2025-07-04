import { useEffect, useState } from "react";
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

function Folder({ n, node, d, open, setOpen, sel, onSel, labelOverride }) {
  const opened = open[n] ?? true;
  const toggle = () => setOpen({ ...open, [n]: !opened });
  const lbl = d === 0 ? labelOverride : n;
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
        node.f.map((f) => (
          <Row
            key={f.p}
            icon="📄 "
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
          />
        ))}
    </>
  );
}

export default function FileList({ sel, onSel }) {
  const [tree, setTree] = useState({ d: {}, f: [] });
  const [open, setOpen] = useState({});
  const [modal, setModal] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/root")
      .then((r) => r.json())
      .then((d) => setPathInput(d.Path || ""));
    fetch("/api/list")
      .then((r) => r.json())
      .then((l) => {
        setTree(build(l || []));
        setLoading(false);
      });
  }, []);

  const save = async () => {
    await fetch("/api/root/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Path: pathInput }),
    });
    window.location.reload();
  };

  const rootLabel = pathInput ? pathInput.split(/[\\/]/).pop() : "logs";

  return (
    <>
      <aside className="sidebar">
        <div style={{ padding: 8, borderBottom: "1px solid #333" }}>
          <button onClick={() => setModal(true)}>Choose folder…</button>
        </div>

        {loading ? (
          <div style={{ padding: 20, textAlign: "center" }}>
            <div
              style={{
                width: 24,
                height: 24,
                border: "3px solid #777",
                borderTop: "3px solid #fff",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
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
          />
        )}
      </aside>

      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#fff",
              color: "#000",
              padding: 20,
              borderRadius: 8,
              width: 420,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Select log folder</h3>
            <input
              style={{ width: "100%", marginBottom: 12 }}
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
            />
            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
            >
              <button onClick={() => setModal(false)}>Cancel</button>
              <button onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}
        }
      `}</style>
    </>
  );
}
