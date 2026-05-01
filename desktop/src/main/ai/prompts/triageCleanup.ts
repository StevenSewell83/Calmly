import { SYSTEM_PREAMBLE } from "./system";
import { z } from "zod";

export const TriageCleanupInputSchema = z.object({
  title: z.string(),
  notes: z.string().optional(),
});

export const TriageCleanupOutputSchema = z.object({
  title: z.string(),
  notes: z.string().optional(),
});

export type TriageCleanupInput = z.infer<typeof TriageCleanupInputSchema>;
export type TriageCleanupOutput = z.infer<typeof TriageCleanupOutputSchema>;

export function buildTriageCleanupPrompts(input: TriageCleanupInput): {
  system: string;
  user: string;
} {
  return {
    system: `${SYSTEM_PREAMBLE}

Respond with JSON: { "title": string, "notes"?: string }
- title: clean, action-oriented task title (max 80 chars)
- notes: clarifying context if useful (optional)
Do not add tasks that weren't implied. Do not be preachy.`,
    user: `Clean up this task title so it's clear and actionable:

Title: ${input.title}${input.notes ? `\nNotes: ${input.notes}` : ""}`,
  };
}
