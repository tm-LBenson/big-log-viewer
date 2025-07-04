import { FixedSizeList as List } from "react-window";
import { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";

const PAGE = 800;
const KEEP = 6;
const HEIGHT = window.innerHeight;
const ROW = 18;

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default function LogViewer({ path }) {
  const [lineCount, setLineCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [raw, setRaw] = useState(false);
  const [matches, setMatches] = useState([]);
  const [cur, setCur] = useState(0);
  const [hl, setHl] = useState(true);
  const [query, setQuery] = useState("");

  const listRef = useRef(null);
  const cache = useRef(new Map());
  const access = useRef(new Map());
  const pending = useRef(new Set());
  const timer = useRef(null);

  const touch = (p) => access.current.set(p, Date.now());
  const trim = () => {
    while (cache.current.size > KEEP) {
      const o = [...access.current.entries()].sort((a, b) => a[1] - b[1])[0][0];
      cache.current.delete(o);
      access.current.delete(o);
    }
  };

  const fetchPage = useCallback((p) => {
    if (cache.current.has(p) || pending.current.has(p)) return;
    pending.current.add(p);
    fetch(`/api/chunk?start=${p * PAGE}&count=${PAGE}`)
      .then((r) => r.json())
      .then((lines) => {
        cache.current.set(p, lines);
        touch(p);
        trim();
        pending.current.delete(p);
        if (p === 0) setReady(true);
      });
  }, []);

  useEffect(() => {
    setReady(false);
    setRaw(false);
    setMatches([]);
    setCur(0);
    cache.current.clear();
    access.current.clear();
    pending.current.clear();
    if (!path) {
      setLineCount(0);
      return;
    }
    fetch(`/api/open?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((d) => {
        setLineCount(d.Lines);
        fetchPage(0);
      });
  }, [path, fetchPage]);

  const handleRender = ({ visibleStartIndex, visibleStopIndex }) => {
    const a = Math.floor(visibleStartIndex / PAGE) - 1;
    const b = Math.floor(visibleStopIndex / PAGE) + 1;
    for (let p = a; p <= b; p++) if (p >= 0) fetchPage(p);
  };

  const Row = ({ index, style }) => {
    const p = Math.floor(index / PAGE);
    const idx = index % PAGE;
    const has = cache.current.has(p);
    if (has) touch(p);
    const line = has ? cache.current.get(p)[idx] || "" : "…";
    const html = raw ? esc(line) : line;
    const hit = hl && matches[cur] === index;
    return (
      <div
        style={{
          ...style,
          whiteSpace: "pre",
          fontFamily: "monospace",
          background: hit ? "#333" : "",
          color: hit ? "#fff" : "",
        }}
      >
        <span dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  };

  const runSearch = useCallback((q) => {
    if (!q) {
      setMatches([]);
      setCur(0);
      return;
    }
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((d) => {
        const m = d.Matches || [];
        setMatches(m);
        setCur(0);
        if (m.length) listRef.current?.scrollToItem(m[0], "start");
      });
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => runSearch(query), 300);
  }, [query, runSearch]);

  const jump = (n) => {
    if (!matches.length) return;
    const j = (cur + n + matches.length) % matches.length;
    setCur(j);
    listRef.current?.scrollToItem(matches[j], "start");
  };

  if (!path) return <main className="viewer center">select a log</main>;
  if (!ready) return <main className="viewer center">loading…</main>;

  return (
    <main
      className="viewer"
      style={{ position: "relative" }}
    >
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 1000,
          display: "flex",
          gap: 4,
        }}
      >
        <input
          placeholder="search…"
          style={{ fontSize: 12, padding: "2px 4px", width: 140 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          onClick={() => jump(-1)}
          disabled={!matches.length}
        >
          ◀
        </button>
        <button
          onClick={() => jump(1)}
          disabled={!matches.length}
        >
          ▶
        </button>
        <span
          style={{
            fontSize: 12,
            padding: "2px 4px",
            minWidth: 60,
            textAlign: "center",
          }}
        >
          {matches.length ? `${cur + 1}/${matches.length}` : "0/0"}
        </span>
        <button onClick={() => setHl((h) => !h)}>
          {hl ? "HL on" : "HL off"}
        </button>
        <button onClick={() => setRaw((r) => !r)}>
          {raw ? "Rendered" : "Raw"}
        </button>
      </div>

      <List
        ref={listRef}
        height={HEIGHT}
        itemCount={lineCount}
        itemSize={ROW}
        width="100%"
        overscanCount={50}
        onItemsRendered={handleRender}
      >
        {Row}
      </List>
    </main>
  );
}
