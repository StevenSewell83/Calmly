// TGR-06: pure view-state types + helpers for Settings/Telegram.tsx, split
// out to keep the component file under the repo's max-lines gate. No React
// here — just the state machine + copy so it's trivially unit-testable in
// isolation if that's ever needed.
import type {
  TelegramCreateCodeResult,
  TelegramLinkingStatusResult,
} from "../../../preload/api-types";

export type CodeState =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "active"; code: string; expiresAt: number; botUsername: string | null; copied: boolean }
  | { kind: "expired" }
  | { kind: "error"; message: string };

export type ViewState =
  | { kind: "loading" }
  | { kind: "unlinked"; code: CodeState }
  | {
      kind: "linked";
      chatId: string;
      linkedAt: number;
      confirming: boolean;
      unlinking: boolean;
      error: string | null;
    }
  | { kind: "error"; message: string };

export function statusErrorCopy(
  error: "NotSignedIn" | "NetworkError" | "InternalError",
): string {
  switch (error) {
    case "NotSignedIn":
      return "You're not signed in, so Calmly can't check your Telegram link. Sign in and try again — nothing was changed.";
    case "NetworkError":
      return "Couldn't reach Calmly's server to check your Telegram link. Check your connection and try again — nothing was changed.";
    default:
      return "Something went wrong checking your Telegram link. Try again — nothing was changed.";
  }
}

export function codeErrorCopy(
  result: Extract<TelegramCreateCodeResult, { ok: false }>,
): string {
  switch (result.error) {
    case "RateLimited":
      return "You've requested too many codes recently. Wait a few minutes and try again.";
    case "NotSignedIn":
      return "You're not signed in, so Calmly can't create a linking code. Sign in and try again.";
    case "NetworkError":
      return "Couldn't reach Calmly's server to create a code. Check your connection and try again.";
    default:
      return "Something went wrong creating a code. Try again.";
  }
}

export function formatLinkedAt(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function applyStatus(status: TelegramLinkingStatusResult): ViewState {
  if (!status.ok) return { kind: "error", message: statusErrorCopy(status.error) };
  if (status.linked) {
    return {
      kind: "linked",
      chatId: status.chatId,
      linkedAt: status.linkedAt,
      confirming: false,
      unlinking: false,
      error: null,
    };
  }
  return { kind: "unlinked", code: { kind: "idle" } };
}
