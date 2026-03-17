import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { PAGE, WINDOW_MAX, HALF_WIN, ROW, HANDLE, SPEED } from "./constants";

const LOW_WATER = Math.floor(HALF_WIN / 2);
const HIGH_WATER = WINDOW_MAX - LOW_WATER;
const JUMP_RELEASE_DELAY = 220;
const JUMP_SETTLE_ATTEMPTS = 6;
const EDGE_PIN_MIN_FRAMES = 10;
const EDGE_PIN_MAX_FRAMES = 24;
const EDGE_STABLE_FRAMES = 3;
const EDGE_TOLERANCE = 2;

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

export default function useLines(path, virt) {
  const [ready, setReady] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const [windowCount, setWindowCount] = useState(WINDOW_MAX);
<<<<<<< HEAD
  const [base, setBase] = useState(0);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
  const [scrollVersion, setScrollVersion] = useState(0);
=======
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a

  const cache = useRef(new Map());
  const pending = useRef(new Set());

  const boxRef = useRef(null);
  const trackRef = useRef(null);
  const scrollerRef = useRef(null);
  const drag = useRef(0);
  const dragRange = useRef(1);
  const raf = useRef(0);
  const last = useRef(0);

  const openCtrl = useRef(null);
  const pageCtrls = useRef(new Map());
  const pendingScroll = useRef(null);
  const scrollRequestId = useRef(0);
  const programmaticJump = useRef(null);

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

  useLayoutEffect(() => {
    const request = pendingScroll.current;
    if (!request) return undefined;

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

      const settled =
        request.edge === "top"
          ? isNearTop(scroller)
          : request.edge === "bottom"
            ? isNearBottom(scroller)
            : attempt > 0;

      stableFrames = settled ? stableFrames + 1 : 0;

      const reachedMinFrames =
        !request.edge || attempt >= EDGE_PIN_MIN_FRAMES;
      const reachedMaxFrames = request.edge
        ? attempt >= EDGE_PIN_MAX_FRAMES
        : attempt >= JUMP_SETTLE_ATTEMPTS;
      const stableEnough = request.edge
        ? stableFrames >= EDGE_STABLE_FRAMES
        : settled;

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
  }, [base, windowCount, scrollVersion, virt, releaseProgrammaticJump]);

  const openCtrl = useRef(null);
  const pageCtrls = useRef(new Map());

  const fetchPage = useCallback(
    (p) => {
      const start = p * PAGE;
      if (start < 0 || start >= lineCount) return;
      if (cache.current.has(p) || pending.current.has(p)) return;

      pending.current.add(p);
      const ctrl = new AbortController();
      pageCtrls.current.set(p, ctrl);
<<<<<<< HEAD

      fetch(`/api/chunk?start=${start}&count=${PAGE}`, { signal: ctrl.signal })
=======
      fetch(`/api/chunk?start=${s}&count=${PAGE}`, { signal: ctrl.signal })
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
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

    setReady(false);
    setError("");
<<<<<<< HEAD
    setBase(0);
    setLineCount(0);
    setWindowCount(WINDOW_MAX);
    setTick((t) => t + 1);

    if (!path) return undefined;
=======
    base.current = 0;
    if (!path) return;
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a

    const ctrl = new AbortController();
    openCtrl.current = ctrl;

    fetch(`/api/open?path=${encodeURIComponent(path)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
<<<<<<< HEAD
        if (ctrl.signal.aborted) return undefined;

        const total = d.Lines || 0;
        const nextCount = Math.min(WINDOW_MAX, Math.max(0, total));

        setBase(0);
        setLineCount(total);
        setWindowCount(nextCount);
        setTick((t) => t + 1);

=======
        if (ctrl.signal.aborted) return;
        const total = d.Lines || 0;
        setLineCount(total);
        setWindowCount(Math.min(WINDOW_MAX, Math.max(0, total)));
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
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

<<<<<<< HEAD
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
=======
  const resize = () =>
    setWindowCount(Math.max(0, Math.min(WINDOW_MAX, lineCount - base.current)));
  const abs = (i) => base.current + i;

  const getLine = (i) => {
    const n = abs(i);
    if (n >= lineCount) return "";
    const p = Math.floor(n / PAGE);
    const o = n % PAGE;
    return cache.current.get(p)?.[o] ?? "...";
  };
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a

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

<<<<<<< HEAD
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
=======
  const handleRange = ({ startIndex, endIndex }) => {
    scrolled.current = true;
    ensure(abs(startIndex), abs(endIndex));
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!scrolled.current) return;
    if (startIndex > HALF_WIN && base.current + windowCount < lineCount) {
      base.current += HALF_WIN;
      resize();
      virt.current?.scrollToIndex({
        index: startIndex - HALF_WIN,
        align: "start",
      });
    } else if (startIndex < 0 && base.current > 0) {
      base.current = Math.max(0, base.current - HALF_WIN);
      resize();
      virt.current?.scrollToIndex({
        index: startIndex + HALF_WIN,
        align: "start",
      });
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
    }
    jumpToLine(Math.max(0, lineCount - 1), "bottom");
  }, [base, jumpToLine, lineCount, pinCurrentWindowEdge]);

<<<<<<< HEAD
  const handleRange = useCallback(
    ({ startIndex, endIndex }) => {
      ensure(base + startIndex, base + endIndex);

      if (programmaticJump.current) {
        return;
      }

      const remainingBelow = lineCount - (base + windowCount);
      if (startIndex > HIGH_WATER && remainingBelow > 0) {
        const shift = Math.min(HALF_WIN, remainingBelow);
        syncWindow(base + shift, startIndex - shift, "start");
        return;
      }
=======
  const animate = (ts) => {
    if (!last.current) last.current = ts;
    const rows = (drag.current / RANGE) * SPEED * ((ts - last.current) / 1000);
    last.current = ts;
    if (rows) virt.current?.scrollBy({ top: rows * ROW });
    raf.current = requestAnimationFrame(animate);
  };

  const startDrag = (e) => {
    e.preventDefault();
    scrolled.current = true;
    if (!trackRef.current) return;
    const mid = trackRef.current.getBoundingClientRect().top + TRACK_H / 2;
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a

      if (startIndex < LOW_WATER && base > 0) {
        const shift = Math.min(HALF_WIN, base);
        syncWindow(base - shift, startIndex + shift, "start");
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
      if (rows) virt.current?.scrollBy({ top: rows * ROW });
      raf.current = requestAnimationFrame(animate);
    },
    [virt],
  );

  const startDrag = useCallback(
    (e) => {
      e.preventDefault();
      if (!trackRef.current) return;

      const rect = trackRef.current.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const range = Math.max(1, (rect.height - HANDLE) / 2);
      dragRange.current = range;
      last.current = 0;

      const move = (ev) => {
        const delta = Math.max(-range, Math.min(range, ev.clientY - mid));
        drag.current = delta;
        trackRef.current.firstChild.style.top = `calc(50% + ${delta}px - ${
          HANDLE / 2
        }px)`;
      };

      const up = () => {
        drag.current = 0;
        if (trackRef.current) {
          trackRef.current.firstChild.style.top = `calc(50% - ${HANDLE / 2}px)`;
        }
        cancelAnimationFrame(raf.current);
        last.current = 0;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      raf.current = requestAnimationFrame(animate);
    },
    [animate],
  );

  useEffect(() => {
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      if (openCtrl.current) openCtrl.current.abort();
      pageCtrls.current.forEach((ctrl) => ctrl.abort());
      pageCtrls.current.clear();
    };
<<<<<<< HEAD
  }, []);
=======

    const up = () => {
      drag.current = 0;
      if (trackRef.current) {
        trackRef.current.firstChild.style.top = `calc(50% - ${HANDLE / 2}px)`;
      }
      cancelAnimationFrame(raf.current);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    raf.current = requestAnimationFrame(animate);
  };
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a

  useEffect(() => {
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      if (openCtrl.current) openCtrl.current.abort();
      pageCtrls.current.forEach((c) => c.abort());
      pageCtrls.current.clear();
    };
  }, []);

  return {
<<<<<<< HEAD
    abs,
=======
    tick,
    ready,
    error,
    count: lineCount,
    windowCount,
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
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
    tick,
    trackRef,
    windowBase: base,
    windowCount,
  };
}
