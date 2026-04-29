import { createContext, useContext } from "react";
import type { RequestLinkResult } from "../../preload/api-types";
import type { AuthState } from "./state";

export interface AuthContextValue {
  state: AuthState;
  // Send a magic link. The result is returned to the caller so SignIn can
  // render the right error / confirmation. We intentionally do NOT mutate
  // state on requestLink — sign-in is completed by the deep-link push, not
  // by this call.
  requestLink: (email: string) => Promise<RequestLinkResult>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider/>");
  return ctx;
}
