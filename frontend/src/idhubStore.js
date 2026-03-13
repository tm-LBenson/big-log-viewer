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
    remember: !!local.remember,
    tenantUrl: session.tenantUrl || local.tenantUrl || "",
    sessionId: session.sessionId || "",
    sourceId: session.sourceId || local.sourceId || "",
    caches: session.caches || local.caches || {},
  };
}

export function saveIdHub(state) {
  const persistent = {
    remember: !!state.remember,
    tenantUrl: state.tenantUrl || "",
    sourceId: state.sourceId || "",
    caches: state.caches || {},
  };
  const session = {
    ...persistent,
    sessionId: state.sessionId || "",
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  if (persistent.remember) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(persistent));
  } else {
    localStorage.removeItem(LOCAL_KEY);
  }
}

export function readCache(state, key) {
  return state.caches?.[key] || { jobs: [], page: 0, end: false };
}
