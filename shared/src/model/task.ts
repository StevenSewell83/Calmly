import { z } from "zod";
import { InboxSourceSchema, TaskStatusSchema, unixMs, uuid } from "./common";

export const TaskSchema = z
  .object({
    id: uuid,
    user_id: uuid,
    title: z.string().min(1),
    notes: z.string().nullable(),
    type: z.string().min(1),
    status: TaskStatusSchema,
    due_at: unixMs.nullable(),
    parent_task_id: uuid.nullable(),
    source: InboxSourceSchema,
    created_at: unixMs,
    updated_at: unixMs,
    // CL-06 placement on the Plan day grid. Both NULL = unplaced
    // (backlog); both non-NULL = a TimeBlock at [start, end]. The
    // client IPC enforces pair-semantics — server stores whatever
    // arrives.
    scheduled_start: unixMs.nullable(),
    scheduled_end: unixMs.nullable(),
  })
  .refine(
    (t) =>
      (t.scheduled_start === null && t.scheduled_end === null) ||
      (t.scheduled_start !== null &&
        t.scheduled_end !== null &&
        t.scheduled_end >= t.scheduled_start),
    {
      message:
        "scheduled_start and scheduled_end must be set together; end must be >= start",
      path: ["scheduled_end"],
    },
  );
export type Task = z.infer<typeof TaskSchema>;

// Wire-format variant: drops the refinement (not needed for parse-from-server)
// and adds the sync trio. updated_at already present in TaskSchema.
export const TaskRecordSchema = TaskSchema.innerType().extend({
  version: z.number().int().nonnegative(),
  deleted_at: unixMs.nullable(),
});
export type TaskRecord = z.infer<typeof TaskRecordSchema>;
