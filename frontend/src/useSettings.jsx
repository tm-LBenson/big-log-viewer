const KEY = "biglog:settings";

export const defaultSettings = {
  rootPath: "",
  extensions: [".log", ".txt", ".html"],
  theme: "dark",
  wrap: false,
  lastFile: "",
  htmlLight: false,
  hoverColorLight: "#eef2f7",
  lineHighlightColor: "#cfe3ff",
  markColor: "#7dd3fc",
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw);
    return { ...defaultSettings, ...parsed };
  } catch {
    return { ...defaultSettings };
  }
}
function save(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function normalizeExtInput(v) {
  return v
    .split(/[,\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .map((x) => (x === "*" ? "*" : x.startsWith(".") ? x : "." + x))
    .filter((x, i, a) => a.indexOf(x) === i);
}

export async function applyBackend(settings) {
  try {
    if (settings.rootPath) {
      await fetch("/api/root/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Path: settings.rootPath }),
      });
    }
  } catch (e) {
    console.error(e);
  }
  try {
    if (settings.extensions?.length) {
      await fetch("/api/extensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extensions: settings.extensions,
          mode: "replace",
        }),
      });
    }
  } catch (e) {
    console.error(e);
  }
}

export default function useSettings() {
  const get = () => load();
  const set = (patch) => {
    const next = { ...load(), ...patch };
    save(next);
    return next;
  };
  return { get, set };
}
