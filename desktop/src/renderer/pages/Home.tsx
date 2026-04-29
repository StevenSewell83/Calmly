import { useEffect, useState } from "react";

interface DbHealth {
  ok: boolean;
  version: number;
  walMode: string;
  fts5: boolean;
}

export function Home() {
  const [health, setHealth] = useState<DbHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.calmly.db
      .health()
      .then((h) => {
        if (!cancelled) setHealth(h);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-stone-50 text-stone-800 flex flex-col items-center justify-center px-6">
      <h1 className="font-serif italic text-5xl tracking-tight text-stone-800">
        Peace, friend.
      </h1>
      <p className="mt-4 text-sm text-stone-500 tracking-wide">
        Calmly is waking up.
      </p>
      <span className="mt-12 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium tracking-wider">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        shell ready
      </span>
      <span
        className={`mt-3 inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium tracking-wider ${
          error
            ? "bg-rose-50 text-rose-700"
            : health
              ? "bg-stone-100 text-stone-600"
              : "bg-stone-50 text-stone-400"
        }`}
      >
        {error ? (
          <>db error · {error}</>
        ) : health ? (
          <>
            db v{health.version} · {health.walMode} ·{" "}
            {health.fts5 ? "fts5 ✓" : "fts5 ✗"}
          </>
        ) : (
          <>db…</>
        )}
      </span>
    </main>
  );
}
