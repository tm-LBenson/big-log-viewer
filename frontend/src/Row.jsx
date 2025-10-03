import { useMemo } from "react";
import { ROW } from "./constants";
import useSearch from "./useSearch";

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function stripColors(html) {
  let out = html;
  out = out.replace(/<\/?font[^>]*>/gi, "");
  out = out.replace(/(<[^>]+)\sstyle="([^"]*)"/gi, (_, start, styles) => {
    const filtered = styles
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x && !/^(color|background(?:-color)?)\s*:/i.test(x))
      .join("; ");
    return `${start}${filtered ? ` style="${filtered}"` : ""}`;
  });
  return out;
}
function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function markWordInHtml(html, re) {
  const parts = html.split(/(<[^>]+>)/g);
  return parts
    .map((p) => (p.startsWith("<") ? p : p.replace(re, "<mark>$&</mark>")))
    .join("");
}

export default function Row({ i }) {
  const {
    abs,
    getLine,
    hl,
    hlMode,
    raw,
    wrap,
    lineNums,
    matches,
    cur,
    q,
    regex,
    caseSensitive,
    htmlLight,
  } = useSearch();

  const num = useMemo(() => {
    const n = abs(i) + 1;
    return String(n).padStart(6, " ");
  }, [i, abs]);

  const line = getLine(i) || "";

  const html = useMemo(() => {
    let v = line;
    if (raw) v = escapeHtml(v);

    if (!hl) return htmlLight ? v : stripColors(v);

    const isCur = matches[cur] === abs(i);
    if (!isCur) return htmlLight ? v : stripColors(v);

    if (hlMode === "line") {
      const body = htmlLight ? v : stripColors(v);
      return `<span class="hl-line">${body}</span>`;
    }

    const source = htmlLight ? v : stripColors(v);
    if (!q) return source;
    const flags = caseSensitive ? "g" : "gi";
    const re = regex ? new RegExp(q, flags) : new RegExp(escRe(q), flags);
    return markWordInHtml(source, re);
  }, [
    line,
    raw,
    hl,
    hlMode,
    matches,
    cur,
    q,
    regex,
    caseSensitive,
    abs,
    i,
    htmlLight,
  ]);

  return (
    <div
      className="log-row"
      style={{ minHeight: ROW, height: wrap ? "auto" : ROW }}
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
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
