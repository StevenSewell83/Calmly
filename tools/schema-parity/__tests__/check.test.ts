/**
 * Tests for the schema-parity tool. Use small in-memory fixtures so the
 * comparator is exercised independently of the real (drifting) repo
 * schemas.
 */
import { describe, it, expect } from "vitest";

import { compare } from "../lib/compare";
import { parseSqliteSql } from "../lib/parseSqlite";
import { parsePgSource } from "../lib/parsePg";
import { parseZodSource } from "../lib/parseZod";
import type { AllowList } from "../lib/types";

const emptyAllowList: AllowList = { divergences: [] };

describe("parseSqliteSql", () => {
  it("parses CREATE TABLE column lists", () => {
    const sql = `
      CREATE TABLE widgets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        notes TEXT,
        count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      ) STRICT;
    `;
    const tables = parseSqliteSql(sql);
    expect(Object.keys(tables)).toEqual(["widgets"]);
    expect(tables.widgets).toBeDefined();
    expect(Object.keys(tables.widgets!).sort()).toEqual([
      "count",
      "created_at",
      "id",
      "name",
      "notes",
      "user_id",
    ]);
    expect(tables.widgets!.id!.bucket).toBe("string");
    expect(tables.widgets!.count!.bucket).toBe("number");
    expect(tables.widgets!.notes!.nullable).toBe(true);
    expect(tables.widgets!.name!.nullable).toBe(false);
  });

  it("ignores top-level table constraints (PRIMARY KEY/UNIQUE/CHECK)", () => {
    const sql = `
      CREATE TABLE thing (
        a TEXT,
        b TEXT,
        UNIQUE (a, b),
        CHECK (length(a) > 0)
      );
    `;
    const tables = parseSqliteSql(sql);
    expect(Object.keys(tables.thing!).sort()).toEqual(["a", "b"]);
  });

  it("captures ALTER TABLE ADD COLUMN additions", () => {
    const sql = `
      CREATE TABLE t (id TEXT PRIMARY KEY) STRICT;
      ALTER TABLE t ADD COLUMN extra INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE t ADD COLUMN tombstone INTEGER;
    `;
    const tables = parseSqliteSql(sql);
    expect(Object.keys(tables.t!).sort()).toEqual(["extra", "id", "tombstone"]);
    expect(tables.t!.extra!.nullable).toBe(false);
    expect(tables.t!.tombstone!.nullable).toBe(true);
  });

  it("ignores virtual tables (FTS5)", () => {
    const sql = `CREATE VIRTUAL TABLE IF NOT EXISTS _fts USING fts5(content);`;
    const tables = parseSqliteSql(sql);
    expect(tables._fts).toBeUndefined();
  });

  it("strips line and block comments", () => {
    const sql = `
      -- a comment
      /* another
         comment */
      CREATE TABLE c (id TEXT) STRICT;
    `;
    const tables = parseSqliteSql(sql);
    expect(Object.keys(tables)).toEqual(["c"]);
  });
});

describe("parsePgSource", () => {
  it("parses pgm.createTable + spread groups", () => {
    const src = `
      exports.up = (pgm) => {
        const sync = {
          version: { type: "bigint", notNull: true, unique: true },
          updated_at: { type: "bigint", notNull: true },
          deleted_at: { type: "bigint" },
        };

        pgm.createTable("widgets", {
          id: { type: "text", primaryKey: true },
          user_id: { type: "uuid", notNull: true },
          name: { type: "text", notNull: true },
          notes: { type: "text" },
          ...sync,
        });
      };
    `;
    const tables = parsePgSource(src);
    expect(Object.keys(tables)).toEqual(["widgets"]);
    expect(Object.keys(tables.widgets!).sort()).toEqual([
      "deleted_at",
      "id",
      "name",
      "notes",
      "updated_at",
      "user_id",
      "version",
    ]);
    expect(tables.widgets!.id!.bucket).toBe("string");
    expect(tables.widgets!.user_id!.bucket).toBe("string");
    expect(tables.widgets!.version!.bucket).toBe("number");
    expect(tables.widgets!.notes!.nullable).toBe(true);
    expect(tables.widgets!.name!.nullable).toBe(false);
  });

  it("parses pgm.addColumns additions", () => {
    const src = `
      exports.up = (pgm) => {
        pgm.createTable("t", { id: { type: "text", primaryKey: true } });
        pgm.addColumns("t", {
          extra: { type: "bigint", notNull: true },
          tombstone: { type: "bigint" },
        });
      };
    `;
    const tables = parsePgSource(src);
    expect(Object.keys(tables.t!).sort()).toEqual(["extra", "id", "tombstone"]);
    expect(tables.t!.extra!.nullable).toBe(false);
    expect(tables.t!.tombstone!.nullable).toBe(true);
  });

  it("handles addColumn (singular) form", () => {
    const src = `
      pgm.createTable("inbox_items", { id: { type: "text", primaryKey: true } });
      pgm.addColumn("inbox_items", { snoozed_until: { type: "bigint" } });
    `;
    const tables = parsePgSource(src);
    expect(tables.inbox_items!.snoozed_until).toBeDefined();
  });
});

describe("parseZodSource", () => {
  it("parses an export const FooSchema = z.object({...}) declaration", () => {
    const src = `
      import { z } from "zod";
      export const WidgetSchema = z.object({
        id: z.string().uuid(),
        title: z.string().min(1),
        count: z.number().int(),
        active: z.boolean(),
        notes: z.string().nullable(),
      });
    `;
    const out = parseZodSource(src);
    expect(out.WidgetSchema).toBeDefined();
    expect(out.WidgetSchema!.id!.bucket).toBe("string");
    expect(out.WidgetSchema!.count!.bucket).toBe("number");
    expect(out.WidgetSchema!.active!.bucket).toBe("boolean");
    expect(out.WidgetSchema!.notes!.nullable).toBe(true);
  });

  it("recognises project alias tokens (uuid, unixMs, *Schema)", () => {
    const src = `
      export const ThingSchema = z.object({
        id: uuid,
        when: unixMs.nullable(),
        status: TaskStatusSchema,
      });
    `;
    const out = parseZodSource(src);
    expect(out.ThingSchema!.id!.bucket).toBe("string");
    expect(out.ThingSchema!.when!.bucket).toBe("number");
    expect(out.ThingSchema!.when!.nullable).toBe(true);
    expect(out.ThingSchema!.status!.bucket).toBe("string");
  });
});

describe("compare", () => {
  it("flags a column missing from one source", () => {
    const result = compare(
      "widgets",
      {
        shared: {
          id: { bucket: "string", rawType: "z.string", nullable: false },
        },
        desktop: {
          id: { bucket: "string", rawType: "TEXT", nullable: false },
          extra: { bucket: "number", rawType: "INTEGER", nullable: true },
        },
        server: { id: { bucket: "string", rawType: "text", nullable: false } },
      },
      emptyAllowList,
    );
    expect(result.drifts).toHaveLength(1);
    expect(result.drifts[0]!.column).toBe("extra");
    expect(result.drifts[0]!.kind).toBe("missing");
    expect(result.drifts[0]!.cells.shared).toBeUndefined();
    expect(result.drifts[0]!.cells.desktop).toBeDefined();
  });

  it("returns no drift when all three sources agree", () => {
    const c = { bucket: "string", rawType: "x", nullable: false } as const;
    const result = compare(
      "t",
      { shared: { id: c }, desktop: { id: c }, server: { id: c } },
      emptyAllowList,
    );
    expect(result.drifts).toHaveLength(0);
  });

  it("silences a column when the allow-list matches presentIn/absentIn", () => {
    const allow: AllowList = {
      divergences: [
        {
          table: "t",
          column: "x",
          presentIn: ["server"],
          absentIn: ["shared", "desktop"],
          reason: "test",
        },
      ],
    };
    const result = compare(
      "t",
      {
        shared: {},
        desktop: {},
        server: { x: { bucket: "string", rawType: "text", nullable: true } },
      },
      allow,
    );
    expect(result.drifts).toHaveLength(0);
    expect(result.silenced).toContain("x");
  });

  it("does NOT silence when allow-list presentIn/absentIn don't match the actual situation", () => {
    const allow: AllowList = {
      divergences: [
        {
          table: "t",
          column: "x",
          presentIn: ["server"],
          absentIn: ["shared", "desktop"],
          reason: "test",
        },
      ],
    };
    // Actually missing only from `shared`, present in both desktop and server.
    const result = compare(
      "t",
      {
        shared: {},
        desktop: { x: { bucket: "string", rawType: "TEXT", nullable: false } },
        server: { x: { bucket: "string", rawType: "text", nullable: false } },
      },
      allow,
    );
    expect(result.drifts).toHaveLength(1);
  });

  it("flags type-bucket mismatches when all three sources have the column", () => {
    const result = compare(
      "t",
      {
        shared: {
          x: { bucket: "string", rawType: "z.string", nullable: false },
        },
        desktop: {
          x: { bucket: "number", rawType: "INTEGER", nullable: false },
        },
        server: { x: { bucket: "string", rawType: "text", nullable: false } },
      },
      emptyAllowList,
    );
    expect(result.drifts).toHaveLength(1);
    expect(result.drifts[0]!.kind).toBe("type-mismatch");
  });

  it("table-level allow-list silences server-only / client-only tables", () => {
    const allow: AllowList = {
      divergences: [],
      tables: [
        {
          table: "secrets",
          presentIn: ["desktop"],
          absentIn: ["shared", "server"],
          reason: "desktop-only",
        },
      ],
    };
    const result = compare(
      "secrets",
      {
        shared: undefined,
        desktop: {
          key: { bucket: "string", rawType: "TEXT", nullable: false },
          ciphertext: { bucket: "blob", rawType: "BLOB", nullable: false },
        },
        server: undefined,
      },
      allow,
    );
    expect(result.drifts).toHaveLength(0);
  });
});
