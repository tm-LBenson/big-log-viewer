import { useEffect, useRef, useState } from "react";
import useLines from "./useLines";
import SearchProvider from "./SearchProvider";
import Viewer from "./Viewer";
import HugeLogViewer from "./HugeLogViewer";

export default function LogViewer({ path }) {
  const virt = useRef(null);
  const lines = useLines(path, virt);
  const [fileInfo, setFileInfo] = useState(null);

  useEffect(() => {
    setFileInfo(null);
    if (!path) return undefined;
    const ctrl = new AbortController();
    fetch(`/api/file-info?path=${encodeURIComponent(path)}`, {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((info) => {
        if (!ctrl.signal.aborted) setFileInfo(info);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setFileInfo(null);
      });
    return () => ctrl.abort();
  }, [path]);

  if (!path) return <main className="viewer center">select a log</main>;
  if (lines.error) return <main className="viewer center">{lines.error}</main>;
  if (!lines.ready) return <main className="viewer center">loading...</main>;
  if (lines.fileMode === "byte") {
    return (
      <HugeLogViewer
        path={path}
        fileSize={lines.fileSize}
        fileInfo={fileInfo}
      />
    );
  }

  return (
    <SearchProvider
      goLine={lines.goLine}
      abs={lines.abs}
      getLine={lines.getLine}
      count={lines.count}
      fileMode={lines.fileMode}
    >
      <Viewer
        virt={virt}
        lines={lines}
        path={path}
        fileInfo={fileInfo}
      />
    </SearchProvider>
  );
}
