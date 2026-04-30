/* CL-06: time-block placement on tasks.
 *
 * Mirrors desktop migration 0007 — scheduled_start and scheduled_end
 * are unix-ms BIGINTs, both nullable. Both NULL means the task is on
 * the Plan backlog; both non-NULL means it's a placed TimeBlock. The
 * client IPC enforces the pair semantics; the server simply replicates
 * the columns.
 */

exports.up = (pgm) => {
  pgm.addColumns("tasks", {
    scheduled_start: { type: "bigint" },
    scheduled_end: { type: "bigint" },
  });
  pgm.createIndex("tasks", ["user_id", "scheduled_start"], {
    name: "tasks_scheduled_idx",
    where: "scheduled_start IS NOT NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("tasks", ["user_id", "scheduled_start"], {
    name: "tasks_scheduled_idx",
  });
  pgm.dropColumns("tasks", ["scheduled_start", "scheduled_end"]);
};
