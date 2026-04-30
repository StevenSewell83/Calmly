// CL-13 Daily Shutdown — public surface. The implementation is split
// across summary.ts (read path), tasks.ts (bulk task mutations),
// reflection.ts (reflection upsert), and shutdown.ts (completeShutdown
// + last_shutdown_date). Importers should use this barrel rather than
// the per-feature files so the carve-up can evolve without churn.

export {
  localDateString,
  summarize,
  type ReviewReflection,
  type ReviewSummary,
  type ReviewTaskRow,
} from "./summary";
export {
  carryForward,
  dropTasks,
  markTasksDone,
  moveToDate,
  type BulkResult,
} from "./tasks";
export {
  saveReflection,
  type SaveReflectionResult,
} from "./reflection";
export {
  completeShutdown,
  type CompleteShutdownResult,
} from "./shutdown";
