import { z } from "zod";
import { InboxSourceSchema, TaskStatusSchema, unixMs, uuid } from "./common";

export const TaskSchema = z.object({
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
});
export type Task = z.infer<typeof TaskSchema>;
