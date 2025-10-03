import { useEffect, useMemo, useState } from "react";
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
  }, [open]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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
