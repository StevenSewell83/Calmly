/* F-11 sync protocol v1.
 *
 * Conventions:
 *   - Sync columns: version BIGINT UNIQUE NOT NULL (monotonic from sync_version
 *     SEQUENCE), updated_at BIGINT NOT NULL (unix ms), deleted_at BIGINT NULL.
 *   - Domain ids are TEXT UUIDs the client minted (matches desktop convention)
 *     so a record's id is stable across replicas.
 *   - All user-owned children FK to users(id) ON DELETE CASCADE so account
 *     deletion is a single statement.
 *   - JSON columns use JSONB so we can index/inspect them server-side.
 */

exports.up = (pgm) => {
  pgm.createSequence("sync_version", { start: 1, increment: 1 });

  const sync = {
    version: { type: "bigint", notNull: true, unique: true },
    updated_at: { type: "bigint", notNull: true },
    deleted_at: { type: "bigint" },
  };

  pgm.createTable("inbox_items", {
    id: { type: "text", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    raw_text: { type: "text", notNull: true },
    source: { type: "text", notNull: true },
    created_at: { type: "bigint", notNull: true },
    resolved_at: { type: "bigint" },
    ...sync,
  });
  pgm.addConstraint("inbox_items", "inbox_items_source_check", {
    check: "source IN ('desktop','telegram-text','telegram-voice','ai-split')",
  });
  pgm.createIndex("inbox_items", ["user_id", "version"]);

  pgm.createTable("tasks", {
    id: { type: "text", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    title: { type: "text", notNull: true },
    notes: { type: "text" },
    type: { type: "text", notNull: true, default: "task" },
    status: { type: "text", notNull: true, default: "open" },
    due_at: { type: "bigint" },
    parent_task_id: { type: "text" },
    source: { type: "text", notNull: true },
    created_at: { type: "bigint", notNull: true },
    ...sync,
  });
  pgm.addConstraint("tasks", "tasks_status_check", {
    check: "status IN ('open','in_progress','done','dropped','snoozed')",
  });
  pgm.addConstraint("tasks", "tasks_source_check", {
    check: "source IN ('desktop','telegram-text','telegram-voice','ai-split')",
  });
  pgm.createIndex("tasks", ["user_id", "version"]);
  pgm.createIndex("tasks", ["user_id", "status"]);

  pgm.createTable("events", {
    id: { type: "text", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    title: { type: "text", notNull: true },
    start_at: { type: "bigint", notNull: true },
    end_at: { type: "bigint", notNull: true },
    source: { type: "text", notNull: true },
    created_at: { type: "bigint", notNull: true },
    ...sync,
  });
  pgm.addConstraint("events", "events_source_check", {
    check: "source IN ('manual','calendar-import')",
  });
  pgm.createIndex("events", ["user_id", "version"]);
  pgm.createIndex("events", ["user_id", "start_at"]);

  pgm.createTable("reminder_rules", {
    id: { type: "text", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    task_id: { type: "text", notNull: true },
    importance: { type: "text", notNull: true },
    interval_seconds: { type: "integer", notNull: true },
    escalation_json: { type: "jsonb", notNull: true },
    active: { type: "smallint", notNull: true, default: 1 },
    ...sync,
  });
  pgm.addConstraint("reminder_rules", "reminder_rules_importance_check", {
    check: "importance IN ('important','soft')",
  });
  pgm.addConstraint("reminder_rules", "reminder_rules_active_check", {
    check: "active IN (0,1)",
  });
  pgm.createIndex("reminder_rules", ["user_id", "version"]);

  pgm.createTable("recurrence_rules", {
    id: { type: "text", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    owner_type: { type: "text", notNull: true },
    owner_id: { type: "text", notNull: true },
    rrule_text: { type: "text", notNull: true },
    ...sync,
  });
  pgm.addConstraint("recurrence_rules", "recurrence_rules_owner_type_check", {
    check: "owner_type IN ('task','reminder')",
  });
  pgm.createIndex("recurrence_rules", ["user_id", "version"]);

  pgm.createTable("calendar_event_imports", {
    id: { type: "text", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    provider: { type: "text", notNull: true },
    external_id: { type: "text", notNull: true },
    raw_json: { type: "jsonb", notNull: true },
    start_at: { type: "bigint", notNull: true },
    end_at: { type: "bigint", notNull: true },
    last_seen_at: { type: "bigint", notNull: true },
    ...sync,
  });
  pgm.addConstraint(
    "calendar_event_imports",
    "calendar_event_imports_provider_check",
    { check: "provider IN ('google','microsoft')" },
  );
  pgm.addConstraint(
    "calendar_event_imports",
    "calendar_event_imports_unique_external",
    { unique: ["user_id", "provider", "external_id"] },
  );
  pgm.createIndex("calendar_event_imports", ["user_id", "version"]);

  pgm.createTable("ai_suggestions", {
    id: { type: "text", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    owner_type: { type: "text", notNull: true },
    owner_id: { type: "text", notNull: true },
    model: { type: "text", notNull: true },
    prompt_class: { type: "text", notNull: true },
    suggestion_json: { type: "jsonb", notNull: true },
    outcome: { type: "text", notNull: true, default: "pending" },
    created_at: { type: "bigint", notNull: true },
    ...sync,
  });
  pgm.addConstraint("ai_suggestions", "ai_suggestions_owner_type_check", {
    check: "owner_type IN ('inbox_item','task','event')",
  });
  pgm.addConstraint("ai_suggestions", "ai_suggestions_outcome_check", {
    check: "outcome IN ('accepted','rejected','edited','pending')",
  });
  pgm.createIndex("ai_suggestions", ["user_id", "version"]);

  pgm.createTable("telegram_links", {
    id: { type: "text", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    chat_id: { type: "text", notNull: true, unique: true },
    linked_at: { type: "bigint", notNull: true },
    ...sync,
  });
  pgm.createIndex("telegram_links", ["user_id", "version"]);

  pgm.createTable("user_settings", {
    user_id: {
      type: "uuid",
      primaryKey: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    settings_json: { type: "jsonb", notNull: true },
    ...sync,
  });
  pgm.createIndex("user_settings", "version");
};

exports.down = (pgm) => {
  pgm.dropTable("user_settings");
  pgm.dropTable("telegram_links");
  pgm.dropTable("ai_suggestions");
  pgm.dropTable("calendar_event_imports");
  pgm.dropTable("recurrence_rules");
  pgm.dropTable("reminder_rules");
  pgm.dropTable("events");
  pgm.dropTable("tasks");
  pgm.dropTable("inbox_items");
  pgm.dropSequence("sync_version");
};
