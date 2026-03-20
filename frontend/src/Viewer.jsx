import { useRef, useState, useEffect, forwardRef, useMemo, useCallback } from "react";
import { Virtuoso } from "react-virtuoso";
import { ROW, KEEP } from "./constants";
import useSearch from "./useSearch";
import TrackHandle from "./TrackHandle";
import Row from "./Row";
import IdHubDashboard from "./IdHubDashboard";

export default function Viewer({ virt, lines, path }) {
  const { controls, lineBar, lineNums, htmlLight, colors, mode, wrap } = useSearch();
  const gutter = lineNums ? 72 : 0;

  const scrollerRef = useRef(null);
  const listRef = useRef(null);
  const hbarRef = useRef(null);
  const [xw, setXw] = useState(0);
  const syncing = useRef(false);
  const viewerRefs = useRef({
    hbarRef,
    listRef,
    linesScrollerRef: lines.scrollerRef,
    noteWheel: lines.noteWheel,
    cancelProgrammaticScroll: lines.cancelProgrammaticScroll,
    outerScrollerRef: scrollerRef,
    syncing,
  });

  viewerRefs.current.hbarRef = hbarRef;
  viewerRefs.current.listRef = listRef;
  viewerRefs.current.linesScrollerRef = lines.scrollerRef;
  viewerRefs.current.noteWheel = lines.noteWheel;
  viewerRefs.current.cancelProgrammaticScroll = lines.cancelProgrammaticScroll;
  viewerRefs.current.outerScrollerRef = scrollerRef;
  viewerRefs.current.syncing = syncing;

  const Scroller = useMemo(
    () =>
      forwardRef(function ViewerScroller(props, ref) {
        const refs = viewerRefs.current;
        return (
          <div
            ref={(el) => {
              refs.outerScrollerRef.current = el;
              if (refs.linesScrollerRef) refs.linesScrollerRef.current = el;
              if (typeof ref === "function") ref(el);
              else if (ref) ref.current = el;
            }}
            {...props}
            className="virt-scroller"
            onPointerDown={(e) => {
              refs.cancelProgrammaticScroll?.();
              props.onPointerDown?.(e);
            }}
            onWheel={(e) => {
              refs.noteWheel?.(e.deltaY);
              refs.cancelProgrammaticScroll?.();
              props.onWheel?.(e);
            }}
            onScroll={(e) => {
              props.onScroll?.(e);
              const hbar = refs.hbarRef.current;
              const scroller = refs.outerScrollerRef.current;
              if (hbar && scroller && !refs.syncing.current) {
                refs.syncing.current = true;
                hbar.scrollLeft = scroller.scrollLeft;
                refs.syncing.current = false;
              }
            }}
          />
        );
      }),
    [],
  );

  const List = useMemo(
    () =>
      forwardRef(function ViewerList(props, ref) {
        const refs = viewerRefs.current;
        return (
          <div
            ref={(el) => {
              refs.listRef.current = el;
              if (typeof ref === "function") ref(el);
              else if (ref) ref.current = el;
            }}
            {...props}
            className="virt-list"
          />
        );
      }),
    [],
  );

  const virtuosoComponents = useMemo(() => ({ Scroller, List }), [Scroller, List]);

  const updateScrollWidth = useCallback(() => {
    const nextWidth = listRef.current ? listRef.current.scrollWidth : 0;
    setXw((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
  }, []);

  useEffect(() => {
    updateScrollWidth();
  }, [lines.tick, updateScrollWidth]);

  useEffect(() => {
    updateScrollWidth();
    const ro = new ResizeObserver(updateScrollWidth);
    if (listRef.current) ro.observe(listRef.current);
    window.addEventListener("resize", updateScrollWidth);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateScrollWidth);
    };
  }, [updateScrollWidth]);

  useEffect(() => {
    if (!hbarRef.current || !scrollerRef.current) return;
    const onH = () => {
      if (syncing.current) return;
      syncing.current = true;
      scrollerRef.current.scrollLeft = hbarRef.current.scrollLeft;
      syncing.current = false;
    };
    hbarRef.current.addEventListener("scroll", onH, { passive: true });
    return () =>
      hbarRef.current && hbarRef.current.removeEventListener("scroll", onH);
  }, []);

  return (
    <main
      className="viewer"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        paddingLeft: mode === "idhub" ? 0 : 8,
      }}
    >
      <nav className="toolbar">
        <button
          className="btn btn--icon"
          onClick={lines.goTop}
          title="Top"
          disabled={mode === "idhub"}
        >
          ⤒
        </button>
        <button
          className="btn btn--icon"
          onClick={lines.goMiddle}
          title="Middle"
          disabled={mode === "idhub"}
        >
          ⇵
        </button>
        <button
          className="btn btn--icon"
          onClick={lines.goBottom}
          title="Bottom"
          disabled={mode === "idhub"}
        >
          ⤓
        </button>
        <div className="divider" />
        {controls}
      </nav>

      {mode === "standard" && (
        <div className={`subbar ${lineNums ? "open" : ""}`}>{lineBar}</div>
      )}

      {mode === "idhub" ? (
        <IdHubDashboard path={path} />
      ) : (
        <div
          ref={lines.boxRef}
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            overflow: "hidden",
            position: "relative",
            "--gutter": `${gutter}px`,
            "--row-hover": htmlLight ? colors.hover : undefined,
            "--mark-bg": colors.mark,
            "--hl-line-bg": colors.line,
            background: htmlLight ? "#fff" : "transparent",
            color: htmlLight ? "#111" : "inherit",
            paddingBottom: 12,
          }}
        >
          <div
            className="gutter-border"
            style={{ display: lineNums ? "block" : "none" }}
          />
          <TrackHandle
            ref={lines.trackRef}
            onPointerDown={lines.startDrag}
          />
          <Virtuoso
            ref={virt}
            totalCount={lines.windowCount}
            itemContent={(index) => (
              <Row
                i={index}
                tick={lines.tick}
              />
            )}
            style={{ height: "100%", width: "100%", paddingRight: 20 }}
            increaseViewportBy={{ top: KEEP * ROW, bottom: KEEP * ROW }}
            defaultItemHeight={ROW}
            fixedItemHeight={wrap ? undefined : ROW}
            rangeChanged={lines.handleRange}
            components={virtuosoComponents}
          />
          <div
            className="xbar"
            ref={hbarRef}
          >
            <div style={{ width: xw }} />
          </div>
        </div>
      )}
    </main>
  );
}
