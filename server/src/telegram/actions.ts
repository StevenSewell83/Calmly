// TGR-03 — registry mapping an outbound-message button's actionId to the
// handler that runs when a user presses it. Callback dispatch (callback.ts)
// looks handlers up here; TGR-11 registers the real Done/Snooze/Reschedule
// handlers, this bead just builds the plumbing (and is exercised by tests
// with throwaway actionIds).
//
// Plain in-memory Map, not a class — there is exactly one process-wide
// registry, same shape as bot.ts's module-level singleton.

export interface ActionContext {
  userId: string;
  chatId: string;
  outboundMessageId: string;
  actionId: string;
  /** The payload stored alongside this button when the message was sent/edited. */
  payload: unknown;
  callbackQueryId: string;
}

/** Optional text shown to the user via answerCallbackQuery (toast). */
export interface ActionResult {
  answerText?: string;
  showAlert?: boolean;
}

export type ActionHandler = (
  ctx: ActionContext,
) => Promise<ActionResult | void> | ActionResult | void;

const registry = new Map<string, ActionHandler>();

export function registerAction(actionId: string, handler: ActionHandler): void {
  registry.set(actionId, handler);
}

export function getAction(actionId: string): ActionHandler | undefined {
  return registry.get(actionId);
}

export function unregisterAction(actionId: string): void {
  registry.delete(actionId);
}

// Test-only escape hatch so specs don't leak registrations across files —
// mirrors the __INTERNAL export pattern in linking.ts.
export const __INTERNAL = {
  clear(): void {
    registry.clear();
  },
};
