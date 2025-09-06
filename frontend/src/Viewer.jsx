import { Virtuoso } from "react-virtuoso";
import { ROW, KEEP } from "./constants";
import useSearch from "./useSearch";
import TrackHandle from "./TrackHandle";
import Row from "./Row";

export default function Viewer({ virt, lines }) {
  const { controls, lineBar, lineNums } = useSearch();
  const gutter = lineNums ? 72 : 0;

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
        >
          ⤒
        </button>
        <button
          className="btn btn--icon"
          onClick={lines.goMiddle}
          title="Middle"
        >
          ⇵
        </button>
        <button
          className="btn btn--icon"
          onClick={lines.goBottom}
          title="Bottom"
        >
          ⤓
        </button>
        <div className="divider" />
        {controls}
      </nav>

      <div className={`subbar ${lineNums ? "open" : ""}`}>{lineBar}</div>

      <div
        ref={lines.boxRef}
        style={{ flex: 1, position: "relative", "--gutter": `${gutter}px` }}
      >
        <div className="gutter-border" />
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
          overscan={KEEP * ROW}
          rangeChanged={lines.handleRange}
        />
      </div>
    </main>
  );
}
