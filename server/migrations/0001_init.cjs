/* eslint-disable @typescript-eslint/no-unused-vars */
// F-07 placeholder server-side migration. Real schema lands in F-08+.
// node-pg-migrate runs this inside a transaction; we just tag the migration as
// applied so the runner is wired and downstream migrations stack on top.
//
// LOAD-BEARING NO-OP: do not remove or replace this migration. node-pg-migrate
// records it as applied; removing it would shift subsequent migration numbers
// and corrupt existing databases.

exports.up = (pgm) => {
  pgm.sql("SELECT 1;");
};

exports.down = (pgm) => {};
