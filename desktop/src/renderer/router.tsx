import { createHashRouter, Navigate, type RouteObject } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { Home } from "./pages/Home/Home";
import { Inbox } from "./pages/Inbox";
import { Plan } from "./pages/Plan";
import { Focus } from "./pages/Focus";
import { Review } from "./pages/Review";
import { SettingsLayout } from "./pages/Settings/Layout";
import { SettingsAccount } from "./pages/Settings/Account";
import { SettingsReminders } from "./pages/Settings/Reminders";
import { SettingsCalendar } from "./pages/Settings/Calendar";
import { SettingsTelegram } from "./pages/Settings/Telegram";
import { SettingsAi } from "./pages/Settings/Ai";
import { SettingsAppearance } from "./pages/Settings/Appearance";
import { SettingsShortcuts } from "./pages/Settings/Shortcuts";
import { SettingsData } from "./pages/Settings/Data";

const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Home /> },
      { path: "inbox", element: <Inbox /> },
      { path: "plan", element: <Plan /> },
      { path: "focus", element: <Focus /> },
      { path: "review", element: <Review /> },
      {
        path: "settings",
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="account" replace /> },
          { path: "account", element: <SettingsAccount /> },
          { path: "reminders", element: <SettingsReminders /> },
          { path: "calendar", element: <SettingsCalendar /> },
          { path: "telegram", element: <SettingsTelegram /> },
          { path: "ai", element: <SettingsAi /> },
          { path: "appearance", element: <SettingsAppearance /> },
          { path: "shortcuts", element: <SettingsShortcuts /> },
          { path: "data", element: <SettingsData /> },
        ],
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];

export const router: ReturnType<typeof createHashRouter> =
  createHashRouter(routes);
