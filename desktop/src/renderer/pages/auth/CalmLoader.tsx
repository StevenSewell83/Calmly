import { MountainClimberIcon } from "../../components/MountainClimberIcon";

// Boot-time loader. Status query against the cookie jar typically resolves in
// <100 ms, so this rarely flashes — keep it muted on purpose so a brief
// appearance is forgiving.
export function CalmLoader() {
  return (
    <div className="min-h-screen bg-[#F9F7F2] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 opacity-70">
        <div className="w-12 h-12 bg-stone-900 rounded-[1.4rem] flex items-center justify-center shadow-md">
          <MountainClimberIcon className="w-7 h-7 text-white" />
        </div>
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400">
          Calmly
        </span>
      </div>
    </div>
  );
}
