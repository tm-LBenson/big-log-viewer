import { useCallback, useEffect, useMemo, useState } from "react";
import useSettings, {
  normalizeExtInput,
  applyBackend,
  defaultSettings,
} from "./useSettings";

const FALLBACK_DEFAULTS = [
  ".log",
  ".txt",
  ".html",
  ".htm",
  ".csv",
  ".tsv",
  ".json",
  ".ndjson",
  ".xml",
  ".md",
  ".js",
  ".css",
];

const UPDATE_BUSY_STATES = new Set([
  "checking",
  "preparing",
  "cloning",
  "building",
  "closing",
  "restarting",
]);

function currentVersionLabel(status) {
  if (!status?.currentVersion) return "Local build";
  return status.currentModified
    ? `${status.currentVersion} (modified)`
    : status.currentVersion;
}

function latestVersionLabel(status) {
  if (!status?.latestVersion) return "Not checked yet";
  return status.latestVersion;
}

function installActionLabel(status) {
  return status?.goos === "windows"
    ? "Install update & restart"
    : "Install update";
}

function updateHeadline(status) {
  if (!status) return "Ready to check for updates.";
  if (status.error) return status.error;
  if (status.message) return status.message;
  switch (status.state) {
    case "checking":
      return "Checking for updates…";
    case "cloning":
      return "Downloading the latest build…";
    case "building":
      return "Building the updated binary…";
    case "closing":
      return "Installing the update. Big Log will close soon.";
    case "restarting":
      return "Restarting Big Log…";
    case "updated":
      return "Update installed. Restart Big Log manually.";
    default:
      return "Ready to check for updates.";
  }
}

function statusLabel(status) {
  if (!status) return "Ready";
  if (status.state === "error") return "Error";
  if (status.state === "checked" && status.updateAvailable) return "Update available";
  if (status.state === "checked" && !status.updateAvailable) return "Up to date";
  if (status.state === "updated") return "Restart required";
  if (UPDATE_BUSY_STATES.has(status.state)) return "Working";
  return "Ready";
}

function shouldShowInstall(status) {
  if (!status?.canApply) return false;
  if (UPDATE_BUSY_STATES.has(status.state)) return false;
  if (!status.latestVersion) return false;
  return status.updateAvailable || !status.currentVersion;
}

async function parseResponse(response, fallbackMessage) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(
      data?.error ||
        data?.message ||
        data?.lastError ||
        text ||
        `${fallbackMessage} (status ${response.status})`,
    );
  }
  return data;
}

export default function Settings({ open, onClose }) {
  const store = useSettings();
  const init = useMemo(() => store.get(), []);
  const [rootPath, setRootPath] = useState(init.rootPath);
  const [extsText, setExtsText] = useState(init.extensions.join(", "));
  const [theme, setTheme] = useState(init.theme || "dark");
  const [wrap, setWrap] = useState(!!init.wrap);
  const [htmlLight, setHtmlLight] = useState(!!init.htmlLight);
  const [hoverColorLight, setHoverColorLight] = useState(
    init.hoverColorLight || defaultSettings.hoverColorLight,
  );
  const [lineHL, setLineHL] = useState(
    init.lineHighlightColor || defaultSettings.lineHighlightColor,
  );
  const [markColor, setMarkColor] = useState(
    init.markColor || defaultSettings.markColor,
  );
  const [defaults, setDefaults] = useState(FALLBACK_DEFAULTS);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [awaitingRestart, setAwaitingRestart] = useState(false);

  const loadUpdateStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/update/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load update status");
      const data = await response.json();
      setUpdateStatus(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (open) document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/root")
      .then((r) => r.json())
      .then((d) => {
        if (!init.rootPath) setRootPath(d.Path || "");
      })
      .catch(() => {});
    fetch("/api/extensions")
      .then((r) => r.json())
      .then((d) => {
        const def = Array.isArray(d.Defaults) ? d.Defaults : FALLBACK_DEFAULTS;
        setDefaults(def);
        if (!init.extensions?.length) setExtsText(def.join(", "));
      })
      .catch(() => {});
    loadUpdateStatus();
  }, [open, init.extensions, init.rootPath, loadUpdateStatus]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!open) return undefined;
    const active = awaitingRestart || UPDATE_BUSY_STATES.has(updateStatus?.state);
    if (!active) return undefined;

    const timer = window.setInterval(async () => {
      try {
        const response = await fetch("/api/update/status", { cache: "no-store" });
        if (!response.ok) throw new Error("status unavailable");
        const data = await response.json();
        setUpdateStatus(data);
        if (data.state === "restarting") {
          setAwaitingRestart(data.goos === "windows");
          return;
        }
        if (data.state === "updated") {
          setAwaitingRestart(false);
          return;
        }
        if (data.state === "error") {
          setAwaitingRestart(false);
          return;
        }
        if (awaitingRestart && !UPDATE_BUSY_STATES.has(data.state)) {
          window.location.reload();
        }
      } catch {
        if (!awaitingRestart && updateStatus?.state !== "restarting") return;
        try {
          const ping = await fetch("/api/root", { cache: "no-store" });
          if (ping.ok) window.location.reload();
        } catch {
          // keep waiting for the restarted server
        }
      }
    }, 1200);

    return () => window.clearInterval(timer);
  }, [open, updateStatus?.state, awaitingRestart]);

  if (!open) return null;

  const onSave = async () => {
    const next = {
      rootPath: rootPath.trim(),
      extensions: normalizeExtInput(extsText),
      theme,
      wrap,
      htmlLight,
      hoverColorLight,
      lineHighlightColor: lineHL,
      markColor,
    };
    store.set(next);
    await applyBackend(next);
    onClose(true);
  };

  const restoreColorDefaults = () => {
    setHoverColorLight(defaultSettings.hoverColorLight);
    setLineHL(defaultSettings.lineHighlightColor);
    setMarkColor(defaultSettings.markColor);
  };

  const checkForUpdates = async () => {
    setUpdateStatus((prev) => ({
      ...(prev || {}),
      state: "checking",
      message: "Checking for updates…",
      error: "",
    }));
    setAwaitingRestart(false);
    try {
      const response = await fetch("/api/update/check", {
        method: "POST",
      });
      const data = await parseResponse(response, "Failed to check for updates");
      setUpdateStatus(data);
    } catch (error) {
      setUpdateStatus((prev) => ({
        ...(prev || {}),
        state: "error",
        message: "Failed to check for updates.",
        error: error?.message || "Failed to check for updates.",
      }));
    }
  };

  const installUpdate = async () => {
    try {
      const response = await fetch("/api/update/apply", {
        method: "POST",
      });
      const data = await parseResponse(response, "Failed to start the update");
      setUpdateStatus(data);
      setAwaitingRestart(data?.goos === "windows");
    } catch (error) {
      setUpdateStatus((prev) => ({
        ...(prev || {}),
        state: "error",
        message: "Failed to start the update.",
        error: error?.message || "Failed to start the update.",
      }));
      setAwaitingRestart(false);
    }
  };

  const busyUpdating = UPDATE_BUSY_STATES.has(updateStatus?.state);

  return (
    <div className="modal">
      <div className="modal-panel">
        <h3>Settings</h3>

        <div className="form-row">
          <label>Log folder</label>
          <input
            className="field"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            placeholder="path to logs"
          />
        </div>

        <div className="form-row">
          <label>File extensions</label>
          <input
            className="field"
            value={extsText}
            onChange={(e) => setExtsText(e.target.value)}
            placeholder=".log, .txt, .html, *"
          />
          <div className="hint">
            Comma or space separated. Use * to allow any text file.
          </div>
          <div className="chip-row">
            <button
              className="chip"
              onClick={() => setExtsText(defaults.join(", "))}
            >
              Use defaults
            </button>
            <button
              className="chip"
              onClick={() => setExtsText("*, .log")}
            >
              Allow all text
            </button>
          </div>
        </div>

        <div className="form-row">
          <label>Theme</label>
          <select
            className="field"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>

        <div className="form-row inline">
          <input
            id="wrap"
            type="checkbox"
            checked={wrap}
            onChange={(e) => setWrap(e.target.checked)}
          />
          <label htmlFor="wrap">Wrap long lines by default</label>
        </div>

        <div className="form-row inline">
          <input
            id="htmlLight"
            type="checkbox"
            checked={htmlLight}
            onChange={(e) => setHtmlLight(e.target.checked)}
          />
          <label htmlFor="htmlLight">
            Preserve HTML colors (white log background)
          </label>
        </div>

        <div className="form-row">
          <label>Row hover on white</label>
          <input
            className="field"
            type="color"
            value={hoverColorLight}
            onChange={(e) => setHoverColorLight(e.target.value)}
          />
        </div>

        <div className="form-row">
          <label>Line highlight</label>
          <input
            className="field"
            type="color"
            value={lineHL}
            onChange={(e) => setLineHL(e.target.value)}
          />
        </div>

        <div className="form-row">
          <label>Word highlight</label>
          <input
            className="field"
            type="color"
            value={markColor}
            onChange={(e) => setMarkColor(e.target.value)}
          />
        </div>

        <div className="settings-section">
          <div className="settings-section__head">
            <div>
              <div className="settings-section__title">Updates</div>
              <div className="settings-section__subtitle">{statusLabel(updateStatus)}</div>
            </div>
            <div className="settings-update-actions">
              <button
                className="btn"
                onClick={checkForUpdates}
                disabled={busyUpdating}
              >
                Check for updates
              </button>
              {shouldShowInstall(updateStatus) ? (
                <button
                  className="btn btn--primary"
                  onClick={installUpdate}
                  disabled={busyUpdating}
                >
                  {installActionLabel(updateStatus)}
                </button>
              ) : null}
            </div>
          </div>

          <div className="settings-update-grid">
            <div className="settings-update-row">
              <span>Current version</span>
              <strong>{currentVersionLabel(updateStatus)}</strong>
            </div>
            <div className="settings-update-row">
              <span>Latest version</span>
              <strong>{latestVersionLabel(updateStatus)}</strong>
            </div>
          </div>

          <div className="settings-update-note">{updateHeadline(updateStatus)}</div>
          {!updateStatus?.canApply && updateStatus?.unsupportedReason ? (
            <div className="hint settings-update-hint">
              {updateStatus.unsupportedReason}
            </div>
          ) : null}
        </div>

        <div className="modal-actions">
          <button
            className="btn"
            onClick={restoreColorDefaults}
          >
            Restore color defaults
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="btn"
            onClick={() => onClose(false)}
          >
            Cancel
          </button>
          <button
            className="btn btn--primary"
            onClick={onSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
