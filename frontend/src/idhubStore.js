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
<<<<<<< HEAD
    tenantUrl: session.tenantUrl || local.tenantUrl || "",
    sessionId: session.sessionId || "",
    sourceId: session.sourceId || local.sourceId || "",
    caches: session.caches || {},
=======
    remember: !!local.remember,
    tenantUrl: session.tenantUrl || local.tenantUrl || "",
    sessionId: session.sessionId || "",
    sourceId: session.sourceId || local.sourceId || "",
    caches: session.caches || local.caches || {},
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
  };
}

export function saveIdHub(state) {
  const persistent = {
<<<<<<< HEAD
    tenantUrl: state.tenantUrl || "",
    sourceId: state.sourceId || "",
=======
    remember: !!state.remember,
    tenantUrl: state.tenantUrl || "",
    sourceId: state.sourceId || "",
    caches: state.caches || {},
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
  };
  const session = {
    ...persistent,
    sessionId: state.sessionId || "",
<<<<<<< HEAD
    caches: state.caches || {},
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.setItem(LOCAL_KEY, JSON.stringify(persistent));
=======
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  if (persistent.remember) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(persistent));
  } else {
    localStorage.removeItem(LOCAL_KEY);
  }
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
}

export function readCache(state, key) {
  return state.caches?.[key] || { jobs: [], page: 0, end: false };
}
