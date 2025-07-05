import { useRef } from "react";
import useLines from "./useLines";
import SearchProvider from "./SearchProvider";
import Viewer from "./Viewer";

export default function LogViewer({ path }) {
  const virt = useRef(null);
  const lines = useLines(path, virt);

  if (!path) return <main className="viewer center">select a log</main>;
  if (!lines.ready) return <main className="viewer center">loading…</main>;

  return (
    <SearchProvider
      goLine={lines.goLine}
      abs={lines.abs}
      getLine={lines.getLine}
    >
      <Viewer
        virt={virt}
        lines={lines}
      />
    </SearchProvider>
  );
}
