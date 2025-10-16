import { useContext } from "react";
import SearchCtx from "./SearchContext";

const fallback = {
  abs: () => 0,
  getLine: () => "",
  hl: false,
  hlMode: "line",
  raw: false,
  wrap: false,
  lineNums: false,
  matches: [],
  cur: 0,
  q: "",
  regex: false,
  caseSensitive: false,
  htmlLight: false,
  colors: { hover: "#eef2f7", line: "#cfe3ff", mark: "#7dd3fc" },
  controls: null,
  lineBar: null,
  mode: "rendered",
  idhubLevels: {
    trace: true,
    debug: true,
    info: true,
    warn: true,
    error: true,
  },
  openInspectorAt: () => {},
  closeInspector: () => {},
  inspect: null,
};

export default function useSearch() {
  return useContext(SearchCtx) || fallback;
}
