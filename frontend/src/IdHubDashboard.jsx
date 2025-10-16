import { useEffect, useMemo, useState } from "react";

function redact(x) {
  if (x == null || typeof x !== "object") return x;
  if (Array.isArray(x)) return x.map(redact);
  const o = {};
  for (const [k, v] of Object.entries(x)) {
    const secret =
      /password|secret|privatekey|clientsecret|keystore|token/i.test(k);
    o[k] = secret ? "••••••" : redact(v);
  }
  return o;
}

function parseJsonAt(s, from) {
  let i = from,
    depth = 0,
    inStr = false,
    esc = false,
    start = -1;
  for (; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (c === "}") {
      depth--;
      if (depth === 0 && start !== -1)
        return { raw: s.slice(start, i + 1), endIdx: i + 1, startIdx: start };
    }
  }
  return null;
}

function findResourceBlocks(text) {
  const out = [];
  const re = /resources\.json\s*:/gi;
  let m;
  while ((m = re.exec(text))) {
    let j = m.index + m[0].length;
    while (j < text.length && text[j] !== "{" && text[j] !== "\n") j++;
    if (j >= text.length) break;
    const first = text.indexOf("{", j);
    if (first === -1) break;
    const seg = parseJsonAt(text, first);
    if (!seg) continue;
    const startLine =
      (text.slice(0, seg.startIdx).match(/\n/g) || []).length + 1;
    const endLine =
      startLine +
      (text.slice(seg.startIdx, seg.endIdx).match(/\n/g) || []).length;
    try {
      out.push({ startLine, endLine, data: JSON.parse(seg.raw) });
    } catch {}
    re.lastIndex = seg.endIdx;
  }
  return out;
}

function findBatchOrchestratorSummaries(text) {
  const out = [];
  const re = /BatchOrchestrator\s*-\s*{/g;
  let m;
  while ((m = re.exec(text))) {
    const seg = parseJsonAt(text, m.index + m[0].length - 1);
    if (!seg) continue;
    try {
      out.push(JSON.parse(seg.raw));
    } catch {}
    re.lastIndex = seg.endIdx;
  }
  return out;
}

function parseThresholdLine(text) {
  const m = text.match(
    /Threshold exceeded\s*=\s*(true|false).*?Source count:\s*(\d+).*?Add count\s*=\s*(\d+).*?Delete count\s*=\s*(\d+).*?Modify count\s*=\s*(\d+)/i,
  );
  if (!m) return null;
  return {
    exceeded: m[1].toLowerCase() === "true",
    source: +m[2],
    add: +m[3],
    del: +m[4],
    mod: +m[5],
  };
}

function Card({ title, children, style }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 12,
        background: "var(--surface)",
        ...style,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.45 }}>{children}</div>
    </div>
  );
}

function Pair({ k, v }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr",
        gap: 8,
        marginBottom: 6,
      }}
    >
      <div style={{ color: "var(--text-weak)" }}>{k}</div>
      <div style={{ overflowWrap: "anywhere" }}>{v}</div>
    </div>
  );
}

function Table({ rows, columns }) {
  return (
    <div style={{ overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: "left",
                  padding: "6px 8px",
                  background: "var(--surface)",
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr
                key={i}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    style={{ padding: "6px 8px", verticalAlign: "top" }}
                  >
                    {r[c.key]}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={columns.length}
                style={{ padding: 10, color: "var(--text-weak)" }}
              >
                none
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function filterNormalLines(text, jsonBlocks) {
  const ranges = jsonBlocks.map((b) => [b.startLine, b.endLine]);
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const inJson = ranges.some(([a, b]) => ln >= a && ln <= b);
    if (inJson) continue;
    const s = lines[i];
    if (/resources\.json\s*:/i.test(s)) continue;
    if (
      /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s) &&
      /\b(INFO|DEBUG|WARN|ERROR|TRACE)\b/.test(s)
    )
      out.push(s);
  }
  return out;
}

function firstLine(text, re) {
  const m = text.match(re);
  if (!m) return "";
  const start = m.index;
  const end = text.indexOf("\n", start);
  return text.slice(start, end === -1 ? undefined : end);
}

export default function IdHubDashboard({ path }) {
  const [loading, setLoading] = useState(true);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError("");
    setRaw("");
    fetch(`/api/raw?path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => {
        if (!cancel) setRaw(t);
      })
      .catch(() => {
        if (!cancel) setError("failed to load log");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [path]);

  const resourceBlocks = useMemo(
    () => (raw ? findResourceBlocks(raw) : []),
    [raw],
  );
  const latestResources = useMemo(
    () =>
      resourceBlocks.length
        ? redact(resourceBlocks[resourceBlocks.length - 1].data)
        : null,
    [resourceBlocks],
  );
  const boSummaries = useMemo(() => findBatchOrchestratorSummaries(raw), [raw]);
  const latestBo = useMemo(
    () => (boSummaries.length ? boSummaries[boSummaries.length - 1] : null),
    [boSummaries],
  );
  const thresholdLine = useMemo(() => parseThresholdLine(raw), [raw]);
  const normals = useMemo(
    () => filterNormalLines(raw, resourceBlocks),
    [raw, resourceBlocks],
  );

  const thresholdDisabled = useMemo(
    () => /Threshold checking has been disabled for this job run\./i.test(raw),
    [raw],
  );
  const jobFailed = useMemo(
    () =>
      /failed to complete batch job|job failed|uncategorizederror/i.test(raw),
    [raw],
  );
  const jobSucceeded = useMemo(
    () =>
      !jobFailed &&
      /\b(Pipeline complete|finished|completed successfully)\b/i.test(raw),
    [raw, jobFailed],
  );

  const failLine = useMemo(
    () =>
      firstLine(
        raw,
        /failed to complete batch job|job failed|uncategorizederror/i,
      ),
    [raw],
  );
  const successLine = useMemo(
    () =>
      firstLine(
        raw,
        /\b(Pipeline complete|finished|completed successfully)\b/i,
      ),
    [raw],
  );

  const job = latestResources?.jobInfo || {};
  const tenant = latestResources?.tenantApiInfo?.tenant || null;
  const domains = latestResources?.tenantApiInfo?.domains || null;
  const source = latestResources?.source || null;
  const policies = Array.isArray(latestResources?.policies)
    ? latestResources.policies
    : [];
  const sinks = Array.isArray(latestResources?.sinks)
    ? latestResources.sinks
    : [];
  const bridges = Array.isArray(latestResources?.bridges)
    ? latestResources.bridges
    : [];
  const idStore = latestResources?.identityStore || null;
  const schemas = Array.isArray(latestResources?.schemas)
    ? latestResources.schemas
    : idStore?.schemas || null;
  const stats = latestResources?.statistics?.content?.sourceStats || null;

  const summaryCounts = useMemo(() => {
    const out = {};
    if (stats && stats.ingested != null) out.ingested = stats.ingested;
    if (stats && stats.consolidated != null)
      out.consolidated = stats.consolidated;
    if (latestBo && latestBo.calculatedDiffStats) {
      const c = latestBo.calculatedDiffStats;
      if (c.matched != null) out.matched = c.matched;
      if (c.scheduledForDeletion != null)
        out.scheduledForDeletion = c.scheduledForDeletion;
    }
    if (thresholdLine) {
      out.add = thresholdLine.add;
      out.delete = thresholdLine.del;
      out.modify = thresholdLine.mod;
      out.source = thresholdLine.source;
      out.thresholdExceeded = thresholdLine.exceeded;
    }
    const nonzero = Object.entries(out).filter(([, v]) =>
      typeof v === "number" ? v !== 0 : v != null,
    );
    return nonzero.length ? out : null;
  }, [stats, latestBo, thresholdLine]);

  if (loading)
    return <main className="viewer center">building dashboard…</main>;
  if (error) return <main className="viewer center">{error}</main>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="toolbar">
        <div style={{ fontSize: 13, color: "var(--text-weak)" }}>
          {resourceBlocks.length
            ? `Extracted ${resourceBlocks.length} resources.json block${
                resourceBlocks.length > 1 ? "s" : ""
              } • showing latest`
            : "No resources.json block detected"}
        </div>
        <div className="spacer" />
        <button
          className="btn"
          onClick={() =>
            window.open(`/api/raw?path=${encodeURIComponent(path)}`, "_blank")
          }
        >
          Open original log
        </button>
      </div>

      <div style={{ padding: 12 }}>
        {thresholdDisabled && (
          <div
            style={{
              background: "#FEF3C7",
              color: "#92400E",
              border: "1px solid #FDE68A",
              borderRadius: 8,
              padding: 10,
              marginBottom: 10,
            }}
          >
            Threshold checking is disabled for this run
          </div>
        )}
        {jobFailed && (
          <div
            style={{
              background: "#FEE2E2",
              color: "#991B1B",
              border: "1px solid #FCA5A5",
              borderRadius: 8,
              padding: 10,
              marginBottom: 10,
            }}
          >
            Job failed{failLine ? `: ${failLine}` : ""}
          </div>
        )}
        {!jobFailed && jobSucceeded && (
          <div
            style={{
              background: "#DCFCE7",
              color: "#065F46",
              border: "1px solid #86EFAC",
              borderRadius: 8,
              padding: 10,
              marginBottom: 10,
            }}
          >
            Job finished{successLine ? `: ${successLine}` : ""}
          </div>
        )}
      </div>

      <div
        style={{
          padding: 12,
          overflow: "auto",
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(320px, 1fr))",
          gap: 12,
          gridAutoRows: "minmax(100px, auto)",
          flex: 1,
        }}
      >
        {summaryCounts && (
          <Card
            title="Summary"
            style={{ gridColumn: "1 / -1" }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(100px, 1fr))",
                gap: 10,
              }}
            >
              {Object.entries(summaryCounts).map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 10,
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-weak)",
                      textTransform: "capitalize",
                    }}
                  >
                    {k}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    {String(v)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {latestResources && (
          <Card title="Job">
            <Pair
              k="Job ID"
              v={job.jobId || "—"}
            />
            <Pair
              k="Invocation"
              v={job.invocationType || "—"}
            />
            <Pair
              k="Ingested"
              v={stats && stats.ingested != null ? String(stats.ingested) : "—"}
            />
            <Pair
              k="Consolidated"
              v={
                stats && stats.consolidated != null
                  ? String(stats.consolidated)
                  : "—"
              }
            />
          </Card>
        )}

        {latestResources && tenant && (
          <Card title="Tenant">
            <Pair
              k="Name"
              v={tenant.tenantName || "—"}
            />
            <Pair
              k="RI Tenant ID"
              v={tenant.riTenantId || "—"}
            />
            <Pair
              k="LCS Tenant ID"
              v={tenant.lcsTenantId || "—"}
            />
            {domains && (
              <>
                <Pair
                  k="Domain"
                  v={domains.domain || "—"}
                />
                <Pair
                  k="Vanity"
                  v={domains.vanityDomain || "—"}
                />
              </>
            )}
          </Card>
        )}

        {latestResources && idStore && (
          <Card title="Identity Store">
            <Pair
              k="Host"
              v={
                idStore.connection
                  ? `${idStore.connection.host || "—"}:${
                      idStore.connection.port || "—"
                    }`
                  : "—"
              }
            />
            {Array.isArray(schemas) && schemas.length > 0 && (
              <Pair
                k="Schemas"
                v={schemas.map((s) => s.schemaPath || s).join(", ")}
              />
            )}
          </Card>
        )}

        {latestResources && source && (
          <Card title="Source">
            <Pair
              k="Adapter"
              v={source.sourceAdapterInfo?.className || "—"}
            />
            <Pair
              k="Map Rules"
              v={
                Array.isArray(source.mapRulesWithArgs)
                  ? `${source.mapRulesWithArgs.length} rule set(s)`
                  : "—"
              }
            />
          </Card>
        )}

        {latestResources && (
          <Card title="Policies">
            <Table
              columns={[
                { key: "name", label: "Name" },
                { key: "scope", label: "Scope" },
              ]}
              rows={
                Array.isArray(policies)
                  ? policies.map((p) => ({
                      name: p.name || "—",
                      scope: p.scope || "—",
                    }))
                  : []
              }
            />
          </Card>
        )}

        {latestResources && (
          <Card title="Sinks">
            <Table
              columns={[
                { key: "adapter", label: "Adapter" },
                { key: "scope", label: "Scope" },
              ]}
              rows={
                Array.isArray(sinks)
                  ? sinks.map((s) => ({
                      adapter: s.sinkAdapterInfo?.className || "—",
                      scope:
                        (s.scopes && (s.scopes.PERSON || s.scopes.person)) ||
                        "—",
                    }))
                  : []
              }
            />
          </Card>
        )}

        {latestResources && Array.isArray(bridges) && bridges.length > 0 && (
          <Card title="Bridges">
            <Table
              columns={[
                { key: "host", label: "Host" },
                { key: "port", label: "Port" },
              ]}
              rows={bridges.map((b) => ({
                host: b.host || "—",
                port: String(b.port ?? "—"),
              }))}
            />
          </Card>
        )}

        <Card
          title="Log messages"
          style={{ gridColumn: "1 / -1" }}
        >
          <div
            style={{
              maxHeight: 260,
              overflow: "auto",
              fontFamily: "var(--mono)",
              fontSize: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {normals.slice(-1000).join("\n") || "none"}
          </div>
        </Card>
      </div>
    </div>
  );
}
