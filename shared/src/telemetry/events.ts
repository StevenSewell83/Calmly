// POL-01: Telemetry event schema and allow-list.
//
// Only events and prop keys in the allow-list are accepted. No free text,
// no titles, no message bodies, no emails, no API keys. The anonymous_id
// is a stable per-device UUID that is never correlated with the user account.
import { z } from "zod";

export const TELEMETRY_EVENT_NAMES = [
  "app.opened",
  "capture.created",
  "triage.completed",
  "ai.suggestion.accepted",
  "ai.suggestion.rejected",
  "ai.suggestion.edited",
  "error.shown",
] as const;

export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number];

// Prop values: only booleans, integers, and short enum strings (no free text).
const TelemetryPropValueSchema = z.union([
  z.boolean(),
  z.number().int(),
  z.string().max(64).regex(/^[a-zA-Z0-9._:-]+$/),
]);

// Prop keys that are always denied regardless of position.
const DENIED_PROP_SUBSTRINGS = [
  "title",
  "body",
  "message",
  "text",
  "content",
  "email",
  "name",
  "subject",
  "key",
  "token",
  "secret",
];

function isDeniedPropKey(key: string): boolean {
  const lower = key.toLowerCase();
  return DENIED_PROP_SUBSTRINGS.some((d) => lower.includes(d));
}

const AllowListedPropsSchema = z
  .record(TelemetryPropValueSchema)
  .superRefine((props: Record<string, unknown>, ctx: z.RefinementCtx) => {
    for (const key of Object.keys(props)) {
      if (isDeniedPropKey(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Telemetry prop '${key}' is not allow-listed`,
          path: [key],
        });
      }
    }
  });

export const TelemetryEventSchema = z.object({
  event: z.enum(TELEMETRY_EVENT_NAMES),
  anonymous_id: z.string().uuid(),
  session_id: z.string().uuid(),
  timestamp: z.number().int().positive(),
  props: AllowListedPropsSchema.optional(),
});

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

export const TelemetryBatchSchema = z.object({
  events: z.array(TelemetryEventSchema).min(1).max(100),
});

export type TelemetryBatch = z.infer<typeof TelemetryBatchSchema>;
