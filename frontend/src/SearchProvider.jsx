import { useState, useRef } from "react";
import SearchCtx from "./SearchContext";

export default function SearchProvider({ goLine, abs, getLine, children }) {
  const [hl, setHl] = useState(true);
  const [raw, setRaw] = useState(false);
  const [matches, setMatches] = useState([]);
  const [cur, setCur] = useState(0);
  const [searching, setSearching] = useState(false);
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

  const controls = (
    <>
      <input
        placeholder="search…"
        style={{ fontSize: 12, padding: "2px 4px", width: 120 }}
        onChange={(e) => {
          const v = e.target.value;
          clearTimeout(debounce.current);
          debounce.current = setTimeout(() => run(v), 300);
        }}
      />
      <button
        onClick={() => step(-1)}
        disabled={!matches.length}
      >
        ◀
      </button>
      <button
        onClick={() => step(1)}
        disabled={!matches.length}
      >
        ▶
      </button>
      {searching ? (
        <div
          style={{
            width: 16,
            height: 16,
            border: "2px solid #777",
            borderTop: "2px solid #fff",
            borderRadius: "50%",
            animation: "spin .8s linear infinite",
          }}
        />
      ) : (
        <span style={{ fontSize: 12 }}>{matches.length} matches</span>
      )}
      <button onClick={() => setHl(!hl)}>{hl ? "HL on" : "HL off"}</button>
      <button onClick={() => setRaw(!raw)}>{raw ? "Rendered" : "Raw"}</button>
    </>
  );

  const value = { abs, getLine, hl, raw, matches, cur, controls };
  return <SearchCtx.Provider value={value}>{children}</SearchCtx.Provider>;
}
