/* CL-13: daily reflections — server mirror of desktop migration 0009.
 *
 * Same shape as the SQLite side: id (TEXT uuid PK) + user_id +
 * date (YYYY-MM-DD string) + text + created_at + the standard sync
 * trio (version / updated_at / deleted_at). UNIQUE (user_id, date)
 * enforces the one-reflection-per-day invariant; the client looks
 * up the existing row by (user_id, date) and reuses its id rather
 * than relying on the unique index to surface conflicts.
 */

exports.up = (pgm) => {
  pgm.createTable("daily_reflections", {
    id: { type: "text", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    date: { type: "text", notNull: true },
    text: { type: "text", notNull: true },
    created_at: { type: "bigint", notNull: true },
    version: { type: "bigint", notNull: true, unique: true },
    updated_at: { type: "bigint", notNull: true },
    deleted_at: { type: "bigint" },
  });
  pgm.addConstraint("daily_reflections", "daily_reflections_user_date_uniq", {
    unique: ["user_id", "date"],
  });
  pgm.createIndex("daily_reflections", ["user_id", "version"]);
};

exports.down = (pgm) => {
  pgm.dropTable("daily_reflections");
};
