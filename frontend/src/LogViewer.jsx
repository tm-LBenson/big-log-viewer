import { Virtuoso } from "react-virtuoso";
import { useEffect, useRef, useState, useCallback } from "react";
import "./App.css";

const ROW = 18,
  PAGE = 800,
  WINDOW_MAX = 300_000,
  HALF_WIN = WINDOW_MAX / 2,
  KEEP = 6,
  HANDLE = 40;
const HEIGHT = window.innerHeight,
  TRACK_H = HEIGHT - 100,
  RANGE = (TRACK_H - HANDLE) / 2,
  SPEED = 1500;

export default function LogViewer({ path }) {
  const [lineCount, setLineCount] = useState(0);
  const [windowCount, setWindowCount] = useState(WINDOW_MAX);
  const [ready, setReady] = useState(false);
  const [boot, setBoot] = useState(false);
  const [raw, setRaw] = useState(false);
  const [hl, setHl] = useState(true);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [cur, setCur] = useState(0);
  const [searching, setSearching] = useState(false);

  const base = useRef(0);
  const virt = useRef(null);
  const track = useRef(null);
  const cache = useRef(new Map());
  const pending = useRef(new Set());
  const debounce = useRef(null);
  const dragPix = useRef(0);
  const rafId = useRef(0);
  const lastTs = useRef(0);
  const mounted = useRef(false);
  const scrolled = useRef(false);

  const fetchPage = useCallback(
    (p) => {
      const s = p * PAGE;
      if (s < 0 || s >= lineCount) return;
      if (cache.current.has(p) || pending.current.has(p)) return;
      pending.current.add(p);
      fetch(`/api/chunk?start=${s}&count=${PAGE}`)
        .then((r) => r.json())
        .then((lines) => {
          cache.current.set(p, lines);
          pending.current.delete(p);
        });
    },
    [lineCount],
  );

  const ensurePages = useCallback(
    (f, t) => {
      const a = Math.floor(f / PAGE) - 1,
        b = Math.floor(t / PAGE) + 1;
      for (let p = a; p <= b; p++) if (p >= 0) fetchPage(p);
    },
    [fetchPage],
  );

  useEffect(() => {
    cache.current.clear();
    pending.current.clear();
    setReady(false);
    setBoot(false);
    setMatches([]);
    setCur(0);
    mounted.current = false;
    scrolled.current = false;
    base.current = 0;
    if (!path) {
      setLineCount(0);
      return;
    }
    fetch(`/api/open?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((d) => {
        setLineCount(d.Lines);
        setWindowCount(Math.min(WINDOW_MAX, d.Lines));
        setReady(true);
        return fetch(`/api/chunk?start=0&count=${PAGE}`);
      })
      .then((r) => r.json())
      .then((lines) => {
        cache.current.set(0, lines);
        setBoot(true);
      });
  }, [path]);

  const abs = (i) => base.current + i;
  const getLine = (i) => {
    const n = abs(i);
    if (n >= lineCount) return "";
    const p = Math.floor(n / PAGE),
      o = n % PAGE;
    return cache.current.get(p)?.[o] ?? "…";
  };

  const Row = (i) => {
    const txt = getLine(i),
      n = abs(i),
      hit = hl && matches[cur] === n;
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
  };

  const resize = () =>
    setWindowCount(Math.min(WINDOW_MAX, lineCount - base.current));

  const goLine = (line) => {
    const tgt = Math.max(0, Math.min(lineCount - 1, line));
    if (tgt < base.current || tgt >= base.current + windowCount) {
      base.current = Math.max(
        0,
        Math.min(lineCount - WINDOW_MAX, tgt - HALF_WIN),
      );
      resize();
      mounted.current = false;
      virt.current?.scrollToIndex({
        index: tgt - base.current,
        align: "start",
      });
    } else
      virt.current?.scrollToIndex({
        index: tgt - base.current,
        align: "start",
      });
  };

  const onRange = ({ startIndex, endIndex }) => {
    ensurePages(abs(startIndex), abs(endIndex));
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!scrolled.current) return;
    if (startIndex > HALF_WIN && base.current + windowCount < lineCount) {
      base.current += HALF_WIN;
      resize();
      virt.current.scrollToIndex({
        index: startIndex - HALF_WIN,
        align: "start",
      });
    } else if (startIndex < 0 && base.current > 0) {
      base.current = Math.max(0, base.current - HALF_WIN);
      resize();
      virt.current.scrollToIndex({
        index: startIndex + HALF_WIN,
        align: "start",
      });
    }
  };

  const runSearch = (q) => {
    if (!q) {
      setSearching(false);
      setMatches([]);
      setCur(0);
      return;
    }
    setSearching(true);
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((d) => {
        setSearching(false);
        const hits = d.Matches || [];
        setMatches(hits);
        setCur(0);
        if (hits.length) goLine(hits[0]);
      });
  };

  const step = (dir) => {
    if (!matches.length) return;
    const j = (cur + dir + matches.length) % matches.length;
    setCur(j);
    goLine(matches[j]);
  };

  const animate = (ts) => {
    if (!lastTs.current) lastTs.current = ts;
    const rows =
      (dragPix.current / RANGE) * SPEED * ((ts - lastTs.current) / 1000);
    lastTs.current = ts;
    if (rows) virt.current.scrollBy({ top: rows * ROW });
    rafId.current = requestAnimationFrame(animate);
  };

  const startDrag = (e) => {
    e.preventDefault();
    scrolled.current = true;
    const mid = track.current.getBoundingClientRect().top + TRACK_H / 2;
    const move = (ev) => {
      let d = ev.clientY - mid;
      d = Math.max(-RANGE, Math.min(RANGE, d));
      dragPix.current = d;
      track.current.firstChild.style.top = `calc(50% + ${d}px - ${
        HANDLE / 2
      }px)`;
    };
    const up = () => {
      dragPix.current = 0;
      track.current.firstChild.style.top = `calc(50% - ${HANDLE / 2}px)`;
      cancelAnimationFrame(rafId.current);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    rafId.current = requestAnimationFrame(animate);
  };

  const boxRef = useRef(null);

  useEffect(() => {
    const currentRef = boxRef.current;
    if (!boot || !currentRef) return;
    const wheel = (e) => {
      e.preventDefault();
      scrolled.current = true;
      virt.current?.scrollBy({ top: e.deltaY });
    };
    currentRef.addEventListener("wheel", wheel, { passive: false });
    return () => {
      if (currentRef) {
        currentRef.removeEventListener("wheel", wheel);
      }
    };
  }, [boot]);

  if (!path) return <main className="viewer center">select a log</main>;
  if (!boot) return <main className="viewer center">loading…</main>;

  return (
    <main
      className="viewer"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <nav
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          padding: "6px 8px",
          borderBottom: "1px solid #444",
        }}
      >
        <button onClick={() => goLine(0)}>⤒</button>
        <button onClick={() => goLine(Math.floor(lineCount / 2))}>⇵</button>
        <button onClick={() => goLine(lineCount - 1)}>⤓</button>
        <input
          placeholder="search…"
          style={{ fontSize: 12, padding: "2px 4px", width: 120 }}
          value={query}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            clearTimeout(debounce.current);
            debounce.current = setTimeout(() => runSearch(v), 300);
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
        <button onClick={() => setHl((h) => !h)}>
          {hl ? "HL on" : "HL off"}
        </button>
        <button onClick={() => setRaw((r) => !r)}>
          {raw ? "Rendered" : "Raw"}
        </button>
      </nav>

      <div
        ref={boxRef}
        style={{ flex: 1, position: "relative" }}
      >
        <div
          ref={track}
          style={{
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
            right: 0,
            width: 20,
            height: TRACK_H,
            userSelect: "none",
            zIndex: 10,
          }}
        >
          <div
            onPointerDown={startDrag}
            style={{
              position: "absolute",
              top: `calc(50% - ${HANDLE / 2}px)`,
              left: 4,
              width: 12,
              height: HANDLE,
              background: "#888",
              borderRadius: 6,
            }}
          />
        </div>

        <Virtuoso
          ref={virt}
          totalCount={windowCount}
          itemContent={Row}
          style={{ height: "100%", width: "100%", paddingRight: 20 }}
          overscan={KEEP * ROW}
          rangeChanged={onRange}
        />
      </div>

      <style>{`@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}`}</style>
    </main>
  );
}
