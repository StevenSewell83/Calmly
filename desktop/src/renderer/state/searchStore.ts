import { useState, useCallback, useEffect, useRef } from "react";
import type { SearchHit } from "@calmly/shared";

export interface SearchState {
  open: boolean;
  query: string;
  hits: SearchHit[];
  loading: boolean;
  selectedIndex: number;
}

const DEBOUNCE_MS = 120;
const LOADING_THRESHOLD_MS = 150;

export function useSearchStore() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeOverlay = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHits([]);
    setSelectedIndex(0);
    setLoading(false);
  }, []);

  const openOverlay = useCallback(() => {
    setOpen(true);
    setQuery("");
    setHits([]);
    setSelectedIndex(0);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      setLoading(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);

    loadingTimerRef.current = setTimeout(
      () => setLoading(true),
      LOADING_THRESHOLD_MS,
    );

    debounceRef.current = setTimeout(async () => {
      try {
        const result = await window.calmly.search.query(query);
        if (result.ok) {
          setHits(result.hits);
          setSelectedIndex(0);
        }
      } finally {
        if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (loadingTimerRef.current) clearTimeout(loadingTimerRef.current);
    };
  }, [query]);

  const moveSelection = useCallback(
    (dir: 1 | -1) => {
      if (hits.length === 0) return;
      setSelectedIndex((prev) => {
        const next = prev + dir;
        if (next < 0) return hits.length - 1;
        if (next >= hits.length) return 0;
        return next;
      });
    },
    [hits.length],
  );

  return {
    open,
    query,
    hits,
    loading,
    selectedIndex,
    openOverlay,
    closeOverlay,
    setQuery,
    moveSelection,
  };
}
