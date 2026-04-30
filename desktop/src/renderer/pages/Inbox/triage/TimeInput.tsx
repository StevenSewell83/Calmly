interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
}

// datetime-local wrapper used for the event-branch start / end pair.
// Value strings are 'yyyy-MM-ddTHH:mm' in the user's local zone —
// helpers.parseLocalInputValue / toLocalInputValue convert to/from
// unix-ms before crossing the IPC.
export function TimeInput({ id, label, value, onChange }: Props): JSX.Element {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[10px] font-bold tracking-[0.22em] uppercase text-stone-500 mb-2"
      >
        {label}
      </label>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-stone-200 focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 outline-none rounded-2xl px-4 py-3 text-sm text-stone-800"
      />
    </div>
  );
}
