import { Virtuoso } from "react-virtuoso";
import { ROW, KEEP } from "./constants";
import useSearch from "./useSearch";
import TrackHandle from "./TrackHandle";
import Row from "./Row";

export default function Viewer({ virt, lines }) {
  const { controls } = useSearch();

  return (
    <main
      className="viewer"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <nav
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          padding: "6px 8px",
          borderBottom: "1px solid #444",
        }}
      >
        <button onClick={lines.goTop}>⤒</button>
        <button onClick={lines.goMiddle}>⇵</button>
        <button onClick={lines.goBottom}>⤓</button>
        {controls}
      </nav>

      <div
        ref={lines.boxRef}
        style={{ flex: 1, position: "relative" }}
      >
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
