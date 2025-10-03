import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import SearchCtx from "./SearchContext";
import useSettings from "./useSettings";
import { PAGE } from "./constants";

function parseUserTs(s) {
  if (!s) return NaN;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  const m1 = s.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (m1) {
    const [_, y, mo, d, h, mi, se] = m1;
    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(se || 0),
    ).getTime();
  }
  return NaN;
}
function parseLineTs(line) {
  const iso = line.match(
    /\b(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
  );
  if (iso) {
    const [_, y, mo, d, h, mi, s] = iso;
    const dt = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
    const t = Date.parse(dt);
    if (!Number.isNaN(t)) return t;
  }
  const slash = line.match(
    /\b(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
  );
  if (slash) {
    const [_, y, mo, d, h, mi, s] = slash;
    const t = new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s),
    ).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return NaN;
}

export default function SearchProvider({
  goLine,
  abs,
  getLine,
  count,
  children,
}) {
  const s = useSettings().get();

  const [hl, setHl] = useState(true);
  const [hlMode, setHlMode] = useState("line");
  const [raw, setRaw] = useState(false);
  const [wrap, setWrap] = useState(!!s.wrap);
  const [lineNums, setLineNums] = useState(false);
  const htmlLight = !!s.htmlLight;

  const colors = {
    hover: s.hoverColorLight || "#eef2f7",
    line: s.lineHighlightColor || "#cfe3ff",
    mark: s.markColor || "#7dd3fc",
  };

  const [q, setQ] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [autoJump, setAutoJump] = useState(true);

  const [matches, setMatches] = useState([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [cur, setCur] = useState(0);
  const [searching, setSearching] = useState(false);

  const [fromLine, setFromLine] = useState("");
  const [toLine, setToLine] = useState("");
  const [lineJump, setLineJump] = useState("");
  const [tsInput, setTsInput] = useState("");

  const debounce = useRef(null);
  const runCtrl = useRef(null);

  const fetchTotalIfNeeded = async (query) => {
    try {
      const qp = new URLSearchParams({ q: query, count: "1" });
      if (regex) qp.set("regex", "1");
      if (caseSensitive) qp.set("case", "1");
      const r = await fetch(`/api/search?${qp.toString()}`);
      if (!r.ok) return;
      const d = await r.json();
      if (typeof d.Total === "number") setTotalMatches(d.Total);
    } catch {}
  };

  const run = (query) => {
    setQ(query);
    if (runCtrl.current) runCtrl.current.abort();
    if (!query) {
      setSearching(false);
      setMatches([]);
      setCur(0);
      setTotalMatches(0);
      return;
    }
    setSearching(true);
    const ctrl = new AbortController();
    runCtrl.current = ctrl;
    const qp = new URLSearchParams({ q: query });
    if (regex) qp.set("regex", "1");
    if (caseSensitive) qp.set("case", "1");
    fetch(`/api/search?${qp.toString()}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(async ({ Matches = [], Total }) => {
        if (ctrl.signal.aborted) return;
        setSearching(false);
        setMatches(Matches);
        setCur(0);
        setTotalMatches(typeof Total === "number" ? Total : Matches.length);
        if (typeof Total !== "number" && Matches.length >= 500) {
          fetchTotalIfNeeded(query);
        }
        if (Matches.length && autoJump) goLine(Matches[0]);
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setSearching(false);
        setMatches([]);
        setCur(0);
        setTotalMatches(0);
      });
  };

  const step = (d) => {
    if (!matches.length) return;
    const j = (cur + d + matches.length) % matches.length;
    const target = matches[j];
    setCur(j);
    if (typeof target === "number") goLine(target);
  };

  const clampRange = () => {
    const total = count || 0;
    let s1 = parseInt(fromLine, 10);
    let e1 = parseInt(toLine, 10);
    if (!Number.isFinite(s1)) s1 = 1;
    if (!Number.isFinite(e1)) e1 = s1;
    if (s1 < 1) s1 = 1;
    if (total > 0 && s1 > total) s1 = total;
    if (e1 < s1) e1 = s1;
    if (total > 0 && e1 > total) e1 = total;
    return { s: s1, e: e1 };
  };

  const jumpOne = () => {
    const n = parseInt(lineJump, 10);
    if (!Number.isFinite(n)) return;
    goLine(n - 1);
  };

  const copyRange = async () => {
    try {
      const { s: start, e: end } = clampRange();
      const html = await fetch(`/api/range?start=${start - 1}&end=${end}`).then(
        (r) => r.text(),
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
    } catch (e) {
      console.error(e);
    }
  };

  const downloadRange = () => {
    const { s: start, e: end } = clampRange();
    const name = `lines_${start}-${end}.html`;
    const url = `/api/range?start=${
      start - 1
    }&end=${end}&download=1&name=${encodeURIComponent(name)}`;
    window.open(url, "_blank");
  };

  async function fetchChunk(page, signal) {
    const start = page * PAGE;
    const r = await fetch(`/api/chunk?start=${start}&count=${PAGE}`, {
      signal,
    });
    if (!r.ok) throw new Error("chunk");
    return r.json();
  }
  async function getBounds(page, signal) {
    const lines = await fetchChunk(page, signal);
    let firstTs = NaN,
      lastTs = NaN,
      firstIdx = -1,
      lastIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = parseLineTs(lines[i]);
      if (!Number.isNaN(t)) {
        firstTs = t;
        firstIdx = i;
        break;
      }
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      const t = parseLineTs(lines[i]);
      if (!Number.isNaN(t)) {
        lastTs = t;
        lastIdx = i;
        break;
      }
    }
    return {
      lines,
      firstTs,
      lastTs,
      firstAbs: page * PAGE + firstIdx,
      lastAbs: page * PAGE + lastIdx,
    };
  }
  async function goToTimestamp(input) {
    const target = parseUserTs(input);
    if (Number.isNaN(target) || !count) return;
    const lastPage = Math.max(0, Math.floor((count - 1) / PAGE));
    const ctrl = new AbortController();
    const a = await getBounds(0, ctrl.signal);
    const b = await getBounds(lastPage, ctrl.signal);
    if (Number.isNaN(a.firstTs) || Number.isNaN(b.lastTs)) return;
    if (target <= a.firstTs) {
      goLine(Math.max(0, a.firstAbs));
      return;
    }
    if (target >= b.lastTs) {
      goLine(Math.max(0, b.lastAbs));
      return;
    }
    let lo = 0,
      hi = lastPage,
      found = null,
      iter = 0;
    while (lo <= hi && iter++ < 30) {
      const mid = Math.floor((lo + hi) / 2);
      const m = await getBounds(mid, ctrl.signal);
      const left = !Number.isNaN(m.firstTs) ? m.firstTs : m.lastTs;
      const right = !Number.isNaN(m.lastTs) ? m.lastTs : m.firstTs;
      if (Number.isNaN(left) && Number.isNaN(right)) {
        if (mid === lo) lo++;
        else hi--;
        continue;
      }
      if (target < left) {
        hi = mid - 1;
        continue;
      }
      if (target > right) {
        lo = mid + 1;
        continue;
      }
      let idx = m.firstAbs ?? mid * PAGE;
      for (let i = 0; i < m.lines.length; i++) {
        const t = parseLineTs(m.lines[i]);
        if (!Number.isNaN(t) && t >= target) {
          idx = mid * PAGE + i;
          break;
        }
      }
      found = idx;
      break;
    }
    if (found == null) found = a.firstAbs || 0;
    goLine(found);
  }

  useEffect(
    () => () => {
      clearTimeout(debounce.current);
      runCtrl.current?.abort();
    },
    [],
  );

  const [toolsOpen, setToolsOpen] = useState(false);
  const kebabRef = useRef(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    const onDoc = (e) => {
      const m = document.getElementById("search-tools-menu");
      const inMenu = m && m.contains(e.target);
      const inBtn = kebabRef.current && kebabRef.current.contains(e.target);
      if (!inMenu && !inBtn) setToolsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  useLayoutEffect(() => {
    if (!toolsOpen || !kebabRef.current) return;
    const r = kebabRef.current.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 6, left: r.left });
  }, [toolsOpen]);

  const controls = (
    <>
      <div className="searchrow">
        <div className="searchbox">
          <input
            className="field search-input"
            placeholder="search…"
            onChange={(e) => {
              const v = e.target.value;
              clearTimeout(debounce.current);
              debounce.current = setTimeout(() => run(v), 300);
            }}
            aria-label="Search"
          />
          <button
            ref={kebabRef}
            className="kebab"
            title="Search tools"
            onClick={() => setToolsOpen((v) => !v)}
          >
            ⋮
          </button>
        </div>

        <button
          className="btn btn--icon"
          onClick={() => step(-1)}
          disabled={!matches.length}
          title="Previous match"
        >
          {"<"}
        </button>
        <button
          className="btn btn--icon"
          onClick={() => step(1)}
          disabled={!matches.length}
          title="Next match"
        >
          {">"}
        </button>

        <span style={{ fontSize: 12, color: "var(--text-weak)" }}>
          {totalMatches > matches.length
            ? `${matches.length} / ${totalMatches}`
            : `${totalMatches} matches`}
        </span>
      </div>

      {toolsOpen &&
        createPortal(
          <div
            id="search-tools-menu"
            className="menu"
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              zIndex: 10000,
            }}
          >
            <MenuItem
              label="Highlight matches"
              checked={hl}
              onClick={() => setHl((v) => !v)}
            />
            <MenuItem
              label="Highlight line"
              checked={hlMode === "line"}
              onClick={() => setHlMode("line")}
            />
            <MenuItem
              label="Highlight word"
              checked={hlMode === "word"}
              onClick={() => setHlMode("word")}
            />
            <div style={{ height: 6 }} />
            <MenuItem
              label="Regex"
              checked={regex}
              onClick={() => setRegex((v) => !v)}
            />
            <MenuItem
              label="Case sensitive"
              checked={caseSensitive}
              onClick={() => setCaseSensitive((v) => !v)}
            />
            <MenuItem
              label="Auto-jump to first match"
              checked={autoJump}
              onClick={() => setAutoJump((v) => !v)}
            />
            <div style={{ height: 6 }} />
            <MenuItem
              label="Wrap long lines"
              checked={wrap}
              onClick={() => setWrap((v) => !v)}
            />
            <MenuItem
              label="Line numbers"
              checked={lineNums}
              onClick={() => setLineNums((v) => !v)}
            />
            <div style={{ height: 6 }} />
            <div
              style={{
                padding: "4px 8px",
                fontSize: 12,
                color: "var(--text-weak)",
              }}
            >
              Press Enter to run now
            </div>
          </div>,
          document.body,
        )}

      <div className="divider" />

      <button
        className={`btn btn--toggle${raw ? " active" : ""}`}
        onClick={() => setRaw(!raw)}
        title={
          raw
            ? "Showing Raw (escape HTML). Click to render HTML."
            : "Showing Rendered (HTML allowed). Click for Raw."
        }
      >
        Raw
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
        <span className="label">Timestamp</span>
        <input
          className="field"
          placeholder="YYYY-MM-DD HH:mm:ss"
          value={tsInput}
          onChange={(e) => setTsInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") goToTimestamp(tsInput);
          }}
          style={{ width: 220 }}
          title="Jump to nearest timestamp"
        />
        <button
          className="btn"
          onClick={() => goToTimestamp(tsInput)}
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

  return (
    <SearchCtx.Provider
      value={{
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
        colors,
        controls,
        lineBar,
      }}
    >
      {children}
    </SearchCtx.Provider>
  );
}

function MenuItem({ label, checked, onClick }) {
  return (
    <div
      className="menu-item"
      onClick={onClick}
    >
      <span className="menu-check">{checked ? "✓" : ""}</span>
      <span>{label}</span>
    </div>
  );
}
