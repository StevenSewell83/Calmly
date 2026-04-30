// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useResource } from "../useResource";
import type { FetcherResult } from "../useResource";

function defer<T>() {
  let resolve!: (v: FetcherResult<T>) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<FetcherResult<T>>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useResource", () => {
  it("loading → ready on successful fetch", async () => {
    const { promise, resolve } = defer<{ name: string }>();
    const fetcher = vi.fn(() => promise);
    const { result } = renderHook(() => useResource(fetcher, []));

    expect(result.current.state.kind).toBe("loading");

    await act(async () => {
      resolve({ kind: "ok", data: { name: "Alice" } });
    });

    await waitFor(() =>
      expect(result.current.state.kind).toBe("ready"),
    );
    expect(
      result.current.state.kind === "ready"
        ? result.current.state.data
        : null,
    ).toEqual({ name: "Alice" });
  });

  it("loading → signed-out when fetcher returns signed-out", async () => {
    const { promise, resolve } = defer<never>();
    const fetcher = vi.fn(() => promise);
    const { result } = renderHook(() => useResource(fetcher, []));

    await act(async () => {
      resolve({ kind: "signed-out" });
    });

    await waitFor(() =>
      expect(result.current.state.kind).toBe("signed-out"),
    );
  });

  it("loading → error when fetcher returns error result", async () => {
    const { promise, resolve } = defer<never>();
    const fetcher = vi.fn(() => promise);
    const { result } = renderHook(() => useResource(fetcher, []));

    await act(async () => {
      resolve({ kind: "error", message: "oops" });
    });

    await waitFor(() =>
      expect(result.current.state.kind).toBe("error"),
    );
    expect(
      result.current.state.kind === "error"
        ? result.current.state.message
        : null,
    ).toBe("oops");
  });

  it("loading → error when fetcher throws", async () => {
    const { promise, reject } = defer<never>();
    const fetcher = vi.fn(() => promise);
    const { result } = renderHook(() => useResource(fetcher, []));

    await act(async () => {
      reject(new Error("network failure"));
    });

    await waitFor(() =>
      expect(result.current.state.kind).toBe("error"),
    );
    expect(
      result.current.state.kind === "error"
        ? result.current.state.message
        : null,
    ).toBe("network failure");
  });

  it("refresh re-fetches and updates state", async () => {
    let call = 0;
    const fetcher = vi.fn(
      () =>
        Promise.resolve<FetcherResult<number>>({
          kind: "ok",
          data: ++call,
        }),
    );
    const { result } = renderHook(() => useResource(fetcher, []));

    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    expect(
      result.current.state.kind === "ready" ? result.current.state.data : null,
    ).toBe(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(
      result.current.state.kind === "ready" ? result.current.state.data : null,
    ).toBe(2);
  });
});
