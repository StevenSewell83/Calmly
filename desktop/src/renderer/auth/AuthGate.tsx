import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { CalmLoader } from "../pages/auth/CalmLoader";
import { SignIn } from "../pages/auth/SignIn";

interface Props {
  children: ReactNode;
}

// Gates the entire routed tree on auth state. Sits above <RouterProvider/> so
// the hash-router preserves the user's last route across refreshes — when the
// user signs in, the existing hash takes effect without a manual redirect.
export function AuthGate({ children }: Props) {
  const { state } = useAuth();

  if (state.status === "unknown") return <CalmLoader />;
  if (state.status === "signed_out") return <SignIn />;
  return <>{children}</>;
}
