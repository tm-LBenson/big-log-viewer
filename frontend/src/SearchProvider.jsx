import { useState, useRef } from "react";
import SearchCtx from "./SearchContext";

export default function SearchProvider({
  goLine,
  abs,
  getLine,
  count,
  children,
}) {
  const [hl, setHl] = useState(true);
  const [raw, setRaw] = useState(false);
  const [lineNums, setLineNums] = useState(false);
  const [matches, setMatches] = useState([]);
  const [cur, setCur] = useState(0);
  const [searching, setSearching] = useState(false);
  const [fromLine, setFromLine] = useState("");
  const [toLine, setToLine] = useState("");
  const [lineJump, setLineJump] = useState("");
  const debounce = useRef(null);

  const run = (q) => {
    if (!q) {
      setSearching(false);
      setMatches([]);
      setCur(0);
      return;
    }
    setSearching(true);
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then(({ Matches = [] }) => {
        setSearching(false);
        setMatches(Matches);
        setCur(0);
        if (Matches.length) goLine(Matches[0]);
      });
  };

  const step = (d) => {
    if (!matches.length) return;
    const j = (cur + d + matches.length) % matches.length;
    setCur(j);
    goLine(matches[j]);
  };

  const clampRange = () => {
    const total = count || 0;
    let s = parseInt(fromLine, 10);
    let e = parseInt(toLine, 10);
    if (!Number.isFinite(s)) s = 1;
    if (!Number.isFinite(e)) e = s;
    if (s < 1) s = 1;
    if (total > 0 && s > total) s = total;
    if (e < s) e = s;
    if (total > 0 && e > total) e = total;
    return { s, e };
  };

  const jumpOne = () => {
    const n = parseInt(lineJump, 10);
    if (!Number.isFinite(n)) return;
    goLine(n - 1);
  };

  const copyRange = async () => {
    const { s, e } = clampRange();
    const html = await fetch(`/api/range?start=${s - 1}&end=${e}`).then((r) =>
      r.text(),
    );
    const container = document.createElement("div");
    container.style.whiteSpace = "pre";
    container.innerHTML = html;
    const text = container.innerText;
    if (navigator.clipboard && window.ClipboardItem) {
      const item = new ClipboardItem({
        "text/html": new Blob([container.innerHTML], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  const downloadRange = () => {
    const { s, e } = clampRange();
    const name = `lines_${s}-${e}.html`;
    const url = `/api/range?start=${
      s - 1
    }&end=${e}&download=1&name=${encodeURIComponent(name)}`;
    window.open(url, "_blank");
  };

  const controls = (
    <>
      <input
        className="field"
        placeholder="search…"
        style={{ width: 160 }}
        onChange={(e) => {
          const v = e.target.value;
          clearTimeout(debounce.current);
          debounce.current = setTimeout(() => run(v), 300);
        }}
      />
      <button
        className="btn btn--icon"
        onClick={() => step(-1)}
        disabled={!matches.length}
        title="Prev"
      >
        ◀
      </button>
      <button
        className="btn btn--icon"
        onClick={() => step(1)}
        disabled={!matches.length}
        title="Next"
      >
        ▶
      </button>
      {searching ? (
        <div
          style={{
            width: 18,
            height: 18,
            border: "2px solid #6b7280",
            borderTop: "2px solid #e5e7eb",
            borderRadius: "50%",
            animation: "spin .8s linear infinite",
          }}
        />
      ) : (
        <span style={{ fontSize: 12, color: "var(--text-weak)" }}>
          {matches.length} matches
        </span>
      )}
      <button
        className="btn"
        onClick={() => setHl(!hl)}
      >
        {hl ? "HL on" : "HL off"}
      </button>
      <button
        className="btn"
        onClick={() => setRaw(!raw)}
      >
        {raw ? "Rendered" : "Raw"}
      </button>
      <button
        className="btn"
        onClick={() => setLineNums((v) => !v)}
      >
        Line Numbers
      </button>
    </>
  );

  const lineBar = (
    <div className="subbar-inner">
      <div className="group">
        <span className="label">Go to line</span>
        <input
          className="field"
          type="number"
          placeholder={count ? `1..${count}` : "line…"}
          value={lineJump}
          min={1}
          max={count || undefined}
          onChange={(e) => setLineJump(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") jumpOne();
          }}
          style={{ width: 160 }}
        />
        <button
          className="btn btn--primary"
          onClick={jumpOne}
        >
          Go
        </button>
      </div>

      <div className="group">
        <span className="label">Range</span>
        <input
          className="field"
          type="number"
          placeholder="from"
          value={fromLine}
          min={1}
          max={count || undefined}
          onChange={(e) => setFromLine(e.target.value)}
          style={{ width: 120 }}
        />
        <input
          className="field"
          type="number"
          placeholder="to"
          value={toLine}
          min={1}
          max={count || undefined}
          onChange={(e) => setToLine(e.target.value)}
          style={{ width: 120 }}
        />
        <button
          className="btn"
          onClick={copyRange}
        >
          Copy
        </button>
        <button
          className="btn"
          onClick={downloadRange}
        >
          Download
        </button>
      </div>
    </div>
  );

  const value = {
    abs,
    getLine,
    hl,
    raw,
    lineNums,
    matches,
    cur,
    controls,
    lineBar,
  };
  return <SearchCtx.Provider value={value}>{children}</SearchCtx.Provider>;
}
