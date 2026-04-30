import { z } from "zod";
import { unixMs, uuid } from "./common";

// CL-09 focus session schema.
//
// LOCAL-ONLY: this schema does not participate in sync (see
// shared/src/sync/types.ts). No version / deleted_at fields — a
// focus session is per-device working state. Side effects from the
// session (e.g. task.status='done' when the user marks it done in
// focus mode) flow through the normal tasks-upsert sync path.

export const focusSources = ["scheduled", "ad-hoc"] as const;
export const FocusSourceSchema = z.enum(focusSources);
export type FocusSource = z.infer<typeof FocusSourceSchema>;

export const FocusSessionSchema = z
  .object({
    id: uuid,
    user_id: uuid,
    task_id: uuid,
    started_at: unixMs,
    ended_at: unixMs.nullable(),
    source: FocusSourceSchema,
  })
  .refine(
    (s) => s.ended_at === null || s.ended_at >= s.started_at,
    {
      message: "ended_at must be >= started_at when set",
      path: ["ended_at"],
    },
  );
export type FocusSession = z.infer<typeof FocusSessionSchema>;
