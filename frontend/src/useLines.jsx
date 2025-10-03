import { useState, useRef, useEffect, useCallback } from "react";
import {
  PAGE,
  WINDOW_MAX,
  HALF_WIN,
  ROW,
  RANGE,
  SPEED,
  HANDLE,
  TRACK_H,
} from "./constants";

export default function useLines(path, virt) {
  const [ready, setReady] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const [windowCount, setWindowCount] = useState(WINDOW_MAX);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");

  const base = useRef(0);
  const cache = useRef(new Map());
  const pending = useRef(new Set());

  const boxRef = useRef(null);
  const trackRef = useRef(null);
  const drag = useRef(0);
  const raf = useRef(0);
  const last = useRef(0);
  const scrolled = useRef(false);
  const mounted = useRef(false);

  const openCtrl = useRef(null);
  const pageCtrls = useRef(new Map());

  const fetchPage = useCallback(
    (p) => {
      const s = p * PAGE;
      if (s < 0 || s >= lineCount) return;
      if (cache.current.has(p) || pending.current.has(p)) return;
      pending.current.add(p);
      const ctrl = new AbortController();
      pageCtrls.current.set(p, ctrl);
      fetch(`/api/chunk?start=${s}&count=${PAGE}`, { signal: ctrl.signal })
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
    (f, t) => {
      const a = Math.floor(f / PAGE) - 1;
      const b = Math.floor(t / PAGE) + 1;
      for (let p = a; p <= b; p++) if (p >= 0) fetchPage(p);
    },
    [fetchPage],
  );

  useEffect(() => {
    cache.current.clear();
    pending.current.clear();
    setReady(false);
    setError("");
    base.current = 0;
    if (!path) return;

    const ctrl = new AbortController();
    openCtrl.current = ctrl;

    fetch(`/api/open?path=${encodeURIComponent(path)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (ctrl.signal.aborted) return;
        const total = d.Lines || 0;
        setLineCount(total);
        setWindowCount(Math.min(WINDOW_MAX, Math.max(0, total)));
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
    } else {
      virt.current?.scrollToIndex({
        index: tgt - base.current,
        align: "start",
      });
    }
  };

  const goTop = () => goLine(0);
  const goMiddle = () => goLine(Math.floor(lineCount / 2));
  const goBottom = () => goLine(lineCount - 1);

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
    }
  };

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

    const move = (ev) => {
      let d = ev.clientY - mid;
      d = Math.max(-RANGE, Math.min(RANGE, d));
      drag.current = d;
      trackRef.current.firstChild.style.top = `calc(50% + ${d}px - ${
        HANDLE / 2
      }px)`;
    };

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

  useEffect(() => {
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      if (openCtrl.current) openCtrl.current.abort();
      pageCtrls.current.forEach((c) => c.abort());
      pageCtrls.current.clear();
    };
  }, []);

  return {
    tick,
    ready,
    error,
    count: lineCount,
    windowCount,
    boxRef,
    trackRef,
    handleRange,
    goTop,
    goMiddle,
    goBottom,
    goLine,
    abs,
    getLine,
    startDrag,
  };
}
