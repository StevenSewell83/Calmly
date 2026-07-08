import { SYSTEM_PREAMBLE } from "./system";
import { z } from "zod";

export const BrainDumpSplitInputSchema = z.object({
  text: z.string(),
});

export const BrainDumpSplitOutputSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string(),
        notes: z.string().optional(),
      }),
    )
    .max(20),
});

export type BrainDumpSplitInput = z.infer<typeof BrainDumpSplitInputSchema>;
export type BrainDumpSplitOutput = z.infer<typeof BrainDumpSplitOutputSchema>;

export function buildBrainDumpSplitPrompts(input: BrainDumpSplitInput): {
  system: string;
  user: string;
} {
  return {
    system: `${SYSTEM_PREAMBLE}

Respond with JSON: { "tasks": [{ "title": string, "notes"?: string }] }
- Split the brain dump into individual, discrete tasks (max 20 tasks)
- Each title should be clear and action-oriented (max 80 chars)
- notes: any clarifying detail from the original text (optional)
- Do not invent tasks not implied by the input
- Merge clearly duplicate items`,
    user: `Split this brain dump into individual tasks:

${input.text}`,
  };
}
