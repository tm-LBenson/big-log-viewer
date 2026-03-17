import { useCallback, useEffect, useMemo, useState } from "react";
import { loadIdHub, makeKey, readCache, saveIdHub } from "./idhubStore";
import "./App.css";

const CONNECTING_STATES = new Set([
  "launching",
  "waiting_browser",
  "waiting_idhub",
  "waiting_token",
]);

function sortSources(items) {
  return [...items].sort((left, right) =>
    sourceName(left).localeCompare(sourceName(right), undefined, {
      sensitivity: "base",
    }),
  );
}

function sourceName(source) {
  return source?.attributes?.name || source?.id || "Unnamed source";
}

<<<<<<< HEAD
function tenantHost(value) {
  if (!value) return "";
  try {
    return new URL(value).host;
  } catch {
    const compact = value.replace(/^https?:\/\//i, "");
    return compact.split("/")[0] || compact;
  }
}

function pluralize(count, label) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

=======
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
async function parseResponse(response, fallbackMessage) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message =
      data?.lastError ||
      data?.error ||
      data?.message ||
      text ||
      `${fallbackMessage} (status ${response.status})`;
    throw new Error(message);
  }
  return data;
}

function statusTone(state, connected) {
  if (connected || state === "connected") {
    return {
      label: "Connected",
      background: "rgba(16, 185, 129, 0.18)",
      border: "rgba(16, 185, 129, 0.35)",
      color: "#6ee7b7",
    };
  }
  if (state === "error") {
    return {
      label: "Error",
      background: "rgba(239, 68, 68, 0.18)",
      border: "rgba(239, 68, 68, 0.35)",
      color: "#fca5a5",
    };
  }
  if (CONNECTING_STATES.has(state)) {
    return {
      label: "Authenticating",
      background: "rgba(31, 122, 234, 0.18)",
      border: "rgba(31, 122, 234, 0.35)",
      color: "var(--text)",
    };
  }
  return {
    label: "Not connected",
    background: "var(--muted)",
    border: "var(--border)",
    color: "var(--text-weak)",
  };
}

<<<<<<< HEAD
function statusText({ connected, sessionState, statusMessage, sourcesCount }) {
  if (connected) {
    return sourcesCount
      ? `${pluralize(sourcesCount, "source")} ready.`
      : "Connected to IDHub.";
  }
  if (CONNECTING_STATES.has(sessionState)) {
    return "Finish sign-in in the browser window.";
  }
  if (sessionState === "error") {
    return "Could not connect to IDHub.";
  }
  return statusMessage || "Enter a tenant URL to connect.";
}

=======
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
export default function IdHub({ onOpenLog }) {
  const initial = useMemo(() => loadIdHub(), []);
  const initialKey = makeKey(initial.tenantUrl, initial.sourceId);
  const initialCache = readCache(initial, initialKey);

<<<<<<< HEAD
=======
  const [remember, setRemember] = useState(!!initial.remember);
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
  const [tenantUrl, setTenantUrl] = useState(initial.tenantUrl || "");
  const [sessionId, setSessionId] = useState(initial.sessionId || "");
  const [sessionState, setSessionState] = useState(initial.sessionId ? "launching" : "idle");
  const [statusMessage, setStatusMessage] = useState(
    initial.sessionId
      ? "Reconnecting to your current IDHub session…"
<<<<<<< HEAD
      : "Enter a tenant URL to connect.",
=======
      : "Paste a RapidIdentity or IDHub tenant URL to connect.",
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [connectionInfo, setConnectionInfo] = useState(null);
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState(initial.sourceId || "");
  const [jobs, setJobs] = useState(initialCache.jobs || []);
  const [page, setPage] = useState(initialCache.page || 0);
  const [end, setEnd] = useState(!!initialCache.end);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [connecting, setConnecting] = useState(false);
<<<<<<< HEAD
=======
  const [refreshingSources, setRefreshingSources] = useState(false);
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a

  const bucket = useMemo(() => makeKey(tenantUrl, sourceId), [tenantUrl, sourceId]);
  const connected = Boolean(connectionInfo?.connected) || sessionState === "connected";
  const canLoadJobs = Boolean(sessionId && sourceId && connected);
  const tone = statusTone(sessionState, connected);
<<<<<<< HEAD
  const selectedSource = useMemo(
    () => sources.find((item) => item.id === sourceId) || null,
    [sourceId, sources],
  );
  const sourceLabels = useMemo(
    () => new Map(sources.map((item) => [item.id, sourceName(item)])),
    [sources],
  );
  const currentTenantHost = useMemo(() => tenantHost(tenantUrl), [tenantUrl]);
  const compactStatus = statusText({
    connected,
    sessionState,
    statusMessage,
    sourcesCount: sources.length,
  });
  const showBrowserHint = CONNECTING_STATES.has(sessionState);
  const tenantLocked = connected || showBrowserHint;
=======
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a

  useEffect(() => {
    const cached = readCache(loadIdHub(), bucket);
    setJobs(cached.jobs || []);
    setPage(cached.page || 0);
    setEnd(!!cached.end);
  }, [bucket]);

  useEffect(() => {
    const existing = loadIdHub();
    const caches = {
      ...(existing.caches || {}),
      [bucket]: { jobs, page, end },
    };
    saveIdHub({
<<<<<<< HEAD
=======
      remember,
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
      tenantUrl,
      sessionId,
      sourceId,
      caches,
    });
<<<<<<< HEAD
  }, [tenantUrl, sessionId, sourceId, bucket, jobs, page, end]);
=======
  }, [remember, tenantUrl, sessionId, sourceId, bucket, jobs, page, end]);
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a

  const applyStatus = useCallback(
    (data) => {
      const nextState = data?.state || (data?.connected ? "connected" : "idle");
      const nextSources = Array.isArray(data?.sources) ? sortSources(data.sources) : [];

      setConnectionInfo(data || null);
      setSessionState(nextState);
      setStatusMessage(
<<<<<<< HEAD
        data?.message || (data?.connected ? "Connected to IDHub." : "Enter a tenant URL to connect."),
=======
        data?.message ||
          (data?.connected
            ? "Connected to IDHub."
            : "Paste a RapidIdentity or IDHub tenant URL to connect."),
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
      );
      setErrorMessage(data?.lastError || "");
      setSources(nextSources);
      if (nextSources.length) {
        setSourceId((current) => {
          if (nextSources.some((item) => item.id === current)) {
            return current;
          }
          return nextSources[0].id;
        });
      } else {
        setSourceId("");
      }
      return CONNECTING_STATES.has(nextState);
    },
    [setSourceId],
  );

  const refreshStatus = useCallback(async () => {
    if (!sessionId) return false;
    const response = await fetch(
      `/api/idhub/connect/status?id=${encodeURIComponent(sessionId)}`,
    );
    if (response.status === 404) {
      setConnectionInfo(null);
      setSessionId("");
      setSessionState("idle");
      setSources([]);
      setStatusMessage("Your previous IDHub session is no longer available. Connect again.");
      return false;
    }
    const data = await parseResponse(response, "Failed to check IDHub status");
    return applyStatus(data);
  }, [applyStatus, sessionId]);

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    let timerId = 0;

    const tick = async () => {
      try {
        const continuePolling = await refreshStatus();
        if (!cancelled && continuePolling) {
          timerId = window.setTimeout(tick, 1500);
        }
      } catch (error) {
        if (!cancelled) {
          setSessionState("error");
          setErrorMessage(error?.message || "Failed to check IDHub status.");
        }
      }
    };

    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [refreshStatus, sessionId]);

  const clearJobs = useCallback(() => {
    setJobs([]);
    setPage(0);
    setEnd(false);
  }, []);

  const startConnect = async () => {
    if (!tenantUrl.trim()) {
      setErrorMessage("Enter a tenant URL first.");
      return;
    }
    setConnecting(true);
    setErrorMessage("");
    setSessionState("launching");
<<<<<<< HEAD
    setStatusMessage("Opening a browser window for sign-in…");
=======
    setStatusMessage("Opening a browser window for RI / IDHub sign-in…");
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
    clearJobs();
    try {
      const response = await fetch("/api/idhub/connect/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantUrl }),
      });
      const data = await parseResponse(response, "Failed to start IDHub sign-in");
      setSessionId(data?.id || "");
      applyStatus(data);
    } catch (error) {
      setSessionState("error");
      setErrorMessage(error?.message || "Failed to start IDHub sign-in.");
    } finally {
      setConnecting(false);
    }
  };

  const disconnectSession = async () => {
    const currentSession = sessionId;
    setSessionId("");
    setConnectionInfo(null);
    setSources([]);
    setSessionState("idle");
    setStatusMessage("Disconnected from IDHub.");
    setErrorMessage("");
    clearJobs();
    if (!currentSession) return;
    try {
      await fetch(
        `/api/idhub/connect/disconnect?id=${encodeURIComponent(currentSession)}`,
        { method: "POST" },
      );
    } catch {
      // Ignore disconnect cleanup errors.
    }
  };

<<<<<<< HEAD
=======
  const refreshSources = async () => {
    if (!sessionId) return;
    setRefreshingSources(true);
    setErrorMessage("");
    try {
      const response = await fetch(
        `/api/idhub/sources?session=${encodeURIComponent(sessionId)}`,
      );
      const data = await parseResponse(response, "Failed to load IDHub sources");
      const nextSources = sortSources(Array.isArray(data?.data) ? data.data : []);
      setSources(nextSources);
      setSourceId((current) => {
        if (nextSources.some((item) => item.id === current)) {
          return current;
        }
        return nextSources[0]?.id || "";
      });
      if (!nextSources.length) {
        setStatusMessage("Connected, but this tenant did not return any IDHub sources.");
      }
    } catch (error) {
      setErrorMessage(error?.message || "Failed to load IDHub sources.");
    } finally {
      setRefreshingSources(false);
    }
  };

>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
  const loadNext = async (reset) => {
    if (!canLoadJobs || loadingJobs || (end && !reset)) return;
    setLoadingJobs(true);
    setErrorMessage("");
    try {
      const query = new URLSearchParams({
        session: sessionId,
        sourceId,
        page: String(reset ? 0 : page),
        size: "20",
      });
      const response = await fetch(`/api/idhub/jobs?${query.toString()}`);
      const data = await parseResponse(response, "Failed to load IDHub jobs");
      const nextJobs = Array.isArray(data?.data) ? data.data : [];
      if (reset) {
        setJobs(nextJobs);
        setPage(1);
        setEnd(!nextJobs.length);
      } else {
        setJobs((current) => current.concat(nextJobs));
        setPage((current) => current + 1);
        if (!nextJobs.length) setEnd(true);
      }
    } catch (error) {
      setErrorMessage(error?.message || "Failed to load IDHub jobs.");
    } finally {
      setLoadingJobs(false);
    }
  };

  const openLog = async (jobId) => {
    if (!jobId || !sessionId) return;
    setErrorMessage("");
    try {
      const query = new URLSearchParams({
        session: sessionId,
        job: jobId,
      });
      const response = await fetch(`/api/idhub/log?${query.toString()}`);
      const data = await parseResponse(response, "Failed to open the IDHub log");
      if (data?.path && onOpenLog) {
        onOpenLog(data.path);
      }
    } catch (error) {
      setErrorMessage(error?.message || "Failed to open the IDHub log.");
    }
  };

  const fmt = (sec) => {
    if (!sec && sec !== 0) return "";
    try {
      return new Date(sec * 1000).toLocaleString();
    } catch {
      return "";
    }
  };

  const lastState = (updates) =>
    Array.isArray(updates) && updates.length
      ? updates[updates.length - 1]?.attributes?.state || ""
      : "";

  const duration = (updates) => {
    if (!Array.isArray(updates) || !updates.length) return "";
    const started = updates.find((item) => item?.attributes?.state === "started")
      ?.attributes?.updated;
    const finished = [...updates]
      .reverse()
      .find((item) => item?.attributes?.state === "finished")?.attributes?.updated;
    if (!started || !finished) return "";
    const delta = Math.max(0, finished - started);
    return `${delta.toFixed(1)}s`;
  };

  const num = (value) => (Number.isFinite(value) ? value : "");

  return (
    <div className="idhub-page">
      <div className="idhub-panel">
        <div className="idhub-status-row">
          <span
            className="idhub-status-pill"
            style={{
              background: tone.background,
              borderColor: tone.border,
              color: tone.color,
            }}
          >
            {tone.label}
          </span>
<<<<<<< HEAD
          <span style={{ color: "var(--text-weak)" }}>{compactStatus}</span>
        </div>

        {(currentTenantHost || selectedSource || (connected && sources.length)) && (
          <div className="idhub-summary-row">
            {currentTenantHost && (
              <span className="idhub-summary-pill" title={tenantUrl}>
                {currentTenantHost}
              </span>
            )}
            {connected && sources.length > 0 && (
              <span className="idhub-summary-pill">{pluralize(sources.length, "source")}</span>
            )}
            {selectedSource && (
              <span className="idhub-summary-pill" title={sourceId}>
                {sourceName(selectedSource)}
              </span>
            )}
          </div>
        )}

        <div className="idhub-grid">
          <label className="idhub-field-wrap">
            <span className="idhub-field-label">Customer tenant URL</span>
            <input
              className="field"
              placeholder="https://customer.us004-rapididentity.com"
              value={tenantUrl}
              onChange={(event) => setTenantUrl(event.target.value.trim())}
              disabled={tenantLocked}
=======
          <span style={{ color: "var(--text-weak)" }}>{statusMessage}</span>
        </div>

        <div className="idhub-grid">
          <label
            className="idhub-field-wrap"
            style={{ gridColumn: "1 / -1" }}
          >
            <span className="idhub-field-label">Customer tenant URL</span>
            <input
              className="field"
              placeholder="https://customer.us004-rapididentity.com or https://customer-idhub.us004-rapididentity.com/idhub"
              value={tenantUrl}
              onChange={(event) => setTenantUrl(event.target.value.trim())}
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
            />
          </label>

          <label className="idhub-field-wrap">
<<<<<<< HEAD
            <span className="idhub-field-label">Source</span>
=======
            <span className="idhub-field-label">IDHub source</span>
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
            <select
              className="field"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              disabled={!connected || !sources.length}
            >
              <option value="">
                {connected
                  ? sources.length
                    ? "Select a source"
                    : "No sources returned"
                  : "Connect first"}
              </option>
              {sources.map((source) => (
                <option
                  key={source.id}
                  value={source.id}
                >
                  {sourceName(source)}
                </option>
              ))}
            </select>
          </label>
<<<<<<< HEAD
        </div>

        {showBrowserHint && (
          <div className="idhub-inline-note">
            Finish sign-in in the browser window. If the RI portal opens, click IDHub.
          </div>
        )}
=======

          <div className="idhub-field-wrap">
            <span className="idhub-field-label">Connection details</span>
            <div className="idhub-meta-box">
              {connectionInfo?.tenantId ? (
                <>
                  <div>Tenant ID: {connectionInfo.tenantId}</div>
                  <div>Sources: {sources.length}</div>
                </>
              ) : (
                <div>Use your RI or IDHub tenant URL, then finish sign-in in the popup window.</div>
              )}
            </div>
          </div>
        </div>

        <div className="idhub-help-text">
          Support-mode flow: a separate browser window opens for RI / Okta sign-in.
          If you land in the RapidIdentity portal after login, click the IDHub tile once.
        </div>
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a

        <div className="idhub-actions">
          <button
            className="btn btn--primary"
<<<<<<< HEAD
            onClick={connected ? () => loadNext(true) : startConnect}
            disabled={connected ? !canLoadJobs || loadingJobs : !tenantUrl.trim() || connecting}
          >
            {connected
              ? loadingJobs
                ? "Loading…"
                : jobs.length
                  ? "Reload jobs"
                  : "Load jobs"
              : connecting
                ? "Opening browser…"
                : "Connect"}
          </button>

          {connected && (
            <>
              <button
                className="btn"
                onClick={startConnect}
                disabled={connecting}
              >
                Reconnect
              </button>
              {jobs.length > 0 && (
                <button
                  className="btn"
                  onClick={clearJobs}
                >
                  Clear jobs
                </button>
              )}
              <button
                className="btn"
                onClick={disconnectSession}
                disabled={!sessionId}
              >
                Disconnect
              </button>
            </>
          )}
=======
            onClick={startConnect}
            disabled={!tenantUrl.trim() || connecting}
          >
            {connecting ? "Opening browser…" : connected ? "Reconnect" : "Connect"}
          </button>
          <button
            className="btn"
            onClick={refreshSources}
            disabled={!sessionId || !connected || refreshingSources}
          >
            {refreshingSources ? "Refreshing…" : "Refresh sources"}
          </button>
          <button
            className="btn btn--primary"
            onClick={() => loadNext(true)}
            disabled={!canLoadJobs || loadingJobs}
          >
            {loadingJobs ? "Loading…" : "Load jobs"}
          </button>
          <button
            className="btn"
            onClick={clearJobs}
            disabled={!jobs.length}
          >
            Clear jobs
          </button>
          <button
            className="btn"
            onClick={disconnectSession}
            disabled={!sessionId}
          >
            Disconnect
          </button>
          <label className="idhub-checkbox">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            Remember tenant + source
          </label>
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
        </div>
      </div>

      {errorMessage && <div className="idhub-banner">{errorMessage}</div>}

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
              <th style={{ textAlign: "left", padding: "8px 10px" }}>Created</th>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>Job ID</th>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>State</th>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>Duration</th>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>Ingested</th>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>Consolidated</th>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const attributes = job?.attributes || {};
              const updates = attributes.updates || [];
              const ingested = attributes?.statistics?.content?.sourceStats?.ingested;
              const consolidated =
                attributes?.statistics?.content?.sourceStats?.consolidated;
<<<<<<< HEAD
              const rowSourceId = attributes["source-id"];
              const rowSourceLabel = sourceLabels.get(rowSourceId) || rowSourceId;
=======
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
              return (
                <tr
                  key={job.id}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td style={{ padding: "8px 10px" }}>{fmt(attributes.created)}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <button
                      className="btn btn--toggle"
                      onClick={() => openLog(job.id)}
                      title="Open log"
                    >
                      {job.id}
                    </button>
                  </td>
                  <td style={{ padding: "8px 10px" }}>{lastState(updates)}</td>
                  <td style={{ padding: "8px 10px" }}>{duration(updates)}</td>
                  <td style={{ padding: "8px 10px" }}>{num(ingested)}</td>
                  <td style={{ padding: "8px 10px" }}>{num(consolidated)}</td>
<<<<<<< HEAD
                  <td
                    className="idhub-table-source"
                    style={{ padding: "8px 10px" }}
                    title={rowSourceId || ""}
                  >
                    {rowSourceLabel}
                  </td>
=======
                  <td style={{ padding: "8px 10px" }}>{attributes["source-id"]}</td>
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
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
                  {connected
<<<<<<< HEAD
                    ? "Choose a source and load jobs."
=======
                    ? "No jobs loaded yet. Choose a source and click Load jobs."
>>>>>>> 237adf36c499f648c8cd17e090791a39b474c67a
                    : "Connect to IDHub to browse jobs."}
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
          disabled={!canLoadJobs || loadingJobs || end}
        >
          {loadingJobs ? "Loading…" : end ? "No more pages" : "Load more"}
        </button>
      </div>
    </div>
  );
}
