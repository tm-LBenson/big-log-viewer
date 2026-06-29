import { useMemo, useState } from "react";

function formatBytes(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = n;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function formatDate(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(n).toLocaleString();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

export default function FileMetaBar({
  info,
  viewerMode,
  lineCount,
  fileSize,
}) {
  const [status, setStatus] = useState("");
  const size = Number(fileSize || info?.size || 0);
  const modeLabel = viewerMode === "byte" ? "Huge stream" : "Line index";
  const facts = useMemo(
    () =>
      [
        info?.format,
        info?.hint,
        info?.compressed ? "gzip" : "",
        formatBytes(size),
        formatDate(info?.modTime),
        lineCount && viewerMode !== "byte" ? `${lineCount.toLocaleString()} lines` : "",
        modeLabel,
      ].filter(Boolean),
    [info, lineCount, modeLabel, size, viewerMode],
  );

  if (!info) return null;

  const handleCopy = async (label, text) => {
    if (!text) return;
    try {
      await copyText(text);
      setStatus(`${label} copied`);
      window.setTimeout(() => setStatus(""), 1400);
    } catch {
      setStatus("Copy failed");
      window.setTimeout(() => setStatus(""), 1400);
    }
  };

  const handleReveal = async () => {
    if (!info?.path) return;
    try {
      const response = await fetch(
        `/api/file-info/reveal?path=${encodeURIComponent(info.path)}`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(await response.text());
      setStatus("Opened folder");
      window.setTimeout(() => setStatus(""), 1400);
    } catch {
      setStatus("Open failed");
      window.setTimeout(() => setStatus(""), 1400);
    }
  };

  return (
    <div className="file-meta">
      <div className="file-meta__main" title={info.absPath || info.path}>
        <span className="file-meta__name">{info.name || info.path}</span>
        {facts.map((fact) => (
          <span key={fact} className="file-meta__pill">
            {fact}
          </span>
        ))}
      </div>
      <div className="file-meta__actions">
        {status ? <span className="file-meta__status">{status}</span> : null}
        <button
          className="btn"
          onClick={() => handleCopy("Path", info.absPath)}
          disabled={!info.absPath}
          title={info.absPath || "Path unavailable"}
        >
          Copy path
        </button>
        <button
          className="btn"
          onClick={() => handleCopy("Name", info.name || info.path)}
          disabled={!info.name && !info.path}
          title="Copy file name"
        >
          Copy name
        </button>
        <button
          className="btn"
          onClick={handleReveal}
          disabled={!info.path}
          title="Show this file in its folder"
        >
          Show folder
        </button>
      </div>
    </div>
  );
}
