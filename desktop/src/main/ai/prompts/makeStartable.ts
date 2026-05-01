import { SYSTEM_PREAMBLE } from "./system";
import { z } from "zod";

export const MakeStartableInputSchema = z.object({
  title: z.string(),
  notes: z.string().optional(),
});

export const MakeStartableOutputSchema = z.object({
  firstStep: z.string(),
  steps: z.array(z.string()).max(5),
});

export type MakeStartableInput = z.infer<typeof MakeStartableInputSchema>;
export type MakeStartableOutput = z.infer<typeof MakeStartableOutputSchema>;

export function buildMakeStartablePrompts(input: MakeStartableInput): {
  system: string;
  user: string;
} {
  return {
    system: `${SYSTEM_PREAMBLE}

Respond with JSON: { "firstStep": string, "steps": string[] }
- firstStep: the single next physical action (max 60 chars, starts with a verb)
- steps: up to 5 sequential steps to complete the full task (each max 60 chars)
Keep steps concrete and immediately actionable. No motivational filler.`,
    user: `Break this task into concrete, immediately actionable steps:

Title: ${input.title}${input.notes ? `\nNotes: ${input.notes}` : ""}`,
  };
}
