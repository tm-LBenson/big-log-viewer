import useSearch from "./useSearch";
import { useMemo, useState } from "react";

function toSummary(obj) {
  if (!obj || typeof obj !== "object") return {};
  const s = {};
  if (
    obj.statistics &&
    obj.statistics.content &&
    obj.statistics.content.sourceStats
  ) {
    const st = obj.statistics.content.sourceStats;
    s.ingested = Number.isFinite(st.ingested) ? st.ingested : undefined;
    s.consolidated = Number.isFinite(st.consolidated)
      ? st.consolidated
      : undefined;
  }
  if (obj.sourceAdapterInfo) {
    s.adapter =
      obj.sourceAdapterInfo.className ||
      obj.sourceAdapterInfo.name ||
      undefined;
    s.jar = obj.sourceAdapterInfo.jarPath || undefined;
  }
  if (obj.authority && Array.isArray(obj.authority.sourceAuthorities)) {
    s.authorities = obj.authority.sourceAuthorities.length;
  }
  if (typeof obj.connectionInfo === "string") {
    try {
      s.connection = JSON.parse(obj.connectionInfo);
    } catch {}
  } else if (obj.connectionInfo && typeof obj.connectionInfo === "object") {
    s.connection = obj.connectionInfo;
  }
  return s;
}

function JsonValue({ value }) {
  if (value === null) return <span style={{ color: "#34D399" }}>null</span>;
  if (typeof value === "string")
    return <span style={{ color: "#F472B6" }}>"{value}"</span>;
  if (typeof value === "number" || typeof value === "bigint")
    return <span style={{ color: "#F59E0B" }}>{String(value)}</span>;
  if (typeof value === "boolean")
    return <span style={{ color: "#34D399" }}>{String(value)}</span>;
  return (
    <span style={{ color: "#93C5FD" }}>
      {Array.isArray(value) ? "[]" : "{}"}
    </span>
  );
}

function Node({ k, v, depth = 0 }) {
  const [open, setOpen] = useState(depth < 1);
  if (v && typeof v === "object") {
    const entries = Array.isArray(v)
      ? v.map((x, i) => [i, x])
      : Object.entries(v);
    return (
      <div style={{ marginLeft: depth ? 12 : 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            className="btn"
            onClick={() => setOpen(!open)}
            style={{ width: 22, padding: 0 }}
          >
            {open ? "▾" : "▸"}
          </button>
          <strong>{String(k)}</strong>
          <span style={{ color: "var(--text-weak)" }}>
            {Array.isArray(v) ? `Array(${v.length})` : "Object"}
          </span>
        </div>
        {open && (
          <div style={{ marginTop: 6 }}>
            {entries.map(([ck, cv]) => (
              <Node
                key={ck}
                k={ck}
                v={cv}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div style={{ marginLeft: depth ? 12 : 0, display: "flex", gap: 8 }}>
      <strong>{String(k)}</strong>
      <JsonValue value={v} />
    </div>
  );
}

export default function IdHubInspector() {
  const { inspect, closeInspector } = useSearch();
  const raw = inspect?.text || "";
  const obj = inspect?.json || null;
  const summary = useMemo(() => toSummary(obj), [obj]);

  return (
    <aside
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        bottom: 8,
        width: 420,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,.35)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 20,
      }}
    >
      <div
        className="toolbar"
        style={{ flex: "0 0 auto" }}
      >
        <strong>IDHub Inspector</strong>
        <div className="spacer" />
        <button
          className="btn"
          onClick={() =>
            navigator.clipboard.writeText(
              obj ? JSON.stringify(obj, null, 2) : raw,
            )
          }
          disabled={!raw && !obj}
        >
          Copy
        </button>
        <button
          className="btn"
          onClick={closeInspector}
        >
          Close
        </button>
      </div>

      <div style={{ padding: 12, overflow: "auto", flex: 1 }}>
        {obj ? (
          <>
            <section style={{ marginBottom: 12 }}>
              <h3 style={{ margin: "0 0 8px 0", fontSize: 14 }}>Summary</h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  gap: "6px 10px",
                }}
              >
                {"adapter" in summary && (
                  <>
                    <div>Adapter</div>
                    <div>{String(summary.adapter)}</div>
                  </>
                )}
                {"jar" in summary && (
                  <>
                    <div>Jar</div>
                    <div style={{ overflowWrap: "anywhere" }}>
                      {String(summary.jar)}
                    </div>
                  </>
                )}
                {"authorities" in summary && (
                  <>
                    <div>Authorities</div>
                    <div>{String(summary.authorities)}</div>
                  </>
                )}
                {"ingested" in summary && (
                  <>
                    <div>Ingested</div>
                    <div>{String(summary.ingested)}</div>
                  </>
                )}
                {"consolidated" in summary && (
                  <>
                    <div>Consolidated</div>
                    <div>{String(summary.consolidated)}</div>
                  </>
                )}
              </div>
              {summary.connection && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    Connection
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {typeof summary.connection === "string"
                      ? summary.connection
                      : JSON.stringify(summary.connection, null, 2)}
                  </div>
                </div>
              )}
            </section>

            <section>
              <h3 style={{ margin: "0 0 8px 0", fontSize: 14 }}>JSON</h3>
              {Object.entries(obj).map(([k, v]) => (
                <Node
                  key={k}
                  k={k}
                  v={v}
                  depth={0}
                />
              ))}
            </section>
          </>
        ) : (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {raw || "No JSON found on this log line."}
          </div>
        )}
      </div>
    </aside>
  );
}
