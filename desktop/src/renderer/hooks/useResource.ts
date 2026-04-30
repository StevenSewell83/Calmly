import { useCallback, useEffect, useRef, useState } from "react";

// REFACTOR-AUDIT-4: shared fetch-state machine for renderer pages.
// Replaces the same hand-written try/catch + discriminated-union state
// machine that lived in useInboxList, useTodaySummary, usePlanForDay,
// useFocusSession, and useReviewSummary.
//
// The fetcher returns one of three sentinel results so pages don't
// need to throw to signal 'signed-out'. Thrown errors are caught and
// surfaced as { kind: "error" } so an unexpected exception never
// blanks out the UI without a message.

export type ResourceState<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "signed-out" }
  | { kind: "error"; message: string };

export type FetcherResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "signed-out" }
  | { kind: "error"; message: string };

export interface UseResourceReturn<T> {
  state: ResourceState<T>;
  refresh: () => Promise<void>;
}

// On a refresh-after-success, we keep the prior `ready` state visible
// instead of flickering through `loading` again. Pages that want a
// loading flash on refresh can manage that locally; the common case
// is "data already on screen, swap it in place".
export function useResource<T>(
  fetcher: () => Promise<FetcherResult<T>>,
  deps: readonly unknown[],
): UseResourceReturn<T> {
  const [state, setState] = useState<ResourceState<T>>({ kind: "loading" });
  // Capture latest fetcher in a ref so the refresh callback's identity
  // is stable across renders even when the inline arrow-fn passed by
  // the caller changes — only deps re-trigger the effect.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    setState((prev) =>
      prev.kind === "ready" ? prev : { kind: "loading" },
    );
    let result: FetcherResult<T>;
    try {
      result = await fetcherRef.current();
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    if (result.kind === "ok") setState({ kind: "ready", data: result.data });
    else if (result.kind === "signed-out") setState({ kind: "signed-out" });
    else setState({ kind: "error", message: result.message });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setState((prev) =>
        prev.kind === "ready" ? prev : { kind: "loading" },
      );
      let result: FetcherResult<T>;
      try {
        result = await fetcherRef.current();
      } catch (e) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
        return;
      }
      if (cancelled) return;
      if (result.kind === "ok") setState({ kind: "ready", data: result.data });
      else if (result.kind === "signed-out") setState({ kind: "signed-out" });
      else setState({ kind: "error", message: result.message });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { state, refresh };
}
