import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  CheckCircle2,
  Inbox,
  LayoutGrid,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";
import { CaptureBar } from "../components/CaptureBar";
import { MountainClimberIcon } from "../components/MountainClimberIcon";
import { SearchOverlay } from "../components/SearchOverlay";
import { useActiveFocusSession } from "../hooks/useActiveFocusSession";
import { useShortcuts } from "../hooks/useShortcuts";
import { useUpdateStatus } from "../hooks/useUpdateStatus";
import { META_SYMBOL } from "../utils/platform";

interface NavSpec {
  to: string;
  label: string;
  hint: string;
  icon: typeof Inbox;
}

const TOP_NAV: NavSpec[] = [
  { to: "/", label: "Home", hint: "1", icon: Sparkles },
  { to: "/inbox", label: "Inbox", hint: "2", icon: Inbox },
  { to: "/plan", label: "Plan", hint: "3", icon: CalendarDays },
  { to: "/focus", label: "Focus", hint: "4", icon: LayoutGrid },
  { to: "/review", label: "Review", hint: "5", icon: CheckCircle2 },
];

const SETTINGS_ITEM: NavSpec = {
  to: "/settings/account",
  label: "Settings",
  hint: "6",
  icon: SettingsIcon,
};

interface SidebarItemProps {
  spec: NavSpec;
  active: boolean;
  showReadyBadge?: boolean;
}

function SidebarItem({ spec, active, showReadyBadge }: SidebarItemProps) {
  const Icon = spec.icon;
  return (
    <NavLink
      to={spec.to}
      end={spec.to === "/"}
      aria-current={active ? "page" : undefined}
      className={[
        "flex items-center gap-4 px-4 py-3 rounded-2xl transition-colors",
        active
          ? "bg-emerald-50 text-emerald-700"
          : "text-stone-500 hover:bg-stone-100/60 hover:text-stone-800",
      ].join(" ")}
    >
      <Icon
        className={`w-5 h-5 ${active ? "text-emerald-500" : "text-stone-400"}`}
      />
      <span className="text-sm font-medium tracking-wide flex-1">
        {spec.label}
      </span>
      {showReadyBadge && (
        <span
          aria-label="Update ready"
          title="An update is ready to install"
          className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"
        />
      )}
      <span
        className={[
          "text-[10px] font-bold tracking-widest uppercase rounded-md px-2 py-0.5 border",
          active
            ? "border-emerald-200 text-emerald-600 bg-emerald-50"
            : "border-stone-200 text-stone-400 bg-white/40",
        ].join(" ")}
      >
        {META_SYMBOL}{spec.hint}
      </span>
    </NavLink>
  );
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const updateStatus = useUpdateStatus();
  const focusSessionActive = useActiveFocusSession(location.pathname);
  // Anti-nag: the ready pill never renders over an active Focus session.
  const showUpdateReadyBadge = updateStatus.state === "ready" && !focusSessionActive;

  useShortcuts({
    openSearch: () => setSearchOpen(true),
    closeOverlay: () => setSearchOpen(false),
  });

  // TGR-10: clicking a desktop notification sends this once main has
  // already focused the window (see main/reminders/notifier.ts) — routing
  // to Home with the task id is the same "land on the landscape, then find
  // the task" flow the rest of the app uses; a dedicated task-detail route
  // is out of this bead's scope.
  useEffect(() => {
    return window.calmly.reminders.onOpenTask(({ taskId }) => {
      navigate(`/?openTask=${encodeURIComponent(taskId)}`);
    });
  }, [navigate]);

  const isActive = (to: string): boolean => {
    if (to === "/") return location.pathname === "/";
    return location.pathname.startsWith(to);
  };

  return (
    <div className="flex min-h-screen bg-[#F9F7F2] text-stone-800 font-sans selection:bg-emerald-100">
      <aside
        role="navigation"
        aria-label="Primary"
        className="w-72 shrink-0 border-r border-stone-200/60 bg-white/60 backdrop-blur-md flex flex-col p-8"
      >
        <div className="flex items-center gap-4 mb-12">
          <div className="w-14 h-14 bg-stone-900 rounded-[1.6rem] flex items-center justify-center shadow-lg shrink-0">
            <MountainClimberIcon className="w-9 h-9 text-white" />
          </div>
          <span className="font-serif italic text-2xl tracking-tight text-stone-800">
            Calmly
          </span>
        </div>

        <nav className="flex flex-col gap-1.5">
          {TOP_NAV.map((spec) => (
            <SidebarItem key={spec.to} spec={spec} active={isActive(spec.to)} />
          ))}
        </nav>

        <div className="mt-auto pt-6 border-t border-stone-200/60">
          <SidebarItem
            spec={SETTINGS_ITEM}
            active={location.pathname.startsWith("/settings")}
            showReadyBadge={showUpdateReadyBadge}
          />
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="mt-3 w-full flex items-center gap-3 px-4 py-2.5 rounded-2xl text-stone-400 hover:text-stone-700 hover:bg-stone-100/60 transition-colors"
          >
            <span className="text-sm font-medium tracking-wide flex-1 text-left">
              Search
            </span>
            <span className="text-[10px] font-bold tracking-widest uppercase rounded-md px-2 py-0.5 border border-stone-200 text-stone-400 bg-white/40">
              {META_SYMBOL}K
            </span>
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <CaptureBar />
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          <Outlet />
        </div>
      </main>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
