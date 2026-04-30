import type { ReactNode } from "react";
import type { ResourceState } from "../hooks/useResource";

// REFACTOR-AUDIT-4: shared loading/signed-out/error shell used by every
// page-level read. Owns the universal copy ("You're signed out.",
// "Something hiccuped.") so future pages don't re-invent the wheel.
//
// `loading` is a per-page slot — Home wants stacked cards, Inbox wants
// rows, Plan wants a grid+sidebar — but signed-out and error states
// share visuals across the app.

interface Props<T> {
  state: ResourceState<T>;
  ready: (data: T) => ReactNode;
  loading: ReactNode;
  // Override copy when a page wants to nudge the user differently
  // (e.g. Review wants "Sign in to close out your day"). Defaults are
  // calm and generic.
  signedOutTitle?: string;
  signedOutBody?: string;
}

const DEFAULT_SIGNED_OUT_TITLE = "You're signed out.";
const DEFAULT_SIGNED_OUT_BODY = "Sign in to keep going.";
const ERROR_TITLE = "Something hiccuped.";

export function PageStateView<T>({
  state,
  ready,
  loading,
  signedOutTitle = DEFAULT_SIGNED_OUT_TITLE,
  signedOutBody = DEFAULT_SIGNED_OUT_BODY,
}: Props<T>): ReactNode {
  if (state.kind === "loading") return loading;
  if (state.kind === "signed-out") {
    return <FailureNotice title={signedOutTitle} body={signedOutBody} />;
  }
  if (state.kind === "error") {
    return <FailureNotice title={ERROR_TITLE} body={state.message} />;
  }
  return ready(state.data);
}

interface FailureNoticeProps {
  title: string;
  body: string;
}

// Public so pages with bespoke composite states (e.g. Focus combining
// two resources) can render the same visual without re-importing
// PageStateView for each branch.
export function FailureNotice({ title, body }: FailureNoticeProps): JSX.Element {
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
