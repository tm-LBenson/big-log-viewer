import { useRef, useState, useLayoutEffect, forwardRef } from "react";
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

  const Scroller = forwardRef(function Scroller(props, ref) {
    return (
      <div
        ref={(el) => {
          scrollerRef.current = el;
          if (lines.scrollerRef) lines.scrollerRef.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        {...props}
        className="virt-scroller"
        onPointerDown={(e) => {
          lines.cancelProgrammaticScroll?.();
          props.onPointerDown?.(e);
        }}
        onWheel={(e) => {
          lines.cancelProgrammaticScroll?.();
          props.onWheel?.(e);
        }}
        onScroll={(e) => {
          props.onScroll?.(e);
          if (hbarRef.current && !syncing.current) {
            syncing.current = true;
            hbarRef.current.scrollLeft = scrollerRef.current.scrollLeft;
            syncing.current = false;
          }
        }}
      />
    );
  });

  const List = forwardRef(function List(props, ref) {
    return (
      <div
        ref={(el) => {
          listRef.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        {...props}
        className="virt-list"
      />
    );
  });

  useLayoutEffect(() => {
    const upd = () => setXw(listRef.current ? listRef.current.scrollWidth : 0);
    upd();
    const ro = new ResizeObserver(upd);
    if (listRef.current) ro.observe(listRef.current);
    const onResize = () => upd();
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [lines.tick]);

  useLayoutEffect(() => {
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
        paddingLeft: 8,
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
            itemContent={(index) => <Row i={index} />}
            computeItemKey={(index) => lines.abs(index)}
            style={{ height: "100%", width: "100%", paddingRight: 20 }}
            overscan={KEEP * ROW}
            defaultItemHeight={ROW}
            fixedItemHeight={wrap ? undefined : ROW}
            rangeChanged={lines.handleRange}
            components={{ Scroller, List }}
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
