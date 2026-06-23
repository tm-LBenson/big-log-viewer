import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const WINDOW_BYTES = 1 << 20;
const SEARCH_BYTES = 256 << 20;

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

  const size = windowData?.size || fileSize || 0;
  const progress = size ? Math.min(100, (offset / size) * 100) : 0;
  const activeOffset = searchIndex >= 0 ? searchItems[searchIndex]?.offset : null;

  const loadWindow = useCallback(async (nextOffset, align = true) => {
    loadCtrl.current?.abort();
    const ctrl = new AbortController();
    loadCtrl.current = ctrl;
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
    if (path) loadWindow(0, false);
    return () => {
      loadCtrl.current?.abort();
      searchCtrl.current?.abort();
    };
  }, [loadWindow, path]);

  const selectSearchItem = useCallback(
    (items, index) => {
      const item = items[index];
      if (!item) return;
      setSearchIndex(index);
      loadWindow(item.offset, false);
    },
    [loadWindow],
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

  const lines = useMemo(() => windowData?.lines || [], [windowData]);
  const matchLabel =
    searchIndex >= 0
      ? `${searchIndex + 1} / ${searchItems.length}${searchMore ? "+" : ""}`
      : searchMore
        ? "more available"
        : "0 matches";

  return (
    <main className="viewer huge-viewer">
      <nav className="toolbar huge-toolbar">
        <button className="btn btn--icon" onClick={() => loadWindow(0, false)} title="Top">
          T
        </button>
        <button
          className="btn btn--icon"
          onClick={() => loadWindow(windowData?.prevOffset || 0, true)}
          disabled={!windowData || offset <= 0}
          title="Previous section"
        >
          {"<"}
        </button>
        <button
          className="btn btn--icon"
          onClick={() => loadWindow(windowData?.nextOffset || offset, false)}
          disabled={!windowData || !windowData.truncated}
          title="Next section"
        >
          {">"}
        </button>
        <button
          className="btn btn--icon"
          onClick={() => loadWindow(Math.max(0, size - WINDOW_BYTES), true)}
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
        <span>{formatBytes(offset)} / {formatBytes(size)}</span>
        <span>{progress.toFixed(2)}%</span>
        {notice ? <span>{notice}</span> : null}
      </div>

      {error ? <div className="idhub-banner">{error}</div> : null}

      <div className="huge-log-scroll">
        {loading && !lines.length ? (
          <div className="viewer center huge-loading">loading section...</div>
        ) : (
          lines.map((line, index) => (
            <div
              key={`${line.offset}-${index}`}
              className={`huge-log-row${line.offset === activeOffset ? " is-match" : ""}`}
            >
              <span className="huge-log-offset">{formatBytes(line.offset)}</span>
              <span className="huge-log-text">{line.text}</span>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
