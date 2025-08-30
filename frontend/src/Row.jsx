import { ROW } from "./constants";
import useSearch from "./useSearch";

export default function Row({ i }) {
  const { abs, getLine, hl, matches, cur, raw } = useSearch();
  const txt = getLine(i);
  const n = abs(i);
  const hit = hl && matches[cur] === n;
  const html = raw
    ? txt.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    : txt;
  return (
    <div
      style={{
        height: ROW,
        whiteSpace: "pre",
        fontFamily: "monospace",
        background: hit ? "#333" : "",
        color: hit ? "#fff" : "",
      }}
    >
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
