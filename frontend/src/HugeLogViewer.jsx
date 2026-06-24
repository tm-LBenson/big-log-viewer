import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const WINDOW_BYTES = 1 << 20;
const SEARCH_BYTES = 256 << 20;
const SEARCH_CONTEXT_BYTES = 64 << 10;
const EDGE_TOLERANCE = 4;

function formatBytes(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = n;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function clampOffset(offset, size) {
  return Math.max(0, Math.min(Math.max(0, size || 0), offset || 0));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export default function HugeLogViewer({ path, fileSize }) {
  const [windowData, setWindowData] = useState(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchItems, setSearchItems] = useState([]);
  const [searchIndex, setSearchIndex] = useState(-1);
  const [searchMore, setSearchMore] = useState(false);
  const [searchNextOffset, setSearchNextOffset] = useState(0);
  const [notice, setNotice] = useState("");
  const [lineNums, setLineNums] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const loadCtrl = useRef(null);
  const searchCtrl = useRef(null);
  const scrollRef = useRef(null);
  const activeRowRef = useRef(null);
  const pendingScrollRef = useRef("top");
  const copyTimerRef = useRef(0);

  const size = windowData?.size || fileSize || 0;
  const progress = size ? Math.min(100, (offset / size) * 100) : 0;
  const currentPage = size ? Math.floor(offset / WINDOW_BYTES) + 1 : 0;
  const totalPages = size ? Math.max(1, Math.ceil(size / WINDOW_BYTES)) : 0;
  const activeItem = searchIndex >= 0 ? searchItems[searchIndex] : null;
  const activeOffset = activeItem?.offset ?? null;
  const activeText = activeItem?.text || "";
  const lines = useMemo(() => windowData?.lines || [], [windowData]);
  const activeLineIndex = useMemo(() => {
    if (!activeText || activeOffset == null) return -1;
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    lines.forEach((line, index) => {
      if (line.text !== activeText) return;
      const distance = Math.abs(Number(line.offset || 0) - Number(activeOffset || 0));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }, [activeOffset, activeText, lines]);

  const loadWindow = useCallback(async (nextOffset, options = {}) => {
    const { align = false, scroll = "top", tail = false } = options;
    loadCtrl.current?.abort();
    const ctrl = new AbortController();
    loadCtrl.current = ctrl;
    pendingScrollRef.current = scroll;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        offset: String(Math.max(0, nextOffset || 0)),
        limit: String(WINDOW_BYTES),
        align: align ? "1" : "0",
      });
      if (tail) params.set("tail", "1");
      const response = await fetch(`/api/window?${params.toString()}`, {
        signal: ctrl.signal,
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      if (ctrl.signal.aborted) return;
      setWindowData(data);
      setOffset(data.offset || 0);
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setError(err?.message || "Failed to load this section.");
      }
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setWindowData(null);
    setOffset(0);
    setSearchItems([]);
    setSearchIndex(-1);
    setSearchMore(false);
    setSearchNextOffset(0);
    setNotice("");
    if (path) loadWindow(0, { scroll: "top" });
    return () => {
      loadCtrl.current?.abort();
      searchCtrl.current?.abort();
      window.clearTimeout(copyTimerRef.current);
    };
  }, [loadWindow, path]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !windowData) return;

    const placement = pendingScrollRef.current || "top";
    pendingScrollRef.current = "top";
    if (placement === "bottom") {
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      return;
    }
    if (placement === "match" && activeRowRef.current) {
      const target =
        activeRowRef.current.offsetTop - Math.max(0, scroller.clientHeight * 0.35);
      scroller.scrollTop = Math.max(0, target);
      return;
    }
    scroller.scrollTop = 0;
  }, [activeLineIndex, activeOffset, activeText, windowData]);

  const selectSearchItem = useCallback(
    (items, index) => {
      const item = items[index];
      if (!item) return;
      setSearchIndex(index);
      loadWindow(clampOffset(item.offset - SEARCH_CONTEXT_BYTES, size), {
        scroll: "match",
      });
    },
    [loadWindow, size],
  );

  const runSearch = useCallback(
    async (fromOffset = offset) => {
      const term = query.trim();
      if (!term) return;
      searchCtrl.current?.abort();
      const ctrl = new AbortController();
      searchCtrl.current = ctrl;
      setSearching(true);
      setNotice("");
      try {
        const params = new URLSearchParams({
          q: term,
          offset: String(clampOffset(fromOffset, size)),
          limit: "100",
          maxBytes: String(SEARCH_BYTES),
        });
        const response = await fetch(`/api/search?${params.toString()}`, {
          signal: ctrl.signal,
        });
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        if (ctrl.signal.aborted) return;
        const items = Array.isArray(data.Items) ? data.Items : [];
        setSearchItems(items);
        setSearchMore(!!data.More);
        setSearchNextOffset(data.NextOffset || 0);
        if (items.length) {
          selectSearchItem(items, 0);
          setNotice(
            `${items.length} match${items.length === 1 ? "" : "es"} in ${formatBytes(data.ScannedBytes)}.`,
          );
        } else {
          setSearchIndex(-1);
          setNotice(
            `No matches in ${formatBytes(data.ScannedBytes)}.${data.More ? " Continue to scan farther." : " End of file reached."}`,
          );
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          setNotice(err?.message || "Search failed.");
        }
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    },
    [offset, query, selectSearchItem, size],
  );

  const nextSearch = () => {
    if (searchIndex >= 0 && searchIndex < searchItems.length - 1) {
      selectSearchItem(searchItems, searchIndex + 1);
      return;
    }
    if (searchMore) runSearch(searchNextOffset);
  };

  const prevSearch = () => {
    if (searchIndex > 0) selectSearchItem(searchItems, searchIndex - 1);
  };

  const loadPreviousSection = useCallback(() => {
    const prev = windowData?.prevOffset ?? offset - WINDOW_BYTES;
    loadWindow(clampOffset(prev, size), { scroll: "bottom" });
  }, [loadWindow, offset, size, windowData]);

  const loadNextSection = useCallback(() => {
    const next = windowData?.nextOffset ?? offset + WINDOW_BYTES;
    loadWindow(clampOffset(next, size), { scroll: "top" });
  }, [loadWindow, offset, size, windowData]);

  const handleWheel = useCallback(
    (event) => {
      const scroller = scrollRef.current;
      if (!scroller || loading || !windowData) return;

      const atTop = scroller.scrollTop <= EDGE_TOLERANCE;
      const atBottom =
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= EDGE_TOLERANCE;
      if (event.deltaY < 0 && atTop && offset > 0) {
        event.preventDefault();
        loadPreviousSection();
      } else if (event.deltaY > 0 && atBottom && windowData.truncated) {
        event.preventDefault();
        loadNextSection();
      }
    },
    [loadNextSection, loadPreviousSection, loading, offset, windowData],
  );

  const setActiveRow = useCallback((node) => {
    activeRowRef.current = node;
  }, []);

  const showCopyStatus = useCallback((message) => {
    setCopyStatus(message);
    window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyStatus(""), 1800);
  }, []);

  const writeClipboard = useCallback(async (text, html) => {
    if (html && navigator.clipboard && window.ClipboardItem) {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }, []);

  const copyRenderedSection = useCallback(async () => {
    if (!lines.length) return;
    const text = lines
      .map((line, index) => `${lineNums ? `${index + 1}\t` : ""}${line.text}`)
      .join("\n");
    const html = `<pre>${escapeHtml(text)}</pre>`;
    try {
      await writeClipboard(text, html);
      showCopyStatus("Copied rendered section");
    } catch {
      showCopyStatus("Copy failed");
    }
  }, [lineNums, lines, showCopyStatus, writeClipboard]);

  const copyRawSection = useCallback(async () => {
    if (!windowData) return;
    try {
      const params = new URLSearchParams({
        offset: String(windowData.offset || 0),
        limit: String(windowData.limit || WINDOW_BYTES),
      });
      const response = await fetch(`/api/raw-window?${params.toString()}`);
      if (!response.ok) throw new Error(await response.text());
      const text = await response.text();
      await writeClipboard(text);
      showCopyStatus("Copied raw section");
    } catch {
      showCopyStatus("Copy failed");
    }
  }, [showCopyStatus, windowData, writeClipboard]);

  const matchLabel =
    searchIndex >= 0
      ? `${searchIndex + 1} / ${searchItems.length}${searchMore ? "+" : ""}`
      : searchMore
        ? "more available"
        : "0 matches";

  return (
    <main className="viewer huge-viewer">
      <nav className="toolbar huge-toolbar">
        <button className="btn btn--icon" onClick={() => loadWindow(0)} title="Top">
          T
        </button>
        <button
          className="btn btn--icon"
          onClick={loadPreviousSection}
          disabled={!windowData || offset <= 0}
          title="Previous section"
        >
          {"<"}
        </button>
        <button
          className="btn btn--icon"
          onClick={loadNextSection}
          disabled={!windowData || !windowData.truncated}
          title="Next section"
        >
          {">"}
        </button>
        <button
          className="btn btn--icon"
          onClick={() => loadWindow(size, { scroll: "bottom", tail: true })}
          disabled={!size}
          title="Bottom"
        >
          B
        </button>
        <div className="divider" />
        <div className="searchrow huge-searchrow">
          <input
            className="field search-input"
            placeholder="search huge file..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") runSearch(offset);
            }}
          />
          <button className="btn btn--primary" onClick={() => runSearch(offset)} disabled={searching || !query.trim()}>
            {searching ? "Searching" : "Search"}
          </button>
          <button className="btn btn--icon" onClick={prevSearch} disabled={searchIndex <= 0}>
            {"<"}
          </button>
          <button
            className="btn btn--icon"
            onClick={nextSearch}
            disabled={searching || (!searchMore && searchIndex >= searchItems.length - 1)}
          >
            {">"}
          </button>
          <span className="huge-search-meta">{matchLabel}</span>
        </div>
        <div className="divider" />
        <div className="huge-tools">
          <button
            className={`btn btn--toggle${lineNums ? " active" : ""}`}
            onClick={() => setLineNums((value) => !value)}
            title="Line numbers"
          >
            #
          </button>
          <button
            className="btn"
            onClick={copyRenderedSection}
            disabled={!lines.length}
            title="Copy rendered current section"
          >
            Copy rendered
          </button>
          <button
            className="btn"
            onClick={copyRawSection}
            disabled={!windowData}
            title="Copy raw current section"
          >
            Copy raw
          </button>
          {copyStatus ? <span className="huge-copy-status">{copyStatus}</span> : null}
        </div>
      </nav>

      <div className="huge-status">
        <span>Huge stream mode</span>
        <span>Section {currentPage} / {totalPages}</span>
        <span>{formatBytes(offset)} / {formatBytes(size)}</span>
        <span>{progress.toFixed(2)}%</span>
        {notice ? <span>{notice}</span> : null}
      </div>

      {error ? <div className="idhub-banner">{error}</div> : null}

      <div className="huge-log-area">
        <div
          ref={scrollRef}
          className="huge-log-scroll"
          onWheel={handleWheel}
        >
          {loading && !lines.length ? (
            <div className="viewer center huge-loading">loading section...</div>
          ) : (
            lines.map((line, index) => {
              const isActive = index === activeLineIndex;
              return (
                <div
                  key={`${line.offset}-${index}`}
                  ref={isActive ? setActiveRow : undefined}
                  className={`huge-log-row${lineNums ? " has-line-numbers" : ""}${isActive ? " is-match" : ""}`}
                >
                  {lineNums ? (
                    <span className="huge-log-line-no">{index + 1}</span>
                  ) : null}
                  <span className="huge-log-offset">{formatBytes(line.offset)}</span>
                  <span className="huge-log-text">{line.text}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}
