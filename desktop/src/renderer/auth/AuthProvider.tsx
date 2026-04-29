import { useCallback, useEffect, useReducer, type ReactNode } from "react";
import type { RedeemResult } from "../../preload/api-types";
import { AuthContext } from "./AuthContext";
import { authReducer, initialAuthState } from "./state";

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);

  // Boot: query main for current session status. The cookie jar persists
  // across launches so this commonly resolves directly to signed_in.
  useEffect(() => {
    let cancelled = false;
    void window.calmly.auth.status().then((result) => {
      if (cancelled) return;
      dispatch({ type: "status_resolved", result });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to deep-link redeem pushes from main. The handler may run
  // before or after the boot status() resolves; the reducer handles both.
  useEffect(() => {
    const off = window.calmly.auth.onDeepLinkRedeemed(
      (result: RedeemResult) => {
        dispatch({ type: "deeplink_redeem", result });
      },
    );
    return off;
  }, []);

  const requestLink = useCallback(
    (email: string) => window.calmly.auth.requestLink(email),
    [],
  );

  const signOut = useCallback(async () => {
    await window.calmly.auth.signOut();
    dispatch({ type: "manual_sign_out" });
  }, []);

  return (
    <AuthContext.Provider value={{ state, requestLink, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
