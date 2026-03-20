import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { PAGE, WINDOW_MAX, HALF_WIN, ROW, HANDLE, SPEED } from "./constants";

const TOP_REBASE_TRIGGER_RATIO = 0.2;
const TOP_REBASE_TARGET_RATIO = 0.65;
const BOTTOM_REBASE_TRIGGER_RATIO = 0.8;
const BOTTOM_REBASE_TARGET_RATIO = 0.35;
const JUMP_RELEASE_DELAY = 220;
const NON_EDGE_MIN_FRAMES = 1;
const NON_EDGE_MAX_FRAMES = 20;
const NON_EDGE_STABLE_FRAMES = 2;
const EDGE_PIN_MIN_FRAMES = 10;
const EDGE_PIN_MAX_FRAMES = 24;
const EDGE_STABLE_FRAMES = 3;
const EDGE_TOLERANCE = 2;
const ALIGN_TOLERANCE = 16;
const MAX_QUEUED_JOYSTICK_ROWS = 1200;

function isNearTop(scroller) {
  return !scroller || scroller.scrollTop <= EDGE_TOLERANCE;
}

function isNearBottom(scroller) {
  if (!scroller) return true;
  return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= EDGE_TOLERANCE;
}

function forceScrollerEdge(scroller, edge) {
  if (!scroller || !edge) return;
  if (edge === "top") {
    scroller.scrollTop = 0;
    return;
  }
  if (edge === "bottom") {
    scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }
}

function clampQueuedRows(rows) {
  return Math.max(-MAX_QUEUED_JOYSTICK_ROWS, Math.min(MAX_QUEUED_JOYSTICK_ROWS, rows));
}

export default function useLines(path, virt) {
  const [ready, setReady] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const [windowCount, setWindowCount] = useState(WINDOW_MAX);
  const [base, setBase] = useState(0);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
  const [scrollVersion, setScrollVersion] = useState(0);

  const cache = useRef(new Map());
  const pending = useRef(new Set());

  const boxRef = useRef(null);
  const trackRef = useRef(null);
  const scrollerRef = useRef(null);
  const drag = useRef(0);
  const dragRange = useRef(1);
  const raf = useRef(0);
  const last = useRef(0);
  const queuedJoystickRows = useRef(0);

  const openCtrl = useRef(null);
  const pageCtrls = useRef(new Map());
  const pendingScroll = useRef(null);
  const scrollRequestId = useRef(0);
  const programmaticJump = useRef(null);
  const lastRange = useRef(null);
  const manualDirection = useRef(0);
  const directionResetTimer = useRef(0);

  const clampLine = useCallback(
    (line) => Math.max(0, Math.min(Math.max(0, lineCount - 1), line)),
    [lineCount],
  );

  const calcWindowCount = useCallback(
    (nextBase) => Math.max(0, Math.min(WINDOW_MAX, lineCount - nextBase)),
    [lineCount],
  );

  const clampBase = useCallback(
    (nextBase) => {
      const maxBase = Math.max(0, lineCount - Math.min(WINDOW_MAX, lineCount));
      return Math.max(0, Math.min(maxBase, nextBase));
    },
    [lineCount],
  );

  const isScrollRequestSettled = useCallback((request, currentBase) => {
    const range = lastRange.current;
    if (!range || range.base !== currentBase) return false;

    if (request.edge === "top") {
      return range.startIndex <= ALIGN_TOLERANCE && isNearTop(scrollerRef.current);
    }

    if (request.edge === "bottom") {
      return (
        range.endIndex >= Math.max(0, windowCount - 1 - ALIGN_TOLERANCE) &&
        isNearBottom(scrollerRef.current)
      );
    }

    const visible = request.index >= range.startIndex && request.index <= range.endIndex;
    if (!visible) return false;

    if (request.align === "start") {
      return Math.abs(range.startIndex - request.index) <= ALIGN_TOLERANCE;
    }

    if (request.align === "end") {
      return Math.abs(range.endIndex - request.index) <= ALIGN_TOLERANCE;
    }

    return true;
  }, [windowCount]);

  const cancelProgrammaticScroll = useCallback(() => {
    pendingScroll.current = null;
    programmaticJump.current = null;
    scrollRequestId.current += 1;
  }, []);

  const clearDirectionResetTimer = useCallback(() => {
    if (directionResetTimer.current) {
      window.clearTimeout(directionResetTimer.current);
      directionResetTimer.current = 0;
    }
  }, []);

  const setManualDirection = useCallback((direction, options = {}) => {
    const nextDirection = Math.sign(direction || 0);
    manualDirection.current = nextDirection;

    const { sticky = false, resetAfter = 140 } = options;
    clearDirectionResetTimer();

    if (sticky || nextDirection === 0) {
      return;
    }

    directionResetTimer.current = window.setTimeout(() => {
      manualDirection.current = 0;
      directionResetTimer.current = 0;
    }, resetAfter);
  }, [clearDirectionResetTimer]);

  const noteWheel = useCallback((deltaY) => {
    setManualDirection(deltaY, { resetAfter: 220 });
  }, [setManualDirection]);

  const releaseProgrammaticJump = useCallback((requestId) => {
    if (programmaticJump.current?.id === requestId) {
      programmaticJump.current = null;
    }
  }, []);

  const requestScroll = useCallback(
    (index, align = "start", options = {}) => {
      const id = scrollRequestId.current + 1;
      scrollRequestId.current = id;
      pendingScroll.current = {
        id,
        index,
        align,
        edge: options.edge || null,
      };
      if (options.lock) {
        programmaticJump.current = { id };
      }
      setScrollVersion((v) => v + 1);
    },
    [],
  );

  const syncWindow = useCallback(
    (nextBase, index, align = "start", options = {}) => {
      const clampedBase = clampBase(nextBase);
      const nextCount = calcWindowCount(clampedBase);
      const maxIndex = Math.max(0, nextCount - 1);

      setBase(clampedBase);
      setWindowCount(nextCount);
      setTick((t) => t + 1);

      requestScroll(Math.max(0, Math.min(maxIndex, index)), align, options);
    },
    [calcWindowCount, clampBase, requestScroll],
  );

  const applyQueuedJoystickRows = useCallback(() => {
    if (pendingScroll.current || !queuedJoystickRows.current) {
      return;
    }

    const rows = queuedJoystickRows.current;
    queuedJoystickRows.current = 0;
    virt.current?.scrollBy({ top: rows * ROW });
  }, [virt]);

  useLayoutEffect(() => {
    const request = pendingScroll.current;
    if (!request) {
      applyQueuedJoystickRows();
      return undefined;
    }

    let cancelled = false;
    let frameId = 0;
    let releaseTimer = 0;
    let stableFrames = 0;

    const finish = () => {
      const scroller = scrollerRef.current;
      forceScrollerEdge(scroller, request.edge);

      if (pendingScroll.current?.id === request.id) {
        pendingScroll.current = null;
      }
      applyQueuedJoystickRows();
      releaseTimer = window.setTimeout(
        () => releaseProgrammaticJump(request.id),
        JUMP_RELEASE_DELAY,
      );
    };

    const settle = (attempt) => {
      if (cancelled) return;
      if (pendingScroll.current?.id !== request.id) return;

      virt.current?.scrollToIndex({
        index: request.index,
        align: request.align,
        behavior: "auto",
      });

      const scroller = scrollerRef.current;
      forceScrollerEdge(scroller, request.edge);

      const settled = isScrollRequestSettled(request, base);
      stableFrames = settled ? stableFrames + 1 : 0;

      const reachedMinFrames = request.edge
        ? attempt >= EDGE_PIN_MIN_FRAMES
        : attempt >= NON_EDGE_MIN_FRAMES;
      const reachedMaxFrames = request.edge
        ? attempt >= EDGE_PIN_MAX_FRAMES
        : attempt >= NON_EDGE_MAX_FRAMES;
      const stableEnough = request.edge
        ? stableFrames >= EDGE_STABLE_FRAMES
        : stableFrames >= NON_EDGE_STABLE_FRAMES;

      if ((reachedMinFrames && stableEnough) || reachedMaxFrames) {
        finish();
        return;
      }

      frameId = requestAnimationFrame(() => settle(attempt + 1));
    };

    frameId = requestAnimationFrame(() => settle(0));

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(releaseTimer);
    };
  }, [
    applyQueuedJoystickRows,
    base,
    isScrollRequestSettled,
    scrollVersion,
    virt,
    releaseProgrammaticJump,
  ]);

  const fetchPage = useCallback(
    (p) => {
      const start = p * PAGE;
      if (start < 0 || start >= lineCount) return;
      if (cache.current.has(p) || pending.current.has(p)) return;

      pending.current.add(p);
      const ctrl = new AbortController();
      pageCtrls.current.set(p, ctrl);

      fetch(`/api/chunk?start=${start}&count=${PAGE}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((lines) => {
          if (ctrl.signal.aborted) return;
          cache.current.set(p, lines || []);
          setTick((t) => t + 1);
        })
        .catch(() => {})
        .finally(() => {
          pending.current.delete(p);
          pageCtrls.current.delete(p);
        });
    },
    [lineCount],
  );

  const ensure = useCallback(
    (fromAbs, toAbs) => {
      const fromPage = Math.floor(fromAbs / PAGE) - 1;
      const toPage = Math.floor(toAbs / PAGE) + 1;
      for (let p = fromPage; p <= toPage; p += 1) {
        if (p >= 0) fetchPage(p);
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    if (openCtrl.current) openCtrl.current.abort();
    pageCtrls.current.forEach((ctrl) => ctrl.abort());
    pageCtrls.current.clear();

    cache.current.clear();
    pending.current.clear();
    pendingScroll.current = null;
    programmaticJump.current = null;
    lastRange.current = null;
    queuedJoystickRows.current = 0;

    setReady(false);
    setError("");
    setBase(0);
    setLineCount(0);
    setWindowCount(WINDOW_MAX);
    setTick((t) => t + 1);

    if (!path) return undefined;

    const ctrl = new AbortController();
    openCtrl.current = ctrl;

    fetch(`/api/open?path=${encodeURIComponent(path)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (ctrl.signal.aborted) return undefined;

        const total = d.Lines || 0;
        const nextCount = Math.min(WINDOW_MAX, Math.max(0, total));

        setBase(0);
        setLineCount(total);
        setWindowCount(nextCount);
        setTick((t) => t + 1);

        return fetch(`/api/chunk?start=0&count=${PAGE}`, {
          signal: ctrl.signal,
        });
      })
      .then((r) => (r ? (r.ok ? r.json() : Promise.reject()) : []))
      .then((lines) => {
        if (ctrl.signal.aborted) return;
        cache.current.set(0, lines || []);
        setReady(true);
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setError("failed to open file");
        setReady(false);
      });

    return () => {
      ctrl.abort();
    };
  }, [path]);

  const abs = useCallback((i) => base + i, [base]);

  const getLine = useCallback(
    (i) => {
      const absoluteIndex = base + i;
      if (absoluteIndex >= lineCount) return "";
      const page = Math.floor(absoluteIndex / PAGE);
      const offset = absoluteIndex % PAGE;
      return cache.current.get(page)?.[offset] ?? "...";
    },
    [base, lineCount],
  );

  const pinCurrentWindowEdge = useCallback(
    (edge) => {
      const index = edge === "bottom" ? Math.max(0, windowCount - 1) : 0;
      const align = edge === "bottom" ? "end" : "start";
      requestScroll(index, align, { edge, lock: true });
    },
    [requestScroll, windowCount],
  );

  const jumpToLine = useCallback(
    (line, anchor = "context") => {
      if (!lineCount) return;

      const target = clampLine(line);
      const nextCount = Math.min(WINDOW_MAX, lineCount);
      let nextBase = base;
      let align = "start";
      let edge = null;

      switch (anchor) {
        case "top":
          nextBase = target;
          align = "start";
          edge = "top";
          break;
        case "center":
          nextBase = target - Math.floor(nextCount / 2);
          align = "center";
          break;
        case "bottom":
          nextBase = target - nextCount + 1;
          align = "end";
          edge = "bottom";
          break;
        default:
          if (target < base || target >= base + windowCount) {
            nextBase = target - HALF_WIN;
          }
          align = "start";
          break;
      }

      const clampedBase = clampBase(nextBase);
      const index = target - clampedBase;
      syncWindow(clampedBase, index, align, { edge, lock: true });
    },
    [base, clampBase, clampLine, lineCount, syncWindow, windowCount],
  );

  const goLine = useCallback((line) => jumpToLine(line, "context"), [jumpToLine]);

  const goTop = useCallback(() => {
    const scroller = scrollerRef.current;
    if (base === 0 && isNearTop(scroller)) {
      pinCurrentWindowEdge("top");
      return;
    }
    jumpToLine(0, "top");
  }, [base, jumpToLine, pinCurrentWindowEdge]);

  const goMiddle = useCallback(
    () => jumpToLine(Math.floor(lineCount / 2), "center"),
    [jumpToLine, lineCount],
  );

  const goBottom = useCallback(() => {
    const tailBase = Math.max(0, lineCount - Math.min(WINDOW_MAX, lineCount));
    const scroller = scrollerRef.current;
    if (base === tailBase && isNearBottom(scroller)) {
      pinCurrentWindowEdge("bottom");
      return;
    }
    jumpToLine(Math.max(0, lineCount - 1), "bottom");
  }, [base, jumpToLine, lineCount, pinCurrentWindowEdge]);

  const handleRange = useCallback(
    ({ startIndex, endIndex }) => {
      ensure(base + startIndex, base + endIndex);
      lastRange.current = { base, startIndex, endIndex };

      if (programmaticJump.current) {
        return;
      }

      const remainingBelow = lineCount - (base + windowCount);
      const topTrigger = Math.max(1, Math.floor(windowCount * TOP_REBASE_TRIGGER_RATIO));
      const topTarget = Math.max(0, Math.min(windowCount - 1, Math.floor(windowCount * TOP_REBASE_TARGET_RATIO)));
      const bottomTrigger = Math.max(topTrigger + 1, Math.floor(windowCount * BOTTOM_REBASE_TRIGGER_RATIO));
      const bottomTarget = Math.max(0, Math.min(windowCount - 1, Math.floor(windowCount * BOTTOM_REBASE_TARGET_RATIO)));
      const direction = manualDirection.current;

      if (startIndex >= bottomTrigger && remainingBelow > 0 && direction >= 0) {
        const shift = Math.min(remainingBelow, Math.max(1, startIndex - bottomTarget));
        syncWindow(base + shift, startIndex - shift, "start", { lock: true });
        return;
      }

      if (startIndex <= topTrigger && base > 0 && direction <= 0) {
        const shift = Math.min(base, Math.max(1, topTarget - startIndex));
        syncWindow(base - shift, startIndex + shift, "start", { lock: true });
      }
    },
    [base, ensure, lineCount, syncWindow, windowCount],
  );

  const animate = useCallback(
    (ts) => {
      if (!last.current) last.current = ts;
      const dt = (ts - last.current) / 1000;
      last.current = ts;

      const range = Math.max(1, dragRange.current);
      const rows = (drag.current / range) * SPEED * dt;
      if (rows) {
        setManualDirection(rows, { sticky: true });
        if (pendingScroll.current) {
          queuedJoystickRows.current = clampQueuedRows(
            queuedJoystickRows.current + rows,
          );
        } else {
          const appliedRows = rows + queuedJoystickRows.current;
          queuedJoystickRows.current = 0;
          virt.current?.scrollBy({ top: appliedRows * ROW });
        }
      } else if (!pendingScroll.current) {
        applyQueuedJoystickRows();
      }
      raf.current = requestAnimationFrame(animate);
    },
    [applyQueuedJoystickRows, setManualDirection, virt],
  );

  const startDrag = useCallback(
    (e) => {
      e.preventDefault();
      cancelProgrammaticScroll();
      queuedJoystickRows.current = 0;
      if (!trackRef.current) return;

      const rect = trackRef.current.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const range = Math.max(1, (rect.height - HANDLE) / 2);
      dragRange.current = range;
      last.current = 0;

      const move = (ev) => {
        const delta = Math.max(-range, Math.min(range, ev.clientY - mid));
        drag.current = delta;
        setManualDirection(delta, { sticky: true });
        trackRef.current.firstChild.style.top = `calc(50% + ${delta}px - ${
          HANDLE / 2
        }px)`;
      };

      const up = () => {
        drag.current = 0;
        setManualDirection(0);
        if (trackRef.current) {
          trackRef.current.firstChild.style.top = `calc(50% - ${HANDLE / 2}px)`;
        }
        cancelAnimationFrame(raf.current);
        last.current = 0;
        applyQueuedJoystickRows();
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      raf.current = requestAnimationFrame(animate);
    },
    [animate, applyQueuedJoystickRows, cancelProgrammaticScroll, setManualDirection],
  );

  useEffect(() => {
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      if (openCtrl.current) openCtrl.current.abort();
      pageCtrls.current.forEach((ctrl) => ctrl.abort());
      pageCtrls.current.clear();
      clearDirectionResetTimer();
    };
  }, [clearDirectionResetTimer]);

  return {
    abs,
    boxRef,
    count: lineCount,
    error,
    getLine,
    goBottom,
    goLine,
    goMiddle,
    goTop,
    handleRange,
    ready,
    scrollerRef,
    startDrag,
    cancelProgrammaticScroll,
    noteWheel,
    tick,
    trackRef,
    windowBase: base,
    windowCount,
  };
}
