import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const WINDOW_BYTES = 1 << 20;
const SEARCH_BYTES = 256 << 20;
const SEARCH_CONTEXT_BYTES = 64 << 10;
const EDGE_TOLERANCE = 4;
const JOYSTICK_HANDLE = 42;
const JOYSTICK_SPEED = 1800;

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
  const loadCtrl = useRef(null);
  const searchCtrl = useRef(null);
  const scrollRef = useRef(null);
  const activeRowRef = useRef(null);
  const pendingScrollRef = useRef("top");
  const navRailRef = useRef(null);
  const navHandleRef = useRef(null);
  const navDeltaRef = useRef(0);
  const navRangeRef = useRef(1);
  const navFrameRef = useRef(0);
  const navLastRef = useRef(0);
  const pageCooldownRef = useRef(false);
  const loadingRef = useRef(false);
  const windowDataRef = useRef(null);
  const offsetRef = useRef(0);

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

  loadingRef.current = loading;
  windowDataRef.current = windowData;
  offsetRef.current = offset;

  const loadWindow = useCallback(async (nextOffset, options = {}) => {
    const { align = false, scroll = "top" } = options;
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
      window.cancelAnimationFrame(navFrameRef.current);
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

  const pageByDirection = useCallback(
    (direction) => {
      if (loadingRef.current || pageCooldownRef.current) return;
      pageCooldownRef.current = true;
      window.setTimeout(() => {
        pageCooldownRef.current = false;
      }, 350);

      if (direction < 0 && offsetRef.current > 0) {
        loadPreviousSection();
      } else if (direction > 0 && windowDataRef.current?.truncated) {
        loadNextSection();
      }
    },
    [loadNextSection, loadPreviousSection],
  );

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

  const animateJoystick = useCallback(
    (timestamp) => {
      if (!navLastRef.current) navLastRef.current = timestamp;
      const dt = (timestamp - navLastRef.current) / 1000;
      navLastRef.current = timestamp;

      const scroller = scrollRef.current;
      const range = Math.max(1, navRangeRef.current);
      const ratio = navDeltaRef.current / range;
      const pixels = ratio * JOYSTICK_SPEED * dt;

      if (scroller && Math.abs(pixels) > 0.1) {
        scroller.scrollTop += pixels;
        const atTop = scroller.scrollTop <= EDGE_TOLERANCE;
        const atBottom =
          scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <=
          EDGE_TOLERANCE;
        if (pixels < 0 && atTop) {
          pageByDirection(-1);
        } else if (pixels > 0 && atBottom) {
          pageByDirection(1);
        }
      }

      navFrameRef.current = window.requestAnimationFrame(animateJoystick);
    },
    [pageByDirection],
  );

  const startJoystickDrag = useCallback(
    (event) => {
      event.preventDefault();
      const rail = navRailRef.current;
      const handle = navHandleRef.current;
      if (!rail || !handle) return;

      const rect = rail.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const range = Math.max(1, (rect.height - JOYSTICK_HANDLE) / 2);
      navRangeRef.current = range;
      navLastRef.current = 0;

      const move = (moveEvent) => {
        const delta = Math.max(-range, Math.min(range, moveEvent.clientY - mid));
        navDeltaRef.current = delta;
        handle.style.top = `calc(50% + ${delta}px)`;
      };
      const up = () => {
        navDeltaRef.current = 0;
        handle.style.top = "50%";
        window.cancelAnimationFrame(navFrameRef.current);
        navLastRef.current = 0;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      move(event);
      navFrameRef.current = window.requestAnimationFrame(animateJoystick);
    },
    [animateJoystick],
  );

  const setActiveRow = useCallback((node) => {
    activeRowRef.current = node;
  }, []);

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
          onClick={() => loadWindow(Math.max(0, size - WINDOW_BYTES))}
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
                  className={`huge-log-row${isActive ? " is-match" : ""}`}
                >
                  <span className="huge-log-offset">{formatBytes(line.offset)}</span>
                  <span className="huge-log-text">{line.text}</span>
                </div>
              );
            })
          )}
        </div>
        <div
          ref={navRailRef}
          className="huge-joystick-rail"
          onPointerDown={startJoystickDrag}
          title="Drag up or down to scroll; hold near an edge to page"
        >
          <div
            ref={navHandleRef}
            className="huge-joystick-handle"
          />
        </div>
      </div>
    </main>
  );
}
