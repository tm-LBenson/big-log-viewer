import { forwardRef } from "react";
import { HANDLE } from "./constants";

export default forwardRef(function TrackHandle({ onPointerDown }, ref) {
  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 12,
        width: 20,
        userSelect: "none",
        zIndex: 10,
        pointerEvents: "none",
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
          pointerEvents: "auto",
<<<<<<< HEAD
          cursor: "grab",
=======
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
        }}
      />
    </div>
  );
});
