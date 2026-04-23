import { useCallback, useEffect, useMemo, useState } from "react";
import { loadIdHub, makeKey, readCache, saveIdHub } from "./idhubStore";
import "./App.css";

const CONNECTING_STATES = new Set([
  "launching",
  "waiting_browser",
  "waiting_idhub",
  "waiting_token",
]);

const SOURCE_KIND = "source";
const TARGET_KIND = "target";

function sortResources(items) {
  return [...items].sort((left, right) =>
    resourceName(left).localeCompare(resourceName(right), undefined, {
      sensitivity: "base",
    }),
  );
}

function resourceName(resource) {
  return resource?.attributes?.name || resource?.id || "Unnamed job";
}

function selectionValue(kind, id) {
  return kind && id ? `${kind}:${id}` : "";
}

function parseSelection(value) {
  const raw = String(value || "").trim();
  if (!raw) return { kind: SOURCE_KIND, id: "" };
  const splitAt = raw.indexOf(":");
  if (splitAt === -1) {
    return { kind: SOURCE_KIND, id: raw };
  }
  const kind = raw.slice(0, splitAt) === TARGET_KIND ? TARGET_KIND : SOURCE_KIND;
  return {
    kind,
    id: raw.slice(splitAt + 1),
  };
}

function normalizeSelectionValue(value) {
  const parsed = parseSelection(value);
  return selectionValue(parsed.kind, parsed.id);
}

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

function statusText({ connected, sessionState, statusMessage, sourcesCount, targetsCount }) {
  if (connected) {
    const total = sourcesCount + targetsCount;
    return total
      ? `${pluralize(total, "job")} ready.`
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

function totalBucketValue(bucket) {
  const value = Number(bucket?.total);
  return Number.isFinite(value) ? value : 0;
}

function totalSinkChanges(sinkStats) {
  if (!sinkStats || typeof sinkStats !== "object") return null;

  let total = 0;
  let foundStats = false;

  for (const sink of Object.values(sinkStats)) {
    if (!sink || typeof sink !== "object") continue;
    for (const actor of [sink.personStats, sink.groupStats]) {
      if (!actor || typeof actor !== "object") continue;
      foundStats = true;
      total += totalBucketValue(actor.creationStats);
      total += totalBucketValue(actor.updateStats);
      total += totalBucketValue(actor.deletionStats);
      total += totalBucketValue(actor.enableStats);
      total += totalBucketValue(actor.disableStats);
    }
  }

  return foundStats ? total : null;
}

export default function IdHub({ onOpenLog }) {
  const initial = useMemo(() => loadIdHub(), []);
  const initialKey = makeKey(initial.tenantUrl, initial.jobSelection);
  const initialCache = readCache(initial, initialKey);

  const [tenantUrl, setTenantUrl] = useState(initial.tenantUrl || "");
  const [sessionId, setSessionId] = useState(initial.sessionId || "");
  const [sessionState, setSessionState] = useState(initial.sessionId ? "launching" : "idle");
  const [statusMessage, setStatusMessage] = useState(
    initial.sessionId
      ? "Reconnecting to your current IDHub session…"
      : "Enter a tenant URL to connect.",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [connectionInfo, setConnectionInfo] = useState(null);
  const [sources, setSources] = useState([]);
  const [targets, setTargets] = useState([]);
  const [jobSelection, setJobSelection] = useState(initial.jobSelection || "");
  const [jobs, setJobs] = useState(initialCache.jobs || []);
  const [page, setPage] = useState(initialCache.page || 0);
  const [nextLink, setNextLink] = useState(initialCache.nextLink || "");
  const [end, setEnd] = useState(!!initialCache.end);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const bucket = useMemo(() => makeKey(tenantUrl, jobSelection), [tenantUrl, jobSelection]);
  const connected = Boolean(connectionInfo?.connected) || sessionState === "connected";
  const selection = useMemo(() => parseSelection(jobSelection), [jobSelection]);
  const selectedKind = selection.kind;
  const selectedId = selection.id;
  const canLoadJobs = Boolean(sessionId && selectedId && connected);
  const tone = statusTone(sessionState, connected);
  const selectedResource = useMemo(() => {
    const options = selectedKind === TARGET_KIND ? targets : sources;
    return options.find((item) => item.id === selectedId) || null;
  }, [selectedId, selectedKind, sources, targets]);
  const sourceLabels = useMemo(
    () => new Map(sources.map((item) => [item.id, resourceName(item)])),
    [sources],
  );
  const targetLabels = useMemo(
    () => new Map(targets.map((item) => [item.id, resourceName(item)])),
    [targets],
  );
  const currentTenantHost = useMemo(() => tenantHost(tenantUrl), [tenantUrl]);
  const compactStatus = statusText({
    connected,
    sessionState,
    statusMessage,
    sourcesCount: sources.length,
    targetsCount: targets.length,
  });
  const showBrowserHint = CONNECTING_STATES.has(sessionState);
  const tenantLocked = connected || showBrowserHint;
  const headers = useMemo(() => {
    if (selectedKind === TARGET_KIND) {
      return {
        primary: "Synchronized",
        secondary: "Applied",
        system: "Target",
      };
    }
    return {
      primary: "Ingested",
      secondary: "Consolidated",
      system: "Source",
    };
  }, [selectedKind]);

  useEffect(() => {
    const cached = readCache(loadIdHub(), bucket);
    setJobs(cached.jobs || []);
    setPage(cached.page || 0);
    setNextLink(cached.nextLink || "");
    setEnd(!!cached.end);
  }, [bucket]);

  useEffect(() => {
    const existing = loadIdHub();
    const caches = {
      ...(existing.caches || {}),
      [bucket]: { jobs, page, nextLink, end },
    };
    saveIdHub({
      tenantUrl,
      sessionId,
      jobSelection,
      caches,
    });
  }, [tenantUrl, sessionId, jobSelection, bucket, jobs, page, nextLink, end]);

  const applyStatus = useCallback((data) => {
    const nextState = data?.state || (data?.connected ? "connected" : "idle");
    const nextSources = Array.isArray(data?.sources) ? sortResources(data.sources) : [];
    const nextTargets = Array.isArray(data?.sinks) ? sortResources(data.sinks) : [];
    const nextSelections = [
      ...nextSources.map((item) => selectionValue(SOURCE_KIND, item.id)),
      ...nextTargets.map((item) => selectionValue(TARGET_KIND, item.id)),
    ];

    setConnectionInfo(data || null);
    setSessionState(nextState);
    setStatusMessage(
      data?.message || (data?.connected ? "Connected to IDHub." : "Enter a tenant URL to connect."),
    );
    setErrorMessage(data?.lastError || "");
    setSources(nextSources);
    setTargets(nextTargets);
    if (nextSelections.length) {
      setJobSelection((current) => {
        const normalized = normalizeSelectionValue(current);
        if (normalized && nextSelections.includes(normalized)) {
          return normalized;
        }
        return nextSelections[0];
      });
    } else {
      setJobSelection("");
    }
    return CONNECTING_STATES.has(nextState);
  }, []);

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
      setTargets([]);
      setJobSelection("");
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
    setNextLink("");
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
    setStatusMessage("Opening a browser window for sign-in…");
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
    setTargets([]);
    setJobSelection("");
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

  const loadNext = async (reset) => {
    if (!canLoadJobs || loadingJobs || (end && !reset)) return;
    setLoadingJobs(true);
    setErrorMessage("");
    try {
      const query = new URLSearchParams({
        session: sessionId,
        size: "20",
      });
      if (selectedKind === TARGET_KIND) {
        query.set("sinkId", selectedId);
      } else {
        query.set("sourceId", selectedId);
      }

      const continuation = !reset ? nextLink.trim() : "";
      if (continuation) {
        query.set("next", continuation);
      } else if (selectedKind !== TARGET_KIND) {
        query.set("page", String(reset ? 0 : page));
      }

      const response = await fetch(`/api/idhub/jobs?${query.toString()}`);
      const data = await parseResponse(response, "Failed to load IDHub jobs");
      const nextJobs = Array.isArray(data?.data) ? data.data : [];
      const responseNext = typeof data?.links?.next === "string" ? data.links.next : "";
      const usingTokenPagination =
        selectedKind === TARGET_KIND || Boolean(continuation) || Boolean(responseNext);

      if (reset) {
        setJobs(nextJobs);
      } else {
        setJobs((current) => current.concat(nextJobs));
      }

      setNextLink(responseNext);

      if (usingTokenPagination) {
        setEnd(!responseNext);
        if (reset) setPage(0);
      } else {
        if (reset) {
          setPage(1);
        } else {
          setPage((current) => current + 1);
        }
        setEnd(!nextJobs.length);
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

  const primaryMetric = useCallback(
    (job) => {
      const stats = job?.attributes?.statistics?.content;
      if (selectedKind === TARGET_KIND) {
        return num(Number(stats?.synchronizerStats?.synchronized));
      }
      return num(Number(stats?.sourceStats?.ingested));
    },
    [selectedKind],
  );

  const secondaryMetric = useCallback(
    (job) => {
      const stats = job?.attributes?.statistics?.content;
      if (selectedKind === TARGET_KIND) {
        const total = totalSinkChanges(stats?.sinkStats);
        return total == null ? "" : total;
      }
      return num(Number(stats?.sourceStats?.consolidated));
    },
    [selectedKind],
  );

  const systemInfo = useCallback(
    (job) => {
      const attributes = job?.attributes || {};
      const rowSinkIds = Array.isArray(attributes["sink-ids"]) ? attributes["sink-ids"] : [];
      if (rowSinkIds.length) {
        return {
          title: rowSinkIds.join(", "),
          label: rowSinkIds.map((id) => targetLabels.get(id) || id).join(", "),
        };
      }

      const rowSourceId = attributes["source-id"];
      if (rowSourceId) {
        return {
          title: rowSourceId,
          label: sourceLabels.get(rowSourceId) || rowSourceId,
        };
      }

      return {
        title: selectedId,
        label: selectedResource ? resourceName(selectedResource) : "",
      };
    },
    [selectedId, selectedResource, sourceLabels, targetLabels],
  );

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
          <span style={{ color: "var(--text-weak)" }}>{compactStatus}</span>
        </div>

        {(currentTenantHost || selectedResource || (connected && (sources.length || targets.length))) && (
          <div className="idhub-summary-row">
            {currentTenantHost && (
              <span className="idhub-summary-pill" title={tenantUrl}>
                {currentTenantHost}
              </span>
            )}
            {connected && sources.length > 0 && (
              <span className="idhub-summary-pill">{pluralize(sources.length, "source")}</span>
            )}
            {connected && targets.length > 0 && (
              <span className="idhub-summary-pill">{pluralize(targets.length, "target")}</span>
            )}
            {selectedResource && (
              <span className="idhub-summary-pill" title={selectedId}>
                {selectedKind === TARGET_KIND ? "Target: " : "Source: "}
                {resourceName(selectedResource)}
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
            />
          </label>

          <label className="idhub-field-wrap">
            <span className="idhub-field-label">Job</span>
            <select
              className="field"
              value={jobSelection}
              onChange={(event) => setJobSelection(normalizeSelectionValue(event.target.value))}
              disabled={!connected || (!sources.length && !targets.length)}
            >
              <option value="">
                {connected
                  ? sources.length || targets.length
                    ? "Select a job"
                    : "No jobs returned"
                  : "Connect first"}
              </option>
              {sources.length > 0 && (
                <optgroup label="Source">
                  {sources.map((source) => (
                    <option
                      key={source.id}
                      value={selectionValue(SOURCE_KIND, source.id)}
                    >
                      {resourceName(source)}
                    </option>
                  ))}
                </optgroup>
              )}
              {targets.length > 0 && (
                <optgroup label="Target">
                  {targets.map((target) => (
                    <option
                      key={target.id}
                      value={selectionValue(TARGET_KIND, target.id)}
                    >
                      {resourceName(target)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        </div>

        {showBrowserHint && (
          <div className="idhub-inline-note">
            Finish sign-in in the browser window. If the RI portal opens, click IDHub.
          </div>
        )}

        <div className="idhub-actions">
          <button
            className="btn btn--primary"
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
              <th style={{ textAlign: "left", padding: "8px 10px" }}>{headers.primary}</th>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>{headers.secondary}</th>
              <th style={{ textAlign: "left", padding: "8px 10px" }}>{headers.system}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const attributes = job?.attributes || {};
              const updates = attributes.updates || [];
              const rowSystem = systemInfo(job);
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
                  <td style={{ padding: "8px 10px" }}>{primaryMetric(job)}</td>
                  <td style={{ padding: "8px 10px" }}>{secondaryMetric(job)}</td>
                  <td
                    className="idhub-table-source"
                    style={{ padding: "8px 10px" }}
                    title={rowSystem.title || ""}
                  >
                    {rowSystem.label}
                  </td>
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
                    ? "Choose a source or target and load jobs."
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
