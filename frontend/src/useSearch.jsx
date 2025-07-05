import { useContext } from "react";
import SearchCtx from "./SearchContext";

const fallback = {
  abs: () => 0,
  getLine: () => "",
  hl: false,
  raw: false,
  matches: [],
  cur: 0,
  controls: null,
};

export default function useSearch() {
  return useContext(SearchCtx) || fallback;
}
