import { useState, useRef, useCallback, useEffect } from "react";
import FileList from "./FileList";
import LogViewer from "./LogViewer";
import Settings from "./Settings";
import useSettings, { applyBackend } from "./useSettings";
import "./App.css";

export default function App() {
  const [file, setFile] = useState(null);
  const [width, setWidth] = useState(260);
  const [openSettings, setOpenSettings] = useState(false);
  const fileListRef = useRef(null);
  const drag = useRef(false);
  const store = useSettings();

  useEffect(() => {
    const s = store.get();
    document.documentElement.setAttribute("data-theme", s.theme || "dark");
    if (s.lastFile) setFile(s.lastFile);
    applyBackend(s).then(() => fileListRef.current?.reload());
  }, []);

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

  const startDrag = (e) => {
    e.preventDefault();
    drag.current = true;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopDrag);
  };

  const onSelectFile = (p) => {
    setFile(p);
    store.set({ lastFile: p });
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          Big Log
        </div>
        <div className="spacer" />
        <button
          className="btn"
          onClick={() => setOpenSettings(true)}
        >
          ⚙ Settings
        </button>
      </header>

      <div
        className="app"
        style={{ gridTemplateColumns: `${width}px 6px 1fr` }}
      >
        <FileList
          ref={fileListRef}
          sel={file}
          onSel={onSelectFile}
          onLoaded={(paths) => {
            const last = store.get().lastFile;
            if (last && !paths.includes(last)) setFile(null);
          }}
        />
        <div
          className="resizer"
          onMouseDown={startDrag}
        />
        <LogViewer path={file} />
      </div>

      <Settings
        open={openSettings}
        onClose={(applied) => {
          setOpenSettings(false);
          if (applied) {
            setFile(null);
            fileListRef.current?.reload();
          }
        }}
      />
    </>
  );
}
