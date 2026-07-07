/* TGR-03: outbound_messages table.
 *
 * Substrate for server-initiated Telegram messages that carry inline
 * action buttons (reminders w/ Done/Snooze/Reschedule in TGR-09/11).
 * Persisted BEFORE the Telegram API call so a row id exists to embed in
 * callback_data (`<actionId>:<rowId>`, kept under Telegram's 64-byte
 * limit) — the actual button payload lives in `payload` jsonb, not on
 * the wire. Server-only state, like telegram_linking_codes: it never
 * needs to reach another device, so no sync trio (version/updated_at/
 * deleted_at) here.
 *
 * Columns:
 *   id                   Row id, embedded in callback_data.
 *   user_id              Owning user (FK to users; cascades on delete).
 *   chat_id              Resolved Telegram chat at send time.
 *   intent               Caller-supplied label for the message's purpose
 *                        (e.g. 'reminder') — free text, not enum-checked,
 *                        so new intents don't need a migration.
 *   payload              jsonb — `{ buttons: [{label, actionId, payload}] }`
 *                        as sent/last-edited; the callback handler looks
 *                        up the pressed button's payload here.
 *   telegram_message_id  Telegram's message id once sent; null until
 *                        the send attempt resolves (or if it never did).
 *   status               'sent' | 'blocked' | 'failed'. Row is inserted
 *                        optimistically as 'sent' (it's about to be) and
 *                        downgraded if the API call reveals otherwise —
 *                        there's no 'pending' because the insert and the
 *                        send happen in the same request, not across a
 *                        queue.
 *   sent_at              Epoch ms when Telegram actually accepted the
 *                        message; null until then (and forever for
 *                        blocked/failed rows).
 *   created_at           Epoch ms when the row was written.
 *
 * Rollback:
 *   Safe — drops a server-only table with no cross-table readers yet
 *   (TGR-09/11 land after this bead).
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.createTable("outbound_messages", {
    id: { type: "uuid", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    chat_id: { type: "text", notNull: true },
    intent: { type: "text", notNull: true },
    payload: { type: "jsonb", notNull: true, default: "{}" },
    telegram_message_id: { type: "bigint", notNull: false },
    status: { type: "text", notNull: true },
    sent_at: { type: "bigint", notNull: false },
    created_at: { type: "bigint", notNull: true },
  });
  pgm.addConstraint(
    "outbound_messages",
    "outbound_messages_status_check",
    "CHECK (status IN ('sent','blocked','failed'))",
  );
  pgm.createIndex("outbound_messages", ["user_id", "created_at"]);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable("outbound_messages");
};
