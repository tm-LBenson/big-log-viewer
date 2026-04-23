const SESSION_KEY = "idhub:session:v3";
const LOCAL_KEY = "idhub:persist:v3";
const LEGACY_SESSION_KEY = "idhub:session:v2";
const LEGACY_LOCAL_KEY = "idhub:persist:v2";

function safeParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function normalizeJobSelection(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes(":")) return raw;
  return `source:${raw}`;
}

function legacyCacheKey(key) {
  const [tenantUrl = "", selection = ""] = String(key || "").split("|");
  if (!selection.startsWith("source:")) return "";
  return [tenantUrl, selection.slice("source:".length)].join("|");
}

export function makeKey(tenantUrl, jobSelection) {
  return [tenantUrl || "", normalizeJobSelection(jobSelection)].join("|");
}

export function loadIdHub() {
  const session =
    safeParse(sessionStorage.getItem(SESSION_KEY)) ||
    safeParse(sessionStorage.getItem(LEGACY_SESSION_KEY)) ||
    {};
  const local =
    safeParse(localStorage.getItem(LOCAL_KEY)) ||
    safeParse(localStorage.getItem(LEGACY_LOCAL_KEY)) ||
    {};

  return {
    tenantUrl: session.tenantUrl || local.tenantUrl || "",
    sessionId: session.sessionId || "",
    jobSelection: normalizeJobSelection(
      session.jobSelection || local.jobSelection || session.sourceId || local.sourceId,
    ),
    caches: session.caches || {},
  };
}

export function saveIdHub(state) {
  const persistent = {
    tenantUrl: state.tenantUrl || "",
    jobSelection: normalizeJobSelection(state.jobSelection),
  };
  const session = {
    ...persistent,
    sessionId: state.sessionId || "",
    caches: state.caches || {},
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.setItem(LOCAL_KEY, JSON.stringify(persistent));
}

export function readCache(state, key) {
  const current = state.caches?.[key];
  if (current) {
    return {
      jobs: current.jobs || [],
      page: current.page || 0,
      nextLink: current.nextLink || "",
      end: !!current.end,
    };
  }

  const legacy = state.caches?.[legacyCacheKey(key)];
  if (legacy) {
    return {
      jobs: legacy.jobs || [],
      page: legacy.page || 0,
      nextLink: legacy.nextLink || "",
      end: !!legacy.end,
    };
  }

  return { jobs: [], page: 0, nextLink: "", end: false };
}
