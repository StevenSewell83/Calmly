import { useEffect, useState } from "react";

// Tiny, self-contained version readout for the About/Account footer. Keeps
// its own loading state rather than pulling in useResource — there's no
// signed-out case (the version isn't user data) and nothing to refresh.
export function AppVersion() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.calmly.settings
      .getAppVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {
        // Non-critical: leave the placeholder rather than surface an error
        // for a purely informational readout.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <p className="mt-6 text-xs text-stone-400">
      Calmly {version ? `v${version}` : "…"}
    </p>
  );
}
