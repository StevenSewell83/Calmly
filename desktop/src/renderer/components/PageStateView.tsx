import type { ReactNode } from "react";
import type { ResourceState } from "../hooks/useResource";

// PageStateView (calmly-3py.8) — single source of truth for the
// loading / signed-out / error chrome that every page-level fetch
// produces. Pages render `<PageStateView state={state} ready={(d) =>
// <Content data={d} />} />` and don't have to repeat the four-branch
// ternary themselves.
//
// The default LoadingShell is a generic 3-row skeleton; pages with a
// distinctive layout (Home, Triage) can pass `loadingFallback` to swap
// it. Failure copy and the signed-out nudge live ONLY here so a future
// tweak to either lands in one diff.

export interface PageStateViewProps<T> {
  state: ResourceState<T>;
  ready: (data: T) => ReactNode;
  // Optional skeleton override. Defaults to <DefaultLoadingShell/>.
  loadingFallback?: ReactNode;
  // Body line for the signed-out state, e.g. "Sign in to see your inbox."
  signedOutBody?: string;
  // Aria-label for the loading region (a11y screen-reader cue).
  loadingLabel?: string;
}

export function PageStateView<T>({
  state,
  ready,
  loadingFallback,
  signedOutBody = "Sign in to continue.",
  loadingLabel = "Loading",
}: PageStateViewProps<T>): ReactNode {
  if (state.kind === "loading") {
    return loadingFallback ?? <DefaultLoadingShell label={loadingLabel} />;
  }
  if (state.kind === "signed-out") {
    return <FailureNotice title="You're signed out." body={signedOutBody} />;
  }
  if (state.kind === "error") {
    return <FailureNotice title="Something hiccuped." body={state.message} />;
  }
  return ready(state.data);
}

// Generic three-row pulse — matches the visual rhythm of InboxList /
// Plan and is calm enough for any page that hasn't customised.
function DefaultLoadingShell({ label }: { label: string }): ReactNode {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-2">
      <div className="rounded-[1.8rem] bg-stone-100/60 h-20 animate-pulse" />
      <div className="rounded-[1.8rem] bg-stone-100/60 h-20 animate-pulse" />
      <div className="rounded-[1.8rem] bg-stone-100/60 h-20 animate-pulse" />
    </div>
  );
}

// Single canonical card for both signed-out and error states. Re-exported
// in case a non-PageStateView call site (banners, modals) wants the same
// chrome — pages SHOULD prefer PageStateView.
export function FailureNotice({
  title,
  body,
}: {
  title: string;
  body: string;
}): ReactNode {
  return (
    <div
      role="alert"
      className="rounded-[1.8rem] border border-stone-200 bg-white/60 px-6 py-5 max-w-md"
    >
      <p className="text-sm text-stone-800 font-medium">{title}</p>
      <p className="mt-1 text-xs text-stone-500">{body}</p>
    </div>
  );
}
