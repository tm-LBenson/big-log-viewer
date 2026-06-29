import { useMemo } from "react";
import { ROW } from "./constants";
import useSearch from "./useSearch";

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const ALLOWED_TAGS = new Set([
  "B",
  "BR",
  "CODE",
  "EM",
  "FONT",
  "I",
  "MARK",
  "PRE",
  "S",
  "SPAN",
  "STRONG",
  "U",
]);
const DROP_TAGS = new Set([
  "BASE",
  "EMBED",
  "FORM",
  "IFRAME",
  "IMG",
  "INPUT",
  "LINK",
  "MATH",
  "META",
  "NOSCRIPT",
  "OBJECT",
  "SCRIPT",
  "STYLE",
  "SVG",
  "TEMPLATE",
  "VIDEO",
]);

function isSafeColor(value) {
  const clean = String(value || "").trim();
  if (!clean || /url\s*\(|expression\s*\(|javascript\s*:|@import/i.test(clean)) {
    return "";
  }
  if (typeof CSS !== "undefined" && CSS.supports?.("color", clean)) return clean;
  if (/^#[0-9a-f]{3,8}$/i.test(clean)) return clean;
  return "";
}

function sanitizeInlineStyle(value, preserveColors) {
  if (!preserveColors) return "";
  return String(value || "")
    .split(";")
    .map((part) => {
      const idx = part.indexOf(":");
      if (idx <= 0) return "";
      const prop = part.slice(0, idx).trim().toLowerCase();
      if (prop !== "color" && prop !== "background-color") return "";
      const color = isSafeColor(part.slice(idx + 1));
      return color ? `${prop}: ${color}` : "";
    })
    .filter(Boolean)
    .join("; ");
}

function sanitizeHtml(html, { preserveColors }) {
  if (typeof document === "undefined") return escapeHtml(String(html || ""));

  const template = document.createElement("template");
  template.innerHTML = String(html || "");

  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return document.createTextNode("");
    }

    const tag = node.tagName.toUpperCase();
    if (DROP_TAGS.has(tag)) {
      return document.createTextNode("");
    }

    if (!ALLOWED_TAGS.has(tag)) {
      const fragment = document.createDocumentFragment();
      node.childNodes.forEach((child) => fragment.appendChild(cleanNode(child)));
      return fragment;
    }

    const out = document.createElement(tag.toLowerCase());
    if (tag === "SPAN" && node.classList.contains("hl-line")) {
      out.className = "hl-line";
    }
    const style = sanitizeInlineStyle(node.getAttribute("style"), preserveColors);
    if (style) out.setAttribute("style", style);
    if (tag === "FONT" && preserveColors) {
      const color = isSafeColor(node.getAttribute("color"));
      if (color) out.setAttribute("color", color);
    }
    node.childNodes.forEach((child) => out.appendChild(cleanNode(child)));
    return out;
  };

  const fragment = document.createDocumentFragment();
  template.content.childNodes.forEach((child) => fragment.appendChild(cleanNode(child)));
  const wrapper = document.createElement("div");
  wrapper.appendChild(fragment);
  return wrapper.innerHTML;
}
function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function markWordInHtml(html, re) {
  const parts = html.split(/(<[^>]+>)/g);
  return parts
    .map((p) => (p.startsWith("<") ? p : p.replace(re, "<mark>$&</mark>")))
    .join("");
}
function searchRegExp(q, regex, caseSensitive) {
  const flags = caseSensitive ? "g" : "gi";
  try {
    return regex ? new RegExp(q, flags) : new RegExp(escRe(q), flags);
  } catch {
    return null;
  }
}

export default function Row({ i }) {
  const {
    abs,
    getLine,
    hl,
    hlMode,
    raw,
    wrap,
    lineNums,
    matches,
    cur,
    q,
    regex,
    caseSensitive,
    htmlLight,
    streamMode,
  } = useSearch();

  const num = useMemo(() => {
    const n = abs(i) + 1;
    return String(n).padStart(6, " ");
  }, [i, abs]);

  const line = getLine(i) || "";

  const html = useMemo(() => {
    const renderRaw = raw || streamMode;
    const v = renderRaw
      ? escapeHtml(line)
      : sanitizeHtml(line, { preserveColors: htmlLight });

    if (!hl) return v;

    const isCur = matches[cur] === abs(i);
    if (!isCur) return v;

    if (hlMode === "line") {
      return `<span class="hl-line">${v}</span>`;
    }

    if (!q) return v;
    const re = searchRegExp(q, regex, caseSensitive);
    return re ? markWordInHtml(v, re) : v;
  }, [
    line,
    raw,
    hl,
    hlMode,
    matches,
    cur,
    q,
    regex,
    caseSensitive,
    abs,
    i,
    htmlLight,
    streamMode,
  ]);

  return (
    <div
      className="log-row"
      style={{ minHeight: ROW, height: wrap ? "auto" : ROW }}
    >
      <span
        className="lnum"
        style={{ display: lineNums ? "inline-block" : "none" }}
      >
        {num}
      </span>
      <span
        className="log-text"
        style={{
          display: "block",
          paddingLeft: lineNums ? "var(--gutter, 0px)" : 0,
          whiteSpace: wrap ? "pre-wrap" : "pre",
          wordBreak: wrap ? "break-word" : "normal",
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
