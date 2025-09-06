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
    return filtered ? `${start} style="${filtered}"` : start;
  });
  out = out.replace(/\scolor\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\scolor\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\sstyle\s*=\s*""/gi, "");
  return out;
}

export default function Row({ i }) {
  const { abs, getLine, hl, lineNums, matches, cur, raw } = useSearch();
  const txt = getLine(i);
  const n = abs(i);
  const hit = hl && matches[cur] === n;

  const html = useMemo(() => {
    const base = raw ? escapeHtml(txt) : txt;
    return hit && !raw ? stripColors(base) : base;
  }, [txt, raw, hit]);

  const num = String(n + 1);

  return (
    <div
      className="log-row"
      style={{
        position: "relative",
        height: ROW,
        whiteSpace: "pre",
        fontFamily: "monospace",
        background: hit ? "#333" : "",
        color: hit ? "#fff" : "",
      }}
    >
      <span
        className={`lnum ${lineNums ? "on" : ""}`}
        style={{
          position: "absolute",
          left: 0,
          width: "var(--gutter, 0px)",
          textAlign: "right",
          paddingRight: 8,
          userSelect: "none",
        }}
      >
        {num}
      </span>
      <span
        className="log-text"
        style={{
          display: "block",
          paddingLeft: lineNums ? "var(--gutter, 0px)" : 0,
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
