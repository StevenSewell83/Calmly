export function Home() {
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
    </main>
  );
}
