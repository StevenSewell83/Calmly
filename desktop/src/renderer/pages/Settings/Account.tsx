import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";

export function SettingsAccount() {
  const { state, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (state.status !== "signed_in") {
    // AuthGate normally prevents settings rendering when not signed in, but
    // guard anyway so a future routing change can't crash the page.
    return null;
  }

  async function onSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <section className="flex-1 flex flex-col px-12 py-16 max-w-2xl">
      <h1 className="font-serif italic text-4xl tracking-tight text-stone-800">
        Account
      </h1>

      <div className="mt-10 bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm">
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400">
          Signed in as
        </span>
        <p className="mt-2 text-lg text-stone-800 font-medium">
          {state.user.email}
        </p>
        <p className="mt-1 text-xs text-stone-400">
          Sessions last about 30 days. We'll prompt you to sign in again if it
          expires.
        </p>
      </div>

      <div className="mt-8">
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className={[
            "px-5 py-2.5 rounded-2xl text-sm font-medium tracking-wide transition-colors",
            signingOut
              ? "bg-stone-100 text-stone-400 cursor-not-allowed"
              : "bg-stone-900 text-white hover:bg-stone-800",
          ].join(" ")}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </section>
  );
}
