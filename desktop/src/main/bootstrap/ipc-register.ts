import type { AuthOrchestrator } from "../auth/session";
import type { SyncLoop } from "../sync/loop";
import type { Logger, CalendarConnectResult } from "@calmly/shared";
import { registerAuthIpc } from "../ipc/auth";
import { registerCalendarIpc } from "../ipc/calendar";
import { registerDbIpc } from "../ipc/db";
import { registerInboxIpc } from "../ipc/inbox";
import { registerLogIpc } from "../ipc/log";
import { registerSecretsIpc } from "../ipc/secrets";
import { registerFocusIpc } from "../ipc/focus";
import { registerPlanIpc } from "../ipc/plan";
import { registerQuickPlanIpc } from "../ipc/quickplan";
import { registerReplanIpc } from "../ipc/replan";
import { registerReviewIpc } from "../ipc/review";
import { registerSyncIpc } from "../ipc/sync";
import { registerTodayIpc } from "../ipc/today";
import { registerTriageIpc } from "../ipc/triage";
import { registerSettingsIpc } from "../ipc/settings";
import { registerSearchIpc } from "../ipc/search";

export interface RegisterAllIpcDeps {
  connectGoogle: () => Promise<CalendarConnectResult>;
  connectMicrosoft: () => Promise<CalendarConnectResult>;
}

export function registerAllIpc(
  orchestrator: AuthOrchestrator,
  syncLoop: SyncLoop,
  logger: Logger,
  deps: RegisterAllIpcDeps,
): void {
  registerDbIpc();
  registerSecretsIpc();
  registerLogIpc(logger);
  registerAuthIpc(orchestrator);
  registerInboxIpc();
  registerTodayIpc();
  registerTriageIpc();
  registerPlanIpc();
  registerQuickPlanIpc();
  registerReplanIpc();
  registerReviewIpc();
  registerFocusIpc();
  registerSyncIpc(syncLoop);
  registerSettingsIpc();
  registerSearchIpc();
  registerCalendarIpc({
    connectGoogle: deps.connectGoogle,
    connectMicrosoft: deps.connectMicrosoft,
  });
}
