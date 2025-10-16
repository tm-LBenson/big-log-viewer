import { useEffect, useMemo, useState } from "react";
import "./App.css";

const SESSION_KEY = "idhub:session:v1";
const LOCAL_KEY = "idhub:persist:v1";

function parseStore(s) {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
function loadStore() {
  return (
    parseStore(localStorage.getItem(LOCAL_KEY)) ||
    parseStore(sessionStorage.getItem(SESSION_KEY)) ||
    {}
  );
}
function saveStore(state) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  if (state.remember) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } else {
    localStorage.removeItem(LOCAL_KEY);
  }
}
function keyOf(baseUrl, tenantId, sourceId) {
  return [baseUrl || "", tenantId || "", sourceId || ""].join("|");
}

export default function IdHub({ onOpenLog }) {
  const init = loadStore();
  const [remember, setRemember] = useState(!!init.remember);
  const [baseUrl, setBaseUrl] = useState(init.baseUrl || "");
  const [tenantId, setTenantId] = useState(init.tenantId || "");
  const [sourceId, setSourceId] = useState(init.sourceId || "");
  const [token, setToken] = useState((init.remember ? init.token : "") || "");

  const bucket = useMemo(
    () => keyOf(baseUrl, tenantId, sourceId),
    [baseUrl, tenantId, sourceId],
  );

  const cached = init.caches?.[bucket] || { jobs: [], page: 0, end: false };
  const [jobs, setJobs] = useState(cached.jobs || []);
  const [page, setPage] = useState(cached.page || 0);
  const [end, setEnd] = useState(!!cached.end);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const s = loadStore();
    const k = keyOf(baseUrl, tenantId, sourceId);
    const c = s.caches?.[k] || { jobs: [], page: 0, end: false };
    setJobs(c.jobs || []);
    setPage(c.page || 0);
    setEnd(!!c.end);
  }, [baseUrl, tenantId, sourceId]);

  useEffect(() => {
    const next = {
      remember,
      baseUrl,
      tenantId,
      sourceId,
      token: remember ? token : "",
      caches: {
        ...(loadStore().caches || {}),
        [bucket]: { jobs, page, end },
      },
    };
    saveStore(next);
  }, [remember, baseUrl, tenantId, sourceId, token, jobs, page, end, bucket]);

  const canFetch = baseUrl && tenantId && sourceId && token;
  const auth = useMemo(() => {
    if (!token) return {};
    return {
      Authorization: token.toLowerCase().startsWith("bearer ")
        ? token
        : `Bearer ${token}`,
    };
  }, [token]);

  const loadNext = async (reset) => {
    if (!canFetch || loading || (end && !reset)) return;
    setLoading(true);
    try {
      const qp = new URLSearchParams({
        base: baseUrl,
        tenant: tenantId,
        sourceId,
        page: String(reset ? 0 : page),
        size: "20",
      });
      const r = await fetch(`/api/idhub/jobs?${qp.toString()}`, {
        headers: auth,
      });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      const arr = Array.isArray(d?.data) ? d.data : [];
      if (reset) {
        setJobs(arr);
        setPage(1);
        setEnd(!arr.length);
      } else {
        setJobs((v) => v.concat(arr));
        setPage((p) => p + 1);
        if (!arr.length) setEnd(true);
      }
    } catch {
      console.log("Error in idhub 113");
    } finally {
      setLoading(false);
    }
  };

  const clearList = () => {
    setJobs([]);
    setPage(0);
    setEnd(false);
  };

  const openLog = async (jobId) => {
    if (!jobId || !canFetch) return;
    try {
      const qp = new URLSearchParams({
        base: baseUrl,
        tenant: tenantId,
        job: jobId,
      });
      const r = await fetch(`/api/idhub/log?${qp.toString()}`, {
        headers: auth,
      });
      if (!r.ok) return;
      const d = await r.json();
      const path = d?.path;
      if (path && onOpenLog) onOpenLog(path);
    } catch {}
  };

  const fmt = (sec) => {
    if (!sec && sec !== 0) return "";
    try {
      return new Date(sec * 1000).toLocaleString();
    } catch {
      return "";
    }
  };
  const lastState = (u) =>
    Array.isArray(u) && u.length
      ? u[u.length - 1]?.attributes?.state || ""
      : "";
  const duration = (u) => {
    if (!Array.isArray(u) || !u.length) return "";
    const s = u.find((x) => x?.attributes?.state === "started")?.attributes
      ?.updated;
    const f = [...u].reverse().find((x) => x?.attributes?.state === "finished")
      ?.attributes?.updated;
    if (!s || !f) return "";
    const d = Math.max(0, f - s);
    return `${d.toFixed(1)}s`;
  };
  const num = (x) => (Number.isFinite(x) ? x : "");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <nav className="toolbar">
        <input
          className="field"
          style={{ minWidth: 360, flex: "1 1 auto" }}
          placeholder="https://idhub-api.example.com/"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value.trim())}
        />
        <input
          className="field"
          style={{ width: 320 }}
          placeholder="tenant"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value.trim())}
        />
        <input
          className="field"
          style={{ width: 360 }}
          placeholder="sourceId"
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value.trim())}
        />
        <input
          className="field"
          style={{ width: 320 }}
          type="password"
          placeholder="Bearer token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember
        </label>
        <button
          className="btn"
          onClick={clearList}
        >
          Clear
        </button>
        <button
          className="btn btn--primary"
          onClick={() => loadNext(true)}
          disabled={!canFetch || loading}
        >
          {loading ? "Loading…" : "Load jobs"}
        </button>
      </nav>

      <div style={{ overflow: "auto", flex: 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr
              style={{
                position: "sticky",
                top: 0,
                background: "var(--surface)",
                boxShadow: "0 1px 0 var(--border)",
              }}
            >
              <th style={{ textAlign: "left", padding: "8px 10px" }}>
                Created
              </th>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>Job ID</th>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>State</th>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>
                Duration
              </th>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>
                Ingested
              </th>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>
                Consolidated
              </th>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const a = j?.attributes || {};
              const st = lastState(a.updates || []);
              const du = duration(a.updates || []);
              const ing = a?.statistics?.content?.sourceStats?.ingested;
              const con = a?.statistics?.content?.sourceStats?.consolidated;
              return (
                <tr
                  key={j.id}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td style={{ padding: "8px 10px" }}>{fmt(a.created)}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <button
                      className="btn btn--toggle"
                      onClick={() => openLog(j.id)}
                      title="Open log"
                    >
                      {j.id}
                    </button>
                  </td>
                  <td style={{ padding: "8px 10px" }}>{st}</td>
                  <td style={{ padding: "8px 10px" }}>{du}</td>
                  <td style={{ padding: "8px 10px" }}>{num(ing)}</td>
                  <td style={{ padding: "8px 10px" }}>{num(con)}</td>
                  <td style={{ padding: "8px 10px" }}>{a["source-id"]}</td>
                </tr>
              );
            })}
            {!jobs.length && (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    textAlign: "center",
                    padding: 20,
                    color: "var(--text-weak)",
                  }}
                >
                  No data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div
        className="toolbar"
        style={{ justifyContent: "center" }}
      >
        <button
          className="btn"
          onClick={() => loadNext(false)}
          disabled={!canFetch || loading || end}
        >
          {loading ? "Loading…" : end ? "No more pages" : "Load more"}
        </button>
      </div>
    </div>
  );
}
