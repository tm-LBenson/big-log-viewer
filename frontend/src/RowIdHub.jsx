import { useMemo } from "react";
import { ROW } from "./constants";
import useSearch from "./useSearch";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function parseIdHubFmt(line) {
  const re =
    /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+([^\s]+)\s+(?:-|–|—)\s*(.*)$/;
  const m = (line || "").match(re);
  if (!m) return null;
  const [, ts, lvl, logger, msg] = m;
  return { ts, lvl: (lvl || "").toLowerCase(), logger, msg: msg || "" };
}
function colorForLevel(lvl) {
  switch (lvl) {
    case "error":
      return "#EF4444";
    case "warn":
      return "#F59E0B";
    case "info":
      return "#3B82F6";
    case "debug":
      return "#6B7280";
    case "trace":
      return "#9CA3AF";
    default:
      return "#94A3B8";
  }
}
function looksJsonish(s) {
  const t = (s || "").trim();
  if (!t) return false;
  if (t[0] === "{" || t[0] === "[" || /"\s*:\s*/.test(t)) return true;
  if (/json\s*:$/i.test(t) || /Deserialized resources\s*:?\s*json/i.test(s))
    return true;
  return false;
}

export default function RowIdHub({ i }) {
  const { abs, getLine, wrap, lineNums, openInspectorAt } = useSearch();

  const idx = useMemo(() => abs(i), [i, abs]);
  const num = useMemo(() => String(idx + 1).padStart(6, " "), [idx]);
  const line = getLine(i) || "";
  const parsed = useMemo(() => parseIdHubFmt(line), [line]);
  const showInspect = looksJsonish(parsed?.msg || line);

  const html = useMemo(() => {
    if (parsed) {
      const ts = `<span style="color:#94A3B8">${escapeHtml(parsed.ts)}</span>`;
      const lvl = `<span style="color:${colorForLevel(
        parsed.lvl,
      )};font-weight:600">${parsed.lvl.toUpperCase()}</span>`;
      const lg = `<span style="color:#5DA7FF">${escapeHtml(
        parsed.logger,
      )}</span>`;
      const msg = escapeHtml(parsed.msg || "");
      return `${ts} ${lvl} ${lg} - ${msg}`;
    }
    return escapeHtml(line);
  }, [parsed, line]);

  return (
    <div
      className="log-row"
      style={{
        minHeight: ROW,
        height: wrap ? "auto" : ROW,
        display: "flex",
        alignItems: "stretch",
      }}
    >
      <span
        className="lnum"
        style={{ display: lineNums ? "inline-block" : "none" }}
      >
        {num}
      </span>
      <span
        className="log-text"
        style={{
          display: "block",
          paddingLeft: lineNums ? "var(--gutter, 0px)" : 0,
          whiteSpace: wrap ? "pre-wrap" : "pre",
          wordBreak: wrap ? "break-word" : "normal",
          flex: "1 1 auto",
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {showInspect && (
        <button
          className="btn"
          onClick={() => openInspectorAt(i)}
          title="Inspect JSON"
          style={{ marginLeft: 8 }}
        >
          Inspect
        </button>
      )}
    </div>
  );
}
