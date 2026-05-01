import { NavLink, Outlet } from "react-router-dom";

interface Sub {
  to: string;
  label: string;
}

const SUB_NAV: Sub[] = [
  { to: "/settings/account", label: "Account" },
  { to: "/settings/reminders", label: "Reminders" },
  { to: "/settings/calendar", label: "Calendar" },
  { to: "/settings/telegram", label: "Telegram" },
  { to: "/settings/ai", label: "AI" },
  { to: "/settings/appearance", label: "Appearance" },
  { to: "/settings/shortcuts", label: "Shortcuts" },
  { to: "/settings/privacy", label: "Privacy" },
  { to: "/settings/data", label: "Data" },
];

export function SettingsLayout() {
  return (
    <div className="flex-1 flex min-h-0">
      <aside
        role="navigation"
        aria-label="Settings sections"
        className="w-60 shrink-0 border-r border-stone-200/60 bg-white/40 px-6 py-12"
      >
        <h2 className="font-serif italic text-2xl text-stone-800 mb-8 px-3">
          Settings
        </h2>
        <nav className="flex flex-col gap-1">
          {SUB_NAV.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              className={({ isActive }) =>
                [
                  "px-4 py-2 rounded-xl text-sm transition-colors",
                  isActive
                    ? "bg-emerald-50 text-emerald-700 font-medium"
                    : "text-stone-500 hover:bg-stone-100/60 hover:text-stone-800",
                ].join(" ")
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
