import { forwardRef } from "react";
import { HANDLE, TRACK_H } from "./constants";

export default forwardRef(function TrackHandle({ onPointerDown }, ref) {
  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        right: 0,
        width: 20,
        height: TRACK_H,
        userSelect: "none",
        zIndex: 10,
      }}
    >
      <div
        onPointerDown={onPointerDown}
        style={{
          position: "absolute",
          top: `calc(50% - ${HANDLE / 2}px)`,
          left: 4,
          width: 12,
          height: HANDLE,
          background: "#888",
          borderRadius: 6,
        }}
      />
    </div>
  );
});
