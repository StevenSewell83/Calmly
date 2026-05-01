import { SYSTEM_PREAMBLE } from "./system";
import { z } from "zod";

export const TriageCleanupInputSchema = z.object({
  rawText: z.string(),
});

export const TriageCleanupOutputSchema = z.object({
  type: z.enum(["task", "event", "someday"]),
  title: z.string(),
  dueDate: z.string().optional(),
  nextAction: z.string().optional(),
});

export type TriageCleanupInput = z.infer<typeof TriageCleanupInputSchema>;
export type TriageCleanupOutput = z.infer<typeof TriageCleanupOutputSchema>;

export function buildTriageCleanupPrompts(input: TriageCleanupInput): {
  system: string;
  user: string;
} {
  return {
    system: `${SYSTEM_PREAMBLE}

Respond with JSON: { "type": "task"|"event"|"someday", "title": string, "dueDate"?: string, "nextAction"?: string }
- type: "task" for actionable to-dos, "event" for scheduled calendar items, "someday" for vague future ideas
- title: clean, action-oriented (max 80 chars)
- dueDate: human-readable date string if implied (e.g. "Tomorrow", "Friday", "May 5"), omit if unclear
- nextAction: single concrete physical next step (max 60 chars, starts with verb), omit for events
No extra commentary. JSON only.`,
    user: `Classify and clean up this inbox item:

"${input.rawText}"`,
  };
}
