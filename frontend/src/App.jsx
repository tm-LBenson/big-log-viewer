import { useState, useRef, useCallback } from "react";
import FileList from "./FileList";
import LogViewer from "./LogViewer";
import "./App.css";

export default function App() {
  const [file, setFile] = useState(null);
  const [width, setWidth] = useState(260);
  const drag = useRef(false);

  const onMouseMove = useCallback((e) => {
    if (!drag.current) return;
    const w = Math.min(600, Math.max(180, e.clientX));
    setWidth(w);
  }, []);

  const stopDrag = useCallback(() => {
    drag.current = false;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", stopDrag);
  }, [onMouseMove]);

  const startDrag = () => {
    drag.current = true;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopDrag);
  };

  return (
    <div
      className="app"
      style={{ gridTemplateColumns: `${width}px 6px 1fr` }}
    >
      <FileList
        sel={file}
        onSel={setFile}
      />
      <div
        className="resizer"
        onMouseDown={startDrag}
      />
      <LogViewer path={file} />
    </div>
  );
}
