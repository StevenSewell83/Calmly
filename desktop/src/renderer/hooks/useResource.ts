import { useCallback, useEffect, useRef, useState } from "react";

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

export function useResource<T>(
  fetcher: () => Promise<FetcherResult<T>>,
  deps: readonly unknown[],
): UseResourceReturn<T> {
  const [state, setState] = useState<ResourceState<T>>({ kind: "loading" });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    setState((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
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
      setState((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
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
