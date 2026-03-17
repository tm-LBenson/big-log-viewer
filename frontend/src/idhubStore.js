const SESSION_KEY = "idhub:session:v2";
const LOCAL_KEY = "idhub:persist:v2";

function safeParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function makeKey(tenantUrl, sourceId) {
  return [tenantUrl || "", sourceId || ""].join("|");
}

export function loadIdHub() {
  const session = safeParse(sessionStorage.getItem(SESSION_KEY)) || {};
  const local = safeParse(localStorage.getItem(LOCAL_KEY)) || {};
  return {
    tenantUrl: session.tenantUrl || local.tenantUrl || "",
    sessionId: session.sessionId || "",
    sourceId: session.sourceId || local.sourceId || "",
    caches: session.caches || {},
  };
}

export function saveIdHub(state) {
  const persistent = {
    tenantUrl: state.tenantUrl || "",
    sourceId: state.sourceId || "",
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
  return state.caches?.[key] || { jobs: [], page: 0, end: false };
}
