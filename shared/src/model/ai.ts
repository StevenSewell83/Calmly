import { z } from "zod";
import {
  AiOutcomeSchema,
  AiSuggestionOwnerTypeSchema,
  JsonStringSchema,
  unixMs,
  uuid,
} from "./common";

export const AiSuggestionSchema = z.object({
  id: uuid,
  owner_type: AiSuggestionOwnerTypeSchema,
  owner_id: uuid,
  model: z.string().min(1),
  prompt_class: z.string().min(1),
  suggestion_json: JsonStringSchema,
  outcome: AiOutcomeSchema,
  created_at: unixMs,
});
export type AiSuggestion = z.infer<typeof AiSuggestionSchema>;

export const AiSuggestionRecordSchema = AiSuggestionSchema.extend({
  version: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
  deleted_at: z.number().int().nonnegative().nullable(),
});
export type AiSuggestionRecord = z.infer<typeof AiSuggestionRecordSchema>;
