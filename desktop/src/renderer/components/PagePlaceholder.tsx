interface Props {
  title: string;
  subtitle?: string;
  todo?: string;
}

export function PagePlaceholder({ title, subtitle, todo }: Props) {
  return (
    <section className="flex-1 flex flex-col items-center justify-center px-12 py-16">
      <h1 className="font-serif italic text-5xl tracking-tight text-stone-800">
        {title}
      </h1>
      {subtitle ? (
        <p className="mt-4 text-sm text-stone-500 tracking-wide max-w-md text-center">
          {subtitle}
        </p>
      ) : null}
      <span className="mt-12 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-stone-100 text-stone-500 text-[10px] font-bold tracking-[0.2em] uppercase border border-stone-200">
        TODO
        {todo ? (
          <span className="font-normal normal-case tracking-normal text-stone-400 lowercase">
            — {todo}
          </span>
        ) : null}
      </span>
    </section>
  );
}
