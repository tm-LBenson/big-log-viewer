import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import FileMetaBar from "./FileMetaBar";
import { addSavedSearch, readSavedSearches, removeSavedSearch } from "./savedSearches";

const WINDOW_BYTES = 1 << 20;
const SEARCH_BYTES = 256 << 20;
const SEARCH_CONTEXT_BYTES = 64 << 10;
const EDGE_TOLERANCE = 4;
const MAX_FULL_SEARCH_MATCHES = 5000;
const BOOKMARKS_KEY = "biglog.hugeBookmarks.v1";
const SESSION_KEY = "biglog.hugeSessions.v1";

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

function parseByteValue(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (match[2] || "b").toLowerCase();
  const scale = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    tb: 1024 ** 4,
  }[unit];
  return Math.floor(n * scale);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactText(value) {
  return String(value || "")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[redacted private key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted jwt]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted aws key]")
    .replace(
      /("(?:password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)"\s*:\s*)"[^"]*"/gi,
      '$1"[redacted]"',
    )
    .replace(
      /\b((?:password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[redacted]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted ssn]");
}

function buildSearchRegExp(query, regex, caseSensitive) {
  const term = query.trim();
  if (!term) return null;
  try {
    const re = new RegExp(regex ? term : escapeRegExp(term), caseSensitive ? "g" : "gi");
    re.lastIndex = 0;
    if (re.test("")) return null;
    re.lastIndex = 0;
    return re;
  } catch {
    return null;
  }
}

function highlightText(text, re) {
  const value = String(text || "");
  if (!re) return value;

  const parts = [];
  let last = 0;
  let match;
  re.lastIndex = 0;

  while ((match = re.exec(value)) !== null) {
    if (match.index > last) {
      parts.push(value.slice(last, match.index));
    }
    const hit = match[0];
    if (!hit) break;
    parts.push(
      <mark className="huge-match-word" key={`${match.index}-${parts.length}`}>
        {hit}
      </mark>,
    );
    last = match.index + hit.length;
  }

  if (last < value.length) {
    parts.push(value.slice(last));
  }
  return parts.length ? parts : value;
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function readBookmarkStore() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BOOKMARKS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeBookmarkStore(store) {
  try {
    window.localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(store));
  } catch {
    //
  }
}

function readBookmarks(fileKey) {
  const store = readBookmarkStore();
  const list = Array.isArray(store[fileKey]) ? store[fileKey] : [];
  return list
    .filter((item) => Number.isFinite(Number(item?.offset)))
    .sort((a, b) => Number(a.offset) - Number(b.offset));
}

function writeBookmarks(fileKey, bookmarks) {
  const store = readBookmarkStore();
  store[fileKey] = bookmarks.slice(0, 200);
  writeBookmarkStore(store);
}

function readSessionStore() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SESSION_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSessionStore(store) {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(store));
  } catch {
    //
  }
}

function readSessionOffset(fileKey, size) {
  const store = readSessionStore();
  const offset = Number(store[fileKey]?.offset || 0);
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  return clampOffset(offset, size || Number.MAX_SAFE_INTEGER);
}

function writeSessionOffset(fileKey, offset) {
  if (!fileKey) return;
  const store = readSessionStore();
  store[fileKey] = {
    offset: Math.max(0, Math.floor(Number(offset || 0))),
    updatedAt: Date.now(),
  };
  const entries = Object.entries(store).sort(
    (a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0),
  );
  writeSessionStore(Object.fromEntries(entries.slice(0, 100)));
}

function bookmarkLabel(bookmark) {
  const label = String(bookmark?.label || "").trim();
  if (label) return label.length > 80 ? `${label.slice(0, 77)}...` : label;
  return formatBytes(bookmark?.offset || 0);
}

function normalizeBookmarkImport(input, size) {
  const raw = Array.isArray(input) ? input : Array.isArray(input?.bookmarks) ? input.bookmarks : [];
  return raw
    .map((item) => {
      const offset = Number(item?.offset);
      if (!Number.isFinite(offset)) return null;
      return {
        id: String(item?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
        offset: clampOffset(offset, size || Number.MAX_SAFE_INTEGER),
        label: String(item?.label || item?.text || "").replace(/\s+/g, " ").trim(),
        createdAt: Number(item?.createdAt || Date.now()),
        query: String(item?.query || ""),
      };
    })
    .filter(Boolean);
}

function buildBookmarkText({ path, size, bookmarks }) {
  const header = [
    `File: ${path || ""}`,
    `Size: ${size || 0}`,
    `Bookmarks: ${bookmarks.length}`,
    "",
  ];
  const rows = bookmarks.map((bookmark, index) =>
    `${index + 1}\t${bookmark.offset}\t${formatBytes(bookmark.offset)}\t${bookmark.label || ""}`,
  );
  return header.concat(rows).join("\n");
}

function buildBookmarkJson({ path, size, bookmarks }) {
  return JSON.stringify(
    {
      file: path || "",
      size: size || 0,
      exportedAt: new Date().toISOString(),
      bookmarks: bookmarks.map((bookmark) => ({
        offset: bookmark.offset,
        label: bookmark.label || "",
        query: bookmark.query || "",
        createdAt: bookmark.createdAt || Date.now(),
      })),
    },
    null,
    2,
  );
}

function oneLine(value, max = 140) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function searchResultLabel(item, index, redacted = false) {
  const tone = item?.tone ? ` ${String(item.tone).toUpperCase()}` : "";
  const text = redacted ? redactText(item?.text) : item?.text;
  return `${index + 1}. ${formatBytes(item?.offset || 0)}${tone} - ${oneLine(text, 96)}`;
}

function buildSearchResultsText({ path, query, regex, caseSensitive, items, redacted }) {
  const toneSummary = formatToneSummary(summarizeTones(items));
  const opts = [
    regex ? "regex" : "literal",
    caseSensitive ? "case-sensitive" : "case-insensitive",
  ].join(", ");
  const header = [
    `File: ${path || ""}`,
    `Query: ${redacted ? redactText(query) : query || ""}`,
    `Mode: ${opts}`,
    `Matches: ${items.length}`,
    `Redacted: ${redacted ? "yes" : "no"}`,
    toneSummary ? `Tones: ${toneSummary}` : "",
    "",
  ].filter((line, index, arr) => line || index >= arr.length - 1);
  const rows = items.map((item, index) => {
    const tone = item.tone ? `\t${item.tone}` : "";
    const text = redacted ? redactText(item.text) : item.text || "";
    return `${index + 1}\t${item.offset}${tone}\t${text}`;
  });
  return header.concat(rows).join("\n");
}

function searchItemKey(item) {
  return `${Number(item?.offset || 0)}\u0000${String(item?.text || "")}`;
}

function summarizeTones(items) {
  return items.reduce((counts, item) => {
    const tone = item?.tone || "plain";
    counts[tone] = (counts[tone] || 0) + 1;
    return counts;
  }, {});
}

function formatToneSummary(counts) {
  return ["error", "warn", "ok", "info", "plain"]
    .filter((tone) => counts[tone])
    .map((tone) => `${tone}:${counts[tone]}`)
    .join(" ");
}

export default function HugeLogViewer({ path, fileSize, fileInfo }) {
  const [windowData, setWindowData] = useState(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [savedSearches, setSavedSearches] = useState(() => readSavedSearches());
  const [searching, setSearching] = useState(false);
  const [searchItems, setSearchItems] = useState([]);
  const [searchIndex, setSearchIndex] = useState(-1);
  const [searchMore, setSearchMore] = useState(false);
  const [searchNextOffset, setSearchNextOffset] = useState(0);
  const [notice, setNotice] = useState("");
  const [lineNums, setLineNums] = useState(false);
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [redact, setRedact] = useState(false);
  const [toneFilter, setToneFilter] = useState("all");
  const [jumpMode, setJumpMode] = useState("page");
  const [jumpValue, setJumpValue] = useState("");
  const [bookmarks, setBookmarks] = useState([]);
  const [selectedBookmarkId, setSelectedBookmarkId] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const loadCtrl = useRef(null);
  const searchCtrl = useRef(null);
  const scrollRef = useRef(null);
  const activeRowRef = useRef(null);
  const pendingScrollRef = useRef("top");
  const copyTimerRef = useRef(0);
  const sessionTimerRef = useRef(0);
  const viewOffsetRef = useRef(0);
  const bookmarkImportRef = useRef(null);

  const size = windowData?.size || fileSize || 0;
  const progress = size ? Math.min(100, (offset / size) * 100) : 0;
  const currentPage = size ? Math.floor(offset / WINDOW_BYTES) + 1 : 0;
  const totalPages = size ? Math.max(1, Math.ceil(size / WINDOW_BYTES)) : 0;
  const activeItem = searchIndex >= 0 ? searchItems[searchIndex] : null;
  const activeOffset = activeItem?.offset ?? null;
  const activeText = activeItem?.text || "";
  const currentSearchSaved = savedSearches.includes(query.trim());
  const lines = useMemo(() => windowData?.lines || [], [windowData]);
  const toneCounts = useMemo(
    () =>
      lines.reduce(
        (counts, line) => {
          const tone = line.tone || "plain";
          counts[tone] = (counts[tone] || 0) + 1;
          return counts;
        },
        { plain: 0 },
      ),
    [lines],
  );
  const displayedLines = useMemo(
    () => (toneFilter === "all" ? lines : lines.filter((line) => line.tone === toneFilter)),
    [lines, toneFilter],
  );
  const displayText = useCallback(
    (text) => (redact ? redactText(text) : String(text || "")),
    [redact],
  );
  const activeSearchRe = useMemo(
    () => buildSearchRegExp(query, regex, caseSensitive),
    [caseSensitive, query, regex],
  );
  const sectionStem = useMemo(() => {
    const base = String(path || "biglog")
      .split(/[\\/]/)
      .pop()
      .replace(/\.[^.]+$/, "");
    return (base || "biglog").replace(/[^a-zA-Z0-9._-]+/g, "_");
  }, [path]);
  const bookmarkFileKey = useMemo(
    () => `${path || ""}|${fileSize || size || 0}`,
    [fileSize, path, size],
  );
  const sessionFileKey = useMemo(
    () => (path && fileSize ? `${path}|${fileSize}` : ""),
    [fileSize, path],
  );
  const selectedBookmark = useMemo(
    () => bookmarks.find((bookmark) => bookmark.id === selectedBookmarkId) || null,
    [bookmarks, selectedBookmarkId],
  );
  const activeLineIndex = useMemo(() => {
    if (!activeText || activeOffset == null) return -1;
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    displayedLines.forEach((line, index) => {
      if (line.text !== activeText) return;
      const distance = Math.abs(Number(line.offset || 0) - Number(activeOffset || 0));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }, [activeOffset, activeText, displayedLines]);

  const updateVisibleOffset = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) {
      viewOffsetRef.current = offset;
      return offset;
    }
    const rows = scroller.querySelectorAll("[data-log-offset]");
    const top = scroller.scrollTop + 2;
    let current = offset;
    for (const row of rows) {
      const rowOffset = Number(row.getAttribute("data-log-offset"));
      if (!Number.isFinite(rowOffset)) continue;
      if (row.offsetTop > top) break;
      current = rowOffset;
    }
    viewOffsetRef.current = current;
    return current;
  }, [offset]);

  const saveSessionPosition = useCallback(() => {
    if (!sessionFileKey || !size || !windowData) return;
    writeSessionOffset(sessionFileKey, clampOffset(updateVisibleOffset(), size));
  }, [sessionFileKey, size, updateVisibleOffset, windowData]);

  const scheduleSessionSave = useCallback(() => {
    window.clearTimeout(sessionTimerRef.current);
    sessionTimerRef.current = window.setTimeout(saveSessionPosition, 250);
  }, [saveSessionPosition]);

  const handleScroll = useCallback(() => {
    updateVisibleOffset();
    scheduleSessionSave();
  }, [scheduleSessionSave, updateVisibleOffset]);

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
      viewOffsetRef.current = data.offset || 0;
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
    viewOffsetRef.current = 0;
    setSearchItems([]);
    setSearchIndex(-1);
    setSearchMore(false);
    setSearchNextOffset(0);
    setNotice("");
    setSelectedBookmarkId("");
    setToneFilter("all");
    if (path) {
      const restoredOffset = readSessionOffset(sessionFileKey, fileSize || 0);
      if (restoredOffset > 0) {
        setNotice(`Restored ${formatBytes(restoredOffset)}.`);
        loadWindow(restoredOffset, { align: true, scroll: "top" });
      } else {
        loadWindow(0, { scroll: "top" });
      }
    }
    return () => {
      loadCtrl.current?.abort();
      searchCtrl.current?.abort();
      window.clearTimeout(copyTimerRef.current);
      window.clearTimeout(sessionTimerRef.current);
    };
  }, [fileSize, loadWindow, path, sessionFileKey]);

  useEffect(() => {
    setBookmarks(bookmarkFileKey ? readBookmarks(bookmarkFileKey) : []);
    setSelectedBookmarkId("");
  }, [bookmarkFileKey]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !windowData) return;

    const placement = pendingScrollRef.current || "top";
    pendingScrollRef.current = "top";
    const rememberPlacement = () => {
      window.requestAnimationFrame(updateVisibleOffset);
      scheduleSessionSave();
    };
    if (placement === "bottom") {
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      rememberPlacement();
      return;
    }
    if (placement === "match" && activeRowRef.current) {
      const target =
        activeRowRef.current.offsetTop - Math.max(0, scroller.clientHeight * 0.35);
      scroller.scrollTop = Math.max(0, target);
      rememberPlacement();
      return;
    }
    scroller.scrollTop = 0;
    rememberPlacement();
  }, [activeLineIndex, activeOffset, activeText, scheduleSessionSave, updateVisibleOffset, windowData]);

  useEffect(() => {
    if (!windowData) return;
    scheduleSessionSave();
  }, [offset, scheduleSessionSave, windowData]);

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
    async (fromOffset = offset, queryOverride = query) => {
      const term = queryOverride.trim();
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
        if (regex) params.set("regex", "1");
        if (caseSensitive) params.set("case", "1");
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
    [caseSensitive, offset, query, regex, selectSearchItem, size],
  );

  const selectSavedSearch = useCallback(
    (term) => {
      if (!term) return;
      setQuery(term);
      runSearch(offset, term);
    },
    [offset, runSearch],
  );

  const saveCurrentSearch = useCallback(() => {
    setSavedSearches(addSavedSearch(query));
  }, [query]);

  const removeCurrentSearch = useCallback(() => {
    setSavedSearches(removeSavedSearch(query));
  }, [query]);

  const runFullSearch = useCallback(async () => {
    const term = query.trim();
    if (!term || !size) return;
    searchCtrl.current?.abort();
    const ctrl = new AbortController();
    searchCtrl.current = ctrl;
    setSearching(true);
    setNotice("");
    setSearchItems([]);
    setSearchIndex(-1);
    setSearchMore(false);
    setSearchNextOffset(0);

    const startOffset = 0;
    let cursor = startOffset;
    const allItems = [];
    const seenItems = new Set();
    let selectedFirst = false;

    try {
      while (cursor < size && allItems.length < MAX_FULL_SEARCH_MATCHES) {
        const params = new URLSearchParams({
          q: term,
          offset: String(cursor),
          limit: "200",
          maxBytes: String(SEARCH_BYTES),
        });
        if (regex) params.set("regex", "1");
        if (caseSensitive) params.set("case", "1");
        const response = await fetch(`/api/search?${params.toString()}`, {
          signal: ctrl.signal,
        });
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        if (ctrl.signal.aborted) return;

        const chunkItems = Array.isArray(data.Items) ? data.Items : [];
        for (const item of chunkItems) {
          if (allItems.length >= MAX_FULL_SEARCH_MATCHES) break;
          const key = searchItemKey(item);
          if (seenItems.has(key)) continue;
          seenItems.add(key);
          allItems.push(item);
        }

        const nextOffset = clampOffset(Number(data.NextOffset || cursor), size);
        const hasMore = !!data.More && nextOffset < size && nextOffset > cursor;
        setSearchItems([...allItems]);
        setSearchMore(hasMore || allItems.length >= MAX_FULL_SEARCH_MATCHES);
        setSearchNextOffset(nextOffset);
        setNotice(
          `Scanning ${size ? ((nextOffset / size) * 100).toFixed(2) : "0.00"}%... ${allItems.length} match${allItems.length === 1 ? "" : "es"}.`,
        );

        if (!selectedFirst && allItems.length) {
          selectedFirst = true;
          selectSearchItem(allItems, 0);
        }

        if (!hasMore) {
          cursor = nextOffset;
          break;
        }
        cursor = nextOffset;
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
      }

      if (ctrl.signal.aborted) return;
      if (!allItems.length) {
        setSearchIndex(-1);
        setNotice("No matches found in the file.");
      } else if (allItems.length >= MAX_FULL_SEARCH_MATCHES && cursor < size) {
        setSearchMore(true);
        setSearchNextOffset(cursor);
        setNotice(
          `Stopped at ${MAX_FULL_SEARCH_MATCHES} matches. Narrow the search or continue from ${formatBytes(cursor)}.`,
        );
      } else {
        setSearchMore(false);
        setSearchNextOffset(cursor);
        setNotice(
          `${allItems.length} match${allItems.length === 1 ? "" : "es"} found in the file.`,
        );
      }
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setNotice(err?.message || "Search failed.");
      }
    } finally {
      if (!ctrl.signal.aborted) setSearching(false);
    }
  }, [caseSensitive, query, regex, selectSearchItem, size]);

  const cancelSearch = useCallback(() => {
    searchCtrl.current?.abort();
    setSearching(false);
    setNotice("Search cancelled.");
  }, []);

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

  const jumpToPosition = useCallback(() => {
    if (!size) return;
    let target = null;
    if (jumpMode === "page") {
      const page = Number(jumpValue);
      if (Number.isFinite(page)) target = (Math.max(1, page) - 1) * WINDOW_BYTES;
    } else if (jumpMode === "percent") {
      const pct = Number(jumpValue);
      if (Number.isFinite(pct)) target = size * (Math.max(0, Math.min(100, pct)) / 100);
    } else {
      target = parseByteValue(jumpValue);
    }
    if (target == null) {
      setNotice("Enter a valid page, percent, or byte offset.");
      return;
    }
    loadWindow(clampOffset(target, size), { align: true, scroll: "top" });
  }, [jumpMode, jumpValue, loadWindow, size]);

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

  const updateBookmarks = useCallback(
    (updater) => {
      if (!bookmarkFileKey) return;
      setBookmarks((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        const sorted = next
          .slice()
          .sort((a, b) => Number(a.offset) - Number(b.offset))
          .slice(0, 200);
        writeBookmarks(bookmarkFileKey, sorted);
        return sorted;
      });
    },
    [bookmarkFileKey],
  );

  const addBookmark = useCallback(() => {
    if (!size) return;
    const target = clampOffset(activeOffset ?? windowData?.offset ?? offset, size);
    const nearestLine =
      activeText ||
      displayedLines.find((line) => Number(line.offset || 0) >= target)?.text ||
      lines.find((line) => Number(line.offset || 0) >= target)?.text ||
      displayedLines[0]?.text ||
      lines[0]?.text ||
      "";
    const cleanLabel = displayText(nearestLine).replace(/\s+/g, " ").trim();
    const pct = size ? ((target / size) * 100).toFixed(2) : "0.00";
    const bookmark = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      offset: target,
      label: cleanLabel || `${formatBytes(target)} (${pct}%)`,
      createdAt: Date.now(),
      query: query.trim(),
    };
    updateBookmarks((prev) => {
      const withoutNearby = prev.filter(
        (item) => Math.abs(Number(item.offset || 0) - target) > 128,
      );
      return [bookmark, ...withoutNearby];
    });
    setSelectedBookmarkId(bookmark.id);
    showCopyStatus("Bookmark added");
  }, [activeOffset, activeText, displayedLines, displayText, lines, offset, query, showCopyStatus, size, updateBookmarks, windowData]);

  const jumpToBookmark = useCallback(
    (bookmark) => {
      if (!bookmark) return;
      const target = clampOffset(Number(bookmark.offset || 0), size);
      loadWindow(target, { align: true, scroll: "top" });
      setNotice(`Opened bookmark at ${formatBytes(target)}.`);
    },
    [loadWindow, size],
  );

  const removeSelectedBookmark = useCallback(() => {
    if (!selectedBookmarkId) return;
    updateBookmarks((prev) => prev.filter((bookmark) => bookmark.id !== selectedBookmarkId));
    setSelectedBookmarkId("");
    showCopyStatus("Bookmark removed");
  }, [selectedBookmarkId, showCopyStatus, updateBookmarks]);

  const copyBookmarks = useCallback(async () => {
    if (!bookmarks.length) return;
    try {
      await writeClipboard(buildBookmarkText({ path, size, bookmarks }));
      showCopyStatus("Copied bookmarks");
    } catch {
      showCopyStatus("Copy failed");
    }
  }, [bookmarks, path, showCopyStatus, size, writeClipboard]);

  const downloadBookmarks = useCallback(() => {
    if (!bookmarks.length) return;
    saveBlob(
      new Blob([buildBookmarkJson({ path, size, bookmarks })], {
        type: "application/json;charset=utf-8",
      }),
      `${sectionStem}-bookmarks.json`,
    );
    showCopyStatus("Saved bookmarks");
  }, [bookmarks, path, sectionStem, showCopyStatus, size]);

  const importBookmarks = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const imported = normalizeBookmarkImport(parsed, size);
        if (!imported.length) {
          showCopyStatus("No bookmarks found");
          return;
        }
        updateBookmarks((prev) => {
          const merged = [...prev];
          for (const bookmark of imported) {
            const exists = merged.some(
              (item) => Math.abs(Number(item.offset || 0) - bookmark.offset) <= 128,
            );
            if (!exists) merged.push(bookmark);
          }
          return merged;
        });
        showCopyStatus(`Imported ${imported.length} bookmark${imported.length === 1 ? "" : "s"}`);
      } catch {
        showCopyStatus("Import failed");
      }
    },
    [showCopyStatus, size, updateBookmarks],
  );

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
    if (!displayedLines.length) return;
    const text = displayedLines
      .map((line, index) => `${lineNums ? `${index + 1}\t` : ""}${displayText(line.text)}`)
      .join("\n");
    const html = `<pre>${escapeHtml(text)}</pre>`;
    try {
      await writeClipboard(text, html);
      showCopyStatus("Copied rendered section");
    } catch {
      showCopyStatus("Copy failed");
    }
  }, [displayedLines, displayText, lineNums, showCopyStatus, writeClipboard]);

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
      await writeClipboard(displayText(text));
      showCopyStatus("Copied raw section");
    } catch {
      showCopyStatus("Copy failed");
    }
  }, [displayText, showCopyStatus, windowData, writeClipboard]);

  const downloadRenderedSection = useCallback(() => {
    if (!displayedLines.length || !windowData) return;
    const text = displayedLines
      .map((line, index) => `${lineNums ? `${index + 1}\t` : ""}${displayText(line.text)}`)
      .join("\n");
    const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(sectionStem)}</title><pre>${escapeHtml(text)}</pre>`;
    const start = Math.max(0, windowData.offset || 0);
    const name = `${sectionStem}-rendered-${start}.html`;
    saveBlob(new Blob([html], { type: "text/html;charset=utf-8" }), name);
    showCopyStatus("Saved rendered section");
  }, [displayedLines, displayText, lineNums, sectionStem, showCopyStatus, windowData]);

  const downloadRawSection = useCallback(async () => {
    if (!windowData) return;
    try {
      const params = new URLSearchParams({
        offset: String(windowData.offset || 0),
        limit: String(windowData.limit || WINDOW_BYTES),
      });
      const response = await fetch(`/api/raw-window?${params.toString()}`);
      if (!response.ok) throw new Error(await response.text());
      const text = await response.text();
      const blob = new Blob([displayText(text)], { type: "text/plain;charset=utf-8" });
      const start = Math.max(0, windowData.offset || 0);
      saveBlob(blob, `${sectionStem}-raw-${start}.log`);
      showCopyStatus("Saved raw section");
    } catch {
      showCopyStatus("Save failed");
    }
  }, [displayText, sectionStem, showCopyStatus, windowData]);

  const matchLabel =
    searchIndex >= 0
      ? `${searchIndex + 1} / ${searchItems.length}${searchMore ? "+" : ""}`
      : searchMore
        ? "more available"
        : "0 matches";
  const selectedSearchValue = searchIndex >= 0 ? String(searchIndex) : "";
  const searchToneSummary = useMemo(
    () => formatToneSummary(summarizeTones(searchItems)),
    [searchItems],
  );

  const buildCurrentSearchResultsText = useCallback(
    () =>
      buildSearchResultsText({
        path,
        query: query.trim(),
        regex,
        caseSensitive,
        items: searchItems,
        redacted: redact,
      }),
    [caseSensitive, path, query, redact, regex, searchItems],
  );

  const copySearchResults = useCallback(async () => {
    if (!searchItems.length) return;
    try {
      await writeClipboard(buildCurrentSearchResultsText());
      showCopyStatus("Copied search hits");
    } catch {
      showCopyStatus("Copy failed");
    }
  }, [buildCurrentSearchResultsText, searchItems.length, showCopyStatus, writeClipboard]);

  const downloadSearchResults = useCallback(() => {
    if (!searchItems.length) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `${sectionStem}-search-${stamp}.txt`;
    saveBlob(new Blob([buildCurrentSearchResultsText()], { type: "text/plain;charset=utf-8" }), name);
    showCopyStatus("Saved search hits");
  }, [buildCurrentSearchResultsText, searchItems.length, sectionStem, showCopyStatus]);

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
        <div className="huge-jump">
          <select
            className="field"
            value={jumpMode}
            onChange={(event) => setJumpMode(event.target.value)}
            title="Jump mode"
          >
            <option value="page">Page</option>
            <option value="percent">%</option>
            <option value="offset">Offset</option>
          </select>
          <input
            className="field huge-jump-input"
            value={jumpValue}
            onChange={(event) => setJumpValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") jumpToPosition();
            }}
            placeholder={jumpMode === "page" ? `${currentPage}/${totalPages}` : jumpMode === "percent" ? "0-100" : "12mb"}
          />
          <button className="btn" onClick={jumpToPosition} disabled={!size}>
            Go
          </button>
        </div>
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
          <select
            className="field saved-search-select"
            value=""
            onChange={(event) => {
              if (event.target.value) selectSavedSearch(event.target.value);
            }}
            title="Saved searches"
          >
            <option value="">Saved ({savedSearches.length})</option>
            {savedSearches.map((term) => (
              <option key={term} value={term}>
                {term}
              </option>
            ))}
          </select>
          <button
            className="btn btn--icon"
            onClick={saveCurrentSearch}
            disabled={!query.trim() || currentSearchSaved}
            title="Save current search"
          >
            +
          </button>
          <button
            className="btn btn--icon"
            onClick={removeCurrentSearch}
            disabled={!currentSearchSaved}
            title="Remove current saved search"
          >
            -
          </button>
          <button
            className="btn btn--primary"
            onClick={() => runSearch(offset)}
            disabled={searching || !query.trim()}
            title="Search from the current position"
          >
            {searching ? "Searching" : "Search"}
          </button>
          {searching ? (
            <button className="btn" onClick={cancelSearch}>
              Stop
            </button>
          ) : (
            <button
              className="btn"
              onClick={runFullSearch}
              disabled={!query.trim() || !size}
              title="Scan the whole file from the beginning"
            >
              Scan all
            </button>
          )}
          <button
            className={`btn btn--toggle${regex ? " active" : ""}`}
            onClick={() => setRegex((value) => !value)}
            title="Regex search"
          >
            .*
          </button>
          <button
            className={`btn btn--toggle${caseSensitive ? " active" : ""}`}
            onClick={() => setCaseSensitive((value) => !value)}
            title="Case sensitive"
          >
            Aa
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
          <select
            className="field huge-match-select"
            value={selectedSearchValue}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "") {
                setSearchIndex(-1);
                return;
              }
              selectSearchItem(searchItems, Number(value));
            }}
            disabled={!searchItems.length}
            title="Search hits"
          >
            <option value="">Hits ({searchItems.length})</option>
            {searchItems.map((item, index) => (
              <option key={`${item.offset}-${index}`} value={index}>
                {searchResultLabel(item, index, redact)}
              </option>
            ))}
          </select>
          <button className="btn" onClick={copySearchResults} disabled={!searchItems.length}>
            Copy hits
          </button>
          <button className="btn" onClick={downloadSearchResults} disabled={!searchItems.length}>
            Save hits
          </button>
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
            className={`btn btn--toggle${wrap ? " active" : ""}`}
            onClick={() => setWrap((value) => !value)}
            title="Wrap long rows"
          >
            Wrap
          </button>
          <button
            className={`btn btn--toggle${redact ? " active" : ""}`}
            onClick={() => setRedact((value) => !value)}
            title="Redact display, copy, and save output"
          >
            Redact
          </button>
          <select
            className="field huge-tone-filter"
            value={toneFilter}
            onChange={(event) => setToneFilter(event.target.value)}
            title="Filter by row tone"
          >
            <option value="all">All ({lines.length})</option>
            <option value="error">Errors ({toneCounts.error || 0})</option>
            <option value="warn">Warnings ({toneCounts.warn || 0})</option>
            <option value="ok">OK ({toneCounts.ok || 0})</option>
            <option value="info">Info ({toneCounts.info || 0})</option>
          </select>
          <button
            className="btn"
            onClick={addBookmark}
            disabled={!windowData}
            title="Bookmark current section or match"
          >
            Mark
          </button>
          <select
            className="field huge-bookmark-select"
            value={selectedBookmarkId}
            onChange={(event) => {
              const bookmark = bookmarks.find((item) => item.id === event.target.value);
              setSelectedBookmarkId(event.target.value);
              jumpToBookmark(bookmark);
            }}
            title="Bookmarks"
          >
            <option value="">Bookmarks ({bookmarks.length})</option>
            {bookmarks.map((bookmark) => (
              <option key={bookmark.id} value={bookmark.id}>
                {formatBytes(bookmark.offset)} - {bookmarkLabel(bookmark)}
              </option>
            ))}
          </select>
          <button
            className="btn btn--icon"
            onClick={removeSelectedBookmark}
            disabled={!selectedBookmark}
            title="Remove selected bookmark"
          >
            X
          </button>
          <button className="btn" onClick={copyBookmarks} disabled={!bookmarks.length}>
            Copy marks
          </button>
          <button className="btn" onClick={downloadBookmarks} disabled={!bookmarks.length}>
            Save marks
          </button>
          <button className="btn" onClick={() => bookmarkImportRef.current?.click()}>
            Import marks
          </button>
          <input
            ref={bookmarkImportRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={importBookmarks}
          />
          <button
            className="btn"
            onClick={copyRenderedSection}
            disabled={!displayedLines.length}
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
          <button
            className="btn"
            onClick={downloadRenderedSection}
            disabled={!displayedLines.length}
            title="Save rendered current section"
          >
            Save view
          </button>
          <button
            className="btn"
            onClick={downloadRawSection}
            disabled={!windowData}
            title="Save raw current section"
          >
            Save raw
          </button>
          {copyStatus ? <span className="huge-copy-status">{copyStatus}</span> : null}
        </div>
      </nav>

      <FileMetaBar
        info={fileInfo}
        viewerMode="byte"
        fileSize={size}
      />

      <div className="huge-status">
        <span>Huge stream mode</span>
        <span>Section {currentPage} / {totalPages}</span>
        <span>{formatBytes(offset)} / {formatBytes(size)}</span>
        <span>{progress.toFixed(2)}%</span>
        {redact ? <span>redacted</span> : null}
        {toneFilter !== "all" ? <span>{displayedLines.length} visible</span> : null}
        {searchToneSummary ? <span>hits {searchToneSummary}</span> : null}
        {notice ? <span>{notice}</span> : null}
      </div>

      {error ? <div className="idhub-banner">{error}</div> : null}

      <div className="huge-log-area">
        <div
          ref={scrollRef}
          className={`huge-log-scroll${wrap ? "" : " huge-log-scroll--nowrap"}`}
          onScroll={handleScroll}
          onWheel={handleWheel}
        >
          {loading && !displayedLines.length ? (
            <div className="viewer center huge-loading">loading section...</div>
          ) : displayedLines.length ? (
            displayedLines.map((line, index) => {
              const isActive = index === activeLineIndex;
              const text = displayText(line.text);
              return (
                <div
                  key={`${line.offset}-${index}`}
                  ref={isActive ? setActiveRow : undefined}
                  data-log-offset={line.offset}
                  className={`huge-log-row${lineNums ? " has-line-numbers" : ""}${line.tone ? ` huge-log-row--${line.tone}` : ""}${isActive ? " is-match" : ""}`}
                >
                  {lineNums ? (
                    <span className="huge-log-line-no">{index + 1}</span>
                  ) : null}
                  <span className="huge-log-offset">{formatBytes(line.offset)}</span>
                  <span className="huge-log-text">
                    {isActive ? highlightText(text, activeSearchRe) : text}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="viewer center huge-loading">no rows match this filter</div>
          )}
        </div>
      </div>
    </main>
  );
}
