import type {
  AuthUser,
  RedeemResult,
  StatusResult,
} from "../../preload/api-types";

// The renderer never calls /auth/magic-link/redeem directly — that happens in
// the main process when the OS delivers a calmly:// deep link, and the result
// is pushed back via window.calmly.auth.onDeepLinkRedeemed. So the renderer's
// only inputs are: (a) boot status query, (b) deep-link push, (c) explicit
// sign-out from the user.

export type AuthBanner =
  | {
      kind: "redeem-failed";
      reason: "invalid_or_expired" | "invalid_request" | "network" | "server";
    }
  | { kind: "signed-out" };

export type AuthState =
  | { status: "unknown" }
  | { status: "signed_out"; banner?: AuthBanner }
  | { status: "signed_in"; user: AuthUser };

export type AuthAction =
  | { type: "status_resolved"; result: StatusResult }
  | { type: "deeplink_redeem"; result: RedeemResult }
  | { type: "manual_sign_out" };

export const initialAuthState: AuthState = { status: "unknown" };

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "status_resolved":
      // Boot path. Only allowed to move OUT of 'unknown'; ignored if a deep
      // link already redeemed in parallel and put us in signed_in.
      if (state.status !== "unknown") return state;
      if (action.result.signedIn) {
        return { status: "signed_in", user: action.result.user };
      }
      return { status: "signed_out" };

    case "deeplink_redeem":
      if (action.result.ok) {
        return { status: "signed_in", user: action.result.user };
      }
      return {
        status: "signed_out",
        banner: { kind: "redeem-failed", reason: action.result.error },
      };

    case "manual_sign_out":
      return { status: "signed_out", banner: { kind: "signed-out" } };
  }
}
