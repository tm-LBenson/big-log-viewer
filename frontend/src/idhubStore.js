const SESSION_KEY = "idhub:session:v1";
const LOCAL_KEY = "idhub:persist:v1";

function safeParse(s) {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function makeKey(baseUrl, tenantId, sourceId) {
  return [baseUrl || "", tenantId || "", sourceId || ""].join("|");
}

export function loadIdHub() {
  const local = safeParse(localStorage.getItem(LOCAL_KEY));
  const sess = safeParse(sessionStorage.getItem(SESSION_KEY));
  const base = local || sess || {};
  return {
    remember: !!base.remember,
    baseUrl: base.baseUrl || "",
    tenantId: base.tenantId || "",
    sourceId: base.sourceId || "",
    token: base.token || "",
    caches: base.caches || {},
  };
}

export function saveIdHub(state, remember) {
  const data = {
    remember: !!remember,
    baseUrl: state.baseUrl || "",
    tenantId: state.tenantId || "",
    sourceId: state.sourceId || "",
    token: state.token || "",
    caches: state.caches || {},
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  if (remember) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  } else {
    localStorage.removeItem(LOCAL_KEY);
  }
}

export function readCache(state, key) {
  return state.caches?.[key] || { jobs: [], page: 0 };
}

export function writeCache(state, key, cache) {
  const s = loadIdHub();
  s.remember = state.remember;
  s.baseUrl = state.baseUrl;
  s.tenantId = state.tenantId;
  s.sourceId = state.sourceId;
  s.token = state.token;
  s.caches = s.caches || {};
  s.caches[key] = { jobs: cache.jobs || [], page: cache.page || 0 };
  saveIdHub(s, s.remember);
}

export function clearCacheForKey(key) {
  const s = loadIdHub();
  if (s.caches && s.caches[key]) {
    delete s.caches[key];
    saveIdHub(s, s.remember);
  }
}
