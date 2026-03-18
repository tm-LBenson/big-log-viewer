import { useEffect, useMemo, useState } from "react";
import { parseIdHubLog } from "./idhubDashboardUtils";

const numberFmt = new Intl.NumberFormat();

function formatNumber(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "number") return numberFmt.format(value);
  return String(value);
}

function Card({ title, subtitle, actions, className = "", children }) {
  return (
    <section className={`idhub-dash__card ${className}`.trim()}>
      <div className="idhub-dash__card-head">
        <div>
          <h3 className="idhub-dash__card-title">{title}</h3>
          {subtitle && <div className="idhub-dash__card-subtitle">{subtitle}</div>}
        </div>
        {actions ? <div className="idhub-dash__card-actions">{actions}</div> : null}
      </div>
      <div className="idhub-dash__card-body">{children}</div>
    </section>
  );
}

function StatusPill({ tone, children }) {
  return (
    <span className={`idhub-dash__status-pill is-${tone}`}>
      {children}
    </span>
  );
}

function InfoChip({ tone = "neutral", children }) {
  return <span className={`idhub-dash__chip is-${tone}`}>{children}</span>;
}

function MetricGrid({ items }) {
  const visible = items.filter((item) => item && item.value != null && item.value !== "");
  if (!visible.length) {
    return <div className="idhub-dash__empty">No summary data was found in this log.</div>;
  }
  return (
    <div className="idhub-dash__metrics">
      {visible.map((item) => (
        <div
          key={item.label}
          className={`idhub-dash__metric ${item.tone ? `is-${item.tone}` : ""}`.trim()}
        >
          <div className="idhub-dash__metric-label">{item.label}</div>
          <div className="idhub-dash__metric-value">{formatNumber(item.value)}</div>
          {item.note ? <div className="idhub-dash__metric-note">{item.note}</div> : null}
        </div>
      ))}
    </div>
  );
}

function DetailList({ rows }) {
  const visible = rows.filter((row) => row.value != null && row.value !== "");
  return (
    <div className="idhub-dash__details">
      {visible.map((row) => (
        <div
          key={row.label}
          className="idhub-dash__detail-row"
        >
          <div className="idhub-dash__detail-label">{row.label}</div>
          <div className="idhub-dash__detail-value">{formatNumber(row.value)}</div>
        </div>
      ))}
    </div>
  );
}

function SystemValue({ total, failed = 0 }) {
  if (!total) return <span className="idhub-dash__muted">—</span>;
  return (
    <span className={failed ? "idhub-dash__table-value is-warn" : "idhub-dash__table-value"}>
      {formatNumber(total)}
      {failed ? <small>{formatNumber(failed)} failed</small> : null}
    </span>
  );
}

function SystemsTable({ systems }) {
  if (!systems.length) {
    return <div className="idhub-dash__empty">No system action summary was found in this log.</div>;
  }
  return (
    <div className="idhub-dash__table-wrap">
      <table className="idhub-dash__table">
        <thead>
          <tr>
            <th>System</th>
            <th>People created</th>
            <th>People updated</th>
            <th>People deleted</th>
            <th>Group updates</th>
            <th>Failures</th>
          </tr>
        </thead>
        <tbody>
          {systems.map((system) => (
            <tr key={system.id}>
              <td>
                <div className="idhub-dash__table-primary">{system.name}</div>
                {system.rawName && system.rawName !== system.name ? (
                  <div className="idhub-dash__table-secondary">{system.rawName}</div>
                ) : null}
              </td>
              <td>
                <SystemValue
                  total={system.people.actions.created?.total}
                  failed={system.people.actions.created?.failed}
                />
              </td>
              <td>
                <SystemValue
                  total={system.people.actions.updated?.total}
                  failed={system.people.actions.updated?.failed}
                />
              </td>
              <td>
                <SystemValue
                  total={system.people.actions.deleted?.total}
                  failed={system.people.actions.deleted?.failed}
                />
              </td>
              <td>
                <SystemValue
                  total={system.groups.actions.updated?.total}
                  failed={system.groups.actions.updated?.failed}
                />
              </td>
              <td>
                {system.failed ? (
                  <span className="idhub-dash__table-value is-warn">
                    {formatNumber(system.failed)}
                  </span>
                ) : (
                  <span className="idhub-dash__muted">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IssuesPanel({ failureBreakdown, issueSamples, warnCount, errorCount }) {
  if (!failureBreakdown.length && !issueSamples.length) {
    return <div className="idhub-dash__empty">No warnings or failures were detected in the parsed summary.</div>;
  }
  return (
    <div className="idhub-dash__issues">
      <div className="idhub-dash__issue-summary">
        {errorCount ? <InfoChip tone="error">{formatNumber(errorCount)} errors</InfoChip> : null}
        {warnCount ? <InfoChip tone="warn">{formatNumber(warnCount)} warnings</InfoChip> : null}
        {failureBreakdown.slice(0, 6).map((item) => (
          <InfoChip
            key={item.key}
            tone="warn"
          >
            {item.label}: {formatNumber(item.count)}
          </InfoChip>
        ))}
      </div>

      {issueSamples.length ? (
        <div className="idhub-dash__issue-list">
          {issueSamples.map((item, index) => (
            <div
              key={`${item.timestamp}-${index}`}
              className="idhub-dash__issue-item"
            >
              <div className="idhub-dash__issue-meta">
                <span className={`idhub-dash__level-pill is-${item.level}`}>{item.level.toUpperCase()}</span>
                {item.timestamp ? <span>{item.timestamp}</span> : null}
                {item.logger ? <span className="idhub-dash__muted">{item.logger}</span> : null}
              </div>
              <div className="idhub-dash__issue-text">{item.message}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LogOutput({ lines }) {
  if (!lines.length) {
    return <div className="idhub-dash__empty">No remaining log lines were found after parsed JSON sections were removed.</div>;
  }
  return (
    <div className="idhub-dash__logfeed">
      {lines.map((line) => (
        <div
          key={line.id}
          className={`idhub-dash__logline is-${line.level}`}
        >
          {line.timestamp ? <span className="idhub-dash__logtime">{line.timestamp}</span> : null}
          {line.level !== "plain" ? (
            <span className={`idhub-dash__level-pill is-${line.level}`}>{line.level.toUpperCase()}</span>
          ) : null}
          {line.logger ? <span className="idhub-dash__loglogger">{line.logger}</span> : null}
          <span className="idhub-dash__logmessage">{line.message || line.raw}</span>
        </div>
      ))}
    </div>
  );
}

export default function IdHubDashboard({ path }) {
  const [loading, setLoading] = useState(true);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setRaw("");

    fetch(`/api/raw?path=${encodeURIComponent(path)}`)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error("load"))))
      .then((text) => {
        if (!cancelled) setRaw(text);
      })
      .catch(() => {
        if (!cancelled) setError("failed to load log");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  const parsed = useMemo(() => (raw ? parseIdHubLog(raw) : null), [raw]);

  const sourceMetrics = useMemo(() => {
    if (!parsed) return [];
    const diff = parsed.sourceDiff;
    const hasAny = Object.values(diff).some((value) => value != null);
    if (!hasAny) return [];
    return [
      { label: "Source records", value: diff.sourceRecords },
      { label: "Adds", value: diff.adds, tone: "success" },
      { label: "Updates", value: diff.modifies },
      { label: "Deletes", value: diff.deletes },
      { label: "Matched", value: diff.matched },
      { label: "Scheduled for deletion", value: diff.scheduledForDeletion },
      { label: "Ingested", value: diff.ingested },
      { label: "Consolidated", value: diff.consolidated },
    ];
  }, [parsed]);

  const provisioningMetrics = useMemo(() => {
    if (!parsed || !parsed.systems.length) return [];
    return [
      { label: "Created", value: parsed.actionTotals.people.created, tone: "success" },
      { label: "Updated", value: parsed.actionTotals.people.updated },
      { label: "Deleted", value: parsed.actionTotals.people.deleted },
      { label: "Failed", value: parsed.actionTotals.people.failed, tone: parsed.actionTotals.people.failed ? "warn" : "neutral" },
      { label: "Moved", value: parsed.actionTotals.people.moved },
      { label: "Disabled", value: parsed.actionTotals.people.disabled },
      { label: "Enabled", value: parsed.actionTotals.people.enabled },
      { label: "Group updates", value: parsed.actionTotals.groups.updated },
    ];
  }, [parsed]);

  if (loading) return <main className="viewer center">building dashboard…</main>;
  if (error) return <main className="viewer center">{error}</main>;
  if (!parsed) return <main className="viewer center">No data</main>;

  return (
    <div className="idhub-dash">
      <div className="idhub-dash__hero">
        <div className="idhub-dash__hero-copy">
          <div className="idhub-dash__eyebrow">IDHub job summary</div>
          <div className="idhub-dash__hero-line">
            <StatusPill tone={parsed.status.tone}>{parsed.status.label}</StatusPill>
            <div className="idhub-dash__hero-detail">{parsed.status.detail}</div>
          </div>
          <div className="idhub-dash__hero-chips">
            <InfoChip>{parsed.resourceBlocks.length} resources.json block{parsed.resourceBlocks.length === 1 ? "" : "s"}</InfoChip>
            <InfoChip tone={parsed.summaryBlocks.length ? "success" : "neutral"}>
              {parsed.summaryBlocks.length ? "Batch summary found" : "No batch summary found"}
            </InfoChip>
            {parsed.thresholdDisabled ? <InfoChip tone="warn">Thresholds disabled</InfoChip> : null}
            {parsed.threshold?.exceeded ? <InfoChip tone="error">Threshold exceeded</InfoChip> : null}
            {parsed.errorCount ? <InfoChip tone="error">{formatNumber(parsed.errorCount)} error lines</InfoChip> : null}
            {parsed.warnCount ? <InfoChip tone="warn">{formatNumber(parsed.warnCount)} warning lines</InfoChip> : null}
          </div>
        </div>

        <button
          className="btn"
          onClick={() => window.open(`/api/raw?path=${encodeURIComponent(path)}`, "_blank")}
        >
          Open original log
        </button>
      </div>

      <div className="idhub-dash__grid">
        <Card
          title="Source changes"
          subtitle="The overall diff for this run. This avoids treating one bad line as a failed job."
        >
          <MetricGrid items={sourceMetrics} />
        </Card>

        <Card
          title="Provisioning results"
          subtitle="Actions actually attempted across the ID Store and configured sinks."
        >
          <MetricGrid items={provisioningMetrics} />
        </Card>

        <Card
          title="Run details"
          subtitle="Tenant, source, and target context pulled from resources.json."
        >
          <DetailList rows={parsed.detailRows} />
        </Card>

        <Card
          title="Systems"
          subtitle="Per-system outcome summary. Failures are shown in-line instead of flagging the whole job as failed."
          className="idhub-dash__card--span"
        >
          <SystemsTable systems={parsed.systems} />
        </Card>

        <Card
          title="Warnings & failures"
          subtitle="Sample issues and parsed failure breakdowns from the summary JSON."
          className="idhub-dash__card--span"
        >
          <IssuesPanel
            failureBreakdown={parsed.failureBreakdown}
            issueSamples={parsed.issueSamples}
            warnCount={parsed.warnCount}
            errorCount={parsed.errorCount}
          />
        </Card>

        <Card
          title="Log output"
          subtitle="Remaining log lines after parsed JSON sections are removed."
          className="idhub-dash__card--span"
        >
          <LogOutput lines={parsed.logLines} />
        </Card>
      </div>
    </div>
  );
}
