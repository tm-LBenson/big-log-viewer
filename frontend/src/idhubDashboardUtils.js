const LOG_LINE_RE =
  /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+([^\s]+)\s+(?:-|–|—)\s*(.*)$/;

const ACTION_META = [
  { bucket: "creationStats", key: "created", label: "Created" },
  { bucket: "updateStats", key: "updated", label: "Updated" },
  { bucket: "deletionStats", key: "deleted", label: "Deleted" },
  { bucket: "disableStats", key: "disabled", label: "Disabled" },
  { bucket: "enableStats", key: "enabled", label: "Enabled" },
];

const EXTRA_SUCCESS_KEYS = ["moved", "disabled", "enabled"];

function toNum(value) {
  return Number.isFinite(value) ? value : 0;
}

function humanizeToken(value) {
  return String(value || "")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (m) => m.toUpperCase());
}

function tidySystemName(name) {
  if (!name) return "Unknown";
  if (!String(name).includes(".")) return humanizeToken(name);
  const tail = String(name).split(".").pop() || name;
  return humanizeToken(tail.replace(/Adapter$/, ""));
}

export function redact(value) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [key, next] of Object.entries(value)) {
    const secret =
      /password|secret|privatekey|clientsecret|keystore|token|bearer|apikey/i.test(
        key,
      );
    out[key] = secret ? "••••••" : redact(next);
  }
  return out;
}

function parseJsonAt(text, from) {
  let i = from;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let start = -1;
  for (; i < text.length; i += 1) {
    const char = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (char === "\\") esc = true;
      else if (char === '"') inStr = false;
      continue;
    }
    if (char === '"') {
      inStr = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        return { raw: text.slice(start, i + 1), startIdx: start, endIdx: i + 1 };
      }
    }
  }
  return null;
}

function lineNumberAt(text, idx) {
  return (text.slice(0, idx).match(/\n/g) || []).length + 1;
}

function buildBlock(text, seg, kind, lineStartIdx = seg.startIdx) {
  const startLine = lineNumberAt(text, lineStartIdx);
  const endLine = startLine + (text.slice(lineStartIdx, seg.endIdx).match(/\n/g) || []).length;
  return { ...seg, startLine, endLine, kind };
}

function findResourceBlocks(text) {
  const blocks = [];
  const re = /^.*resources\.json(?:[^\n{]*)?:\s*$/gim;
  let match;
  while ((match = re.exec(text))) {
    const firstBrace = text.indexOf("{", match.index + match[0].length);
    if (firstBrace === -1) break;
    const seg = parseJsonAt(text, firstBrace);
    if (!seg) continue;
    try {
      blocks.push({
        ...buildBlock(text, seg, "resource", match.index),
        data: JSON.parse(seg.raw),
      });
    } catch {
      // ignore malformed blocks
    }
    re.lastIndex = seg.endIdx;
  }
  return blocks;
}

function findBatchSummaryBlocks(text) {
  const blocks = [];
  const re = /BatchOrchestrator\s*-\s*{/g;
  let match;
  while ((match = re.exec(text))) {
    const seg = parseJsonAt(text, match.index + match[0].length - 1);
    if (!seg) continue;
    const lineStartIdx = text.lastIndexOf("\n", match.index) + 1;
    try {
      blocks.push({ ...buildBlock(text, seg, "summary", lineStartIdx), data: JSON.parse(seg.raw) });
    } catch {
      // ignore malformed blocks
    }
    re.lastIndex = seg.endIdx;
  }
  return blocks;
}

function parseThresholdLine(text) {
  const match = text.match(
    /Threshold exceeded\s*=\s*(true|false).*?Source count:\s*(\d+).*?Add count\s*=\s*(\d+).*?Delete count\s*=\s*(\d+).*?Modify count\s*=\s*(\d+)/is,
  );
  if (!match) return null;
  return {
    exceeded: match[1].toLowerCase() === "true",
    source: Number(match[2]),
    add: Number(match[3]),
    del: Number(match[4]),
    mod: Number(match[5]),
  };
}

function parseConnectionInfo(value) {
  if (!value) return null;
  if (typeof value === "object") return redact(value);
  try {
    return redact(JSON.parse(value));
  } catch {
    return null;
  }
}

function isLineBlocked(lineNumber, blocks) {
  return blocks.some((block) => lineNumber >= block.startLine && lineNumber <= block.endLine);
}

function parseLogLine(raw, index) {
  const match = raw.match(LOG_LINE_RE);
  if (!match) {
    return {
      id: `${index}-${raw.slice(0, 24)}`,
      lineNumber: index,
      raw,
      level: "plain",
      logger: "",
      timestamp: "",
      message: raw,
    };
  }
  return {
    id: `${index}-${match[1]}`,
    lineNumber: index,
    raw,
    timestamp: match[1],
    level: match[2].toLowerCase(),
    logger: match[3],
    message: match[4] || "",
  };
}

function filterNonJsonLines(text, blocks) {
  return text
    .split(/\r?\n/)
    .map((line, i) => ({ line, number: i + 1 }))
    .filter(({ line, number }) => !isLineBlocked(number, blocks) && line.trim() !== "")
    .map(({ line, number }) => parseLogLine(line, number));
}

function firstMatchingLine(lines, predicate) {
  return lines.find(predicate) || null;
}

function lastMatchingLine(lines, predicate) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (predicate(lines[i])) return lines[i];
  }
  return null;
}

function sumActionBuckets(actorStats) {
  const actions = {};
  const extras = {};
  let failed = 0;
  let any = false;

  if (!actorStats || typeof actorStats !== "object") {
    return { actions, extras, failed, hasData: false };
  }

  for (const meta of ACTION_META) {
    const bucket = actorStats[meta.bucket];
    if (!bucket || typeof bucket !== "object" || !Object.keys(bucket).length) continue;
    const total = toNum(bucket.total);
    const succeeded = toNum(bucket.succeeded);
    const bucketFailed = toNum(bucket.failed);
    const successDetails = bucket.successDetails && typeof bucket.successDetails === "object"
      ? bucket.successDetails
      : {};
    any = any || total > 0 || succeeded > 0 || bucketFailed > 0;
    failed += bucketFailed;
    actions[meta.key] = {
      label: meta.label,
      total,
      succeeded,
      failed: bucketFailed,
    };
    for (const extraKey of EXTRA_SUCCESS_KEYS) {
      const next = toNum(successDetails[extraKey]);
      if (next > 0) extras[extraKey] = (extras[extraKey] || 0) + next;
    }
  }

  return { actions, extras, failed, hasData: any };
}

function buildSystemSummary(name, stats, kind) {
  if (!stats || typeof stats !== "object") return null;
  const people = sumActionBuckets(stats.personStats);
  const groups = sumActionBuckets(stats.groupStats);
  if (!people.hasData && !groups.hasData) return null;
  return {
    id: stats.systemId || `${kind}-${name}`,
    name: tidySystemName(stats.systemName || name),
    rawName: stats.systemName || name,
    kind,
    people,
    groups,
    failed: people.failed + groups.failed,
  };
}

function collectSystemSummaries(summary) {
  const systems = [];
  const idStoreStats = summary?.idStoreStats;
  if (idStoreStats?.synchronizationStats) {
    const next = buildSystemSummary(
      idStoreStats.synchronizationStats.systemName || "Identity Store Sync",
      idStoreStats.synchronizationStats,
      "idstore",
    );
    if (next) systems.push(next);
  }
  if (idStoreStats?.reconciliationStats) {
    const next = buildSystemSummary(
      idStoreStats.reconciliationStats.systemName || "Identity Store Reconciliation",
      idStoreStats.reconciliationStats,
      "idstore",
    );
    if (next) systems.push(next);
  }
  if (summary?.sinkStats && typeof summary.sinkStats === "object") {
    for (const [id, stats] of Object.entries(summary.sinkStats)) {
      const next = buildSystemSummary(stats?.systemName || id, stats, "sink");
      if (next) systems.push(next);
    }
  }
  return systems;
}

function buildActionTotals(systems) {
  const people = {
    created: 0,
    updated: 0,
    deleted: 0,
    disabled: 0,
    enabled: 0,
    failed: 0,
    moved: 0,
  };
  const groups = {
    created: 0,
    updated: 0,
    deleted: 0,
    failed: 0,
  };

  for (const system of systems) {
    for (const key of ["people", "groups"]) {
      const bucket = key === "people" ? people : groups;
      const source = system[key];
      for (const [actionKey, action] of Object.entries(source.actions)) {
        bucket[actionKey] = (bucket[actionKey] || 0) + toNum(action.total);
      }
      bucket.failed += source.failed;
      if (key === "people") {
        for (const [extraKey, value] of Object.entries(source.extras || {})) {
          people[extraKey] = (people[extraKey] || 0) + toNum(value);
        }
      }
    }
  }

  return { people, groups };
}

function collectFailureBreakdown(summary) {
  const counts = new Map();

  function walkFailureDetails(details) {
    if (!details || typeof details !== "object") return;
    for (const [key, value] of Object.entries(details)) {
      if (key === "roleStats") continue;
      if (Number.isFinite(value)) {
        counts.set(key, (counts.get(key) || 0) + value);
      } else if (value && typeof value === "object") {
        walkFailureDetails(value);
      }
    }
  }

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.failureDetails) walkFailureDetails(node.failureDetails);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    Object.values(node).forEach(walk);
  }

  walk(summary);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: humanizeToken(key), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildSourceDiff(threshold, summary) {
  const diff = {
    sourceRecords: threshold?.source,
    adds: threshold?.add,
    modifies: threshold?.mod,
    deletes: threshold?.del,
    matched: summary?.calculatedDiffStats?.matched,
    scheduledForDeletion: summary?.calculatedDiffStats?.scheduledForDeletion,
    ingested: summary?.sourceStats?.ingested,
    consolidated: summary?.sourceStats?.consolidated,
  };
  return diff;
}

function cleanIssueMessage(message) {
  return String(message || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractIssueSamples(lines) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    if (!["warn", "error"].includes(line.level)) continue;
    const message = cleanIssueMessage(line.message || line.raw);
    const key = `${line.level}:${line.logger}:${message.slice(0, 160)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      level: line.level,
      timestamp: line.timestamp,
      logger: line.logger,
      message,
    });
    if (out.length >= 8) break;
  }
  return out;
}

function computeStatus({ pipelineCompleteLine, explicitFailureLine, actionTotals, errorCount, warnCount }) {
  const failedActions = toNum(actionTotals?.people?.failed) + toNum(actionTotals?.groups?.failed);
  if (explicitFailureLine) {
    return {
      tone: "error",
      label: "Failed",
      detail: cleanIssueMessage(explicitFailureLine.message || explicitFailureLine.raw),
    };
  }
  if (pipelineCompleteLine) {
    if (failedActions > 0 || errorCount > 0 || warnCount > 0) {
      const parts = [];
      if (failedActions > 0) parts.push(`${failedActions} failed action${failedActions === 1 ? "" : "s"}`);
      if (errorCount > 0) parts.push(`${errorCount} error line${errorCount === 1 ? "" : "s"}`);
      if (warnCount > 0) parts.push(`${warnCount} warning line${warnCount === 1 ? "" : "s"}`);
      return {
        tone: "warn",
        label: "Completed with issues",
        detail: parts.length ? `Pipeline completed, but ${parts.join(" and ")}.` : "Pipeline completed.",
      };
    }
    return {
      tone: "success",
      label: "Completed",
      detail: cleanIssueMessage(pipelineCompleteLine.message || pipelineCompleteLine.raw || "Pipeline complete."),
    };
  }
  return {
    tone: "neutral",
    label: "Incomplete log",
    detail: "No final pipeline completion line was found in this capture.",
  };
}

function buildDetailRows(resources, parsedSourceConnection) {
  const tenant = resources?.tenantApiInfo?.tenant;
  const domains = resources?.tenantApiInfo?.domains;
  const source = resources?.source;
  const idStore = resources?.identityStore;
  const idConnection = idStore?.connection || {};
  const authority = resources?.authority;

  return [
    { label: "Job ID", value: resources?.jobInfo?.jobId || "—" },
    { label: "RI Tenant ID", value: tenant?.riTenantId || "—" },
    { label: "LCS Tenant ID", value: tenant?.lcsTenantId || "—" },
    { label: "Domain", value: domains?.domain || domains?.vanityDomain || "—" },
    { label: "Source adapter", value: tidySystemName(source?.sourceAdapterInfo?.className || "—") },
    {
      label: "Source path",
      value:
        parsedSourceConnection?.connection?.path ||
        parsedSourceConnection?.path ||
        parsedSourceConnection?.connection?.host ||
        "—",
    },
    {
      label: "Source host",
      value: parsedSourceConnection?.connection?.host
        ? `${parsedSourceConnection.connection.host}:${parsedSourceConnection.connection.port || "—"}`
        : "—",
    },
    {
      label: "Identity store",
      value: idConnection?.host ? `${idConnection.host}:${idConnection.port || "—"}` : "—",
    },
    {
      label: "Policies",
      value: Array.isArray(resources?.policies) ? String(resources.policies.length) : "0",
    },
    {
      label: "Targets",
      value: Array.isArray(resources?.sinks) ? String(resources.sinks.length) : "0",
    },
    {
      label: "Authorities",
      value: Array.isArray(authority?.sourceAuthorities)
        ? String(authority.sourceAuthorities.length)
        : "0",
    },
  ];
}

export function parseIdHubLog(raw) {
  const resourceBlocks = findResourceBlocks(raw);
  const summaryBlocks = findBatchSummaryBlocks(raw);
  const latestResources = resourceBlocks.length
    ? redact(resourceBlocks[resourceBlocks.length - 1].data)
    : null;
  const latestSummary = summaryBlocks.length
    ? redact(summaryBlocks[summaryBlocks.length - 1].data)
    : null;
  const threshold = parseThresholdLine(raw);
  const thresholdDisabled = /Threshold checking has been disabled for this job run\.?/i.test(raw);
  const blocks = [...resourceBlocks, ...summaryBlocks];
  const logLines = filterNonJsonLines(raw, blocks);
  const errorCount = logLines.filter((line) => line.level === "error").length;
  const warnCount = logLines.filter((line) => line.level === "warn").length;
  const pipelineCompleteLine = lastMatchingLine(
    logLines,
    (line) => /\bPipeline complete\b/i.test(line.message || line.raw),
  );
  const explicitFailureLine = firstMatchingLine(
    logLines,
    (line) => /failed to complete batch job|job failed|uncategorizederror/i.test(line.message || line.raw),
  );
  const systems = collectSystemSummaries(latestSummary);
  const actionTotals = buildActionTotals(systems);
  const failureBreakdown = collectFailureBreakdown(latestSummary);
  const sourceDiff = buildSourceDiff(threshold, latestSummary);
  const sourceConnection = parseConnectionInfo(latestResources?.source?.connectionInfo);
  const status = computeStatus({
    pipelineCompleteLine,
    explicitFailureLine,
    actionTotals,
    errorCount,
    warnCount,
  });

  return {
    resourceBlocks,
    summaryBlocks,
    latestResources,
    latestSummary,
    threshold,
    thresholdDisabled,
    sourceConnection,
    logLines,
    issueSamples: extractIssueSamples(logLines),
    errorCount,
    warnCount,
    systems,
    actionTotals,
    failureBreakdown,
    sourceDiff,
    status,
    detailRows: buildDetailRows(latestResources, sourceConnection),
  };
}
