const KEY = "biglog.savedSearches.v1";
const LIMIT = 50;

function cleanTerm(term) {
  return String(term || "").replace(/\s+/g, " ").trim().slice(0, 240);
}

export function readSavedSearches() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(cleanTerm).filter(Boolean).slice(0, LIMIT);
  } catch {
    return [];
  }
}

function writeSavedSearches(items) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    //
  }
}

export function addSavedSearch(term) {
  const clean = cleanTerm(term);
  if (!clean) return readSavedSearches();
  const next = [clean, ...readSavedSearches().filter((item) => item !== clean)].slice(0, LIMIT);
  writeSavedSearches(next);
  return next;
}

export function removeSavedSearch(term) {
  const clean = cleanTerm(term);
  const next = readSavedSearches().filter((item) => item !== clean);
  writeSavedSearches(next);
  return next;
}
