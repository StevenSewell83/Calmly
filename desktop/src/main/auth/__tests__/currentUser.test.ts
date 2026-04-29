import type Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetCurrentUserForTests,
  getCurrentUser,
  setCurrentUser,
} from "../currentUser";

interface PreparedCall {
  sql: string;
  args: unknown[];
}

// Same pattern as inbox/store.test.ts — better-sqlite3's native binding is
// compiled for Electron's ABI, not the host Node, so we substitute a
// minimal fake that records prepared statements + bound args.
function makeFakeDb(): { db: Database.Database; prepared: PreparedCall[] } {
  const prepared: PreparedCall[] = [];
  const db = {
    prepare(sql: string) {
      return {
        run(...args: unknown[]): { changes: number; lastInsertRowid: number } {
          prepared.push({ sql: normalize(sql), args });
          return { changes: 1, lastInsertRowid: 0 };
        },
      };
    },
  } as unknown as Database.Database;
  return { db, prepared };
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

const ALEX = { id: "11111111-1111-1111-1111-111111111111", email: "alex@x.io" };
const BLAKE = { id: "22222222-2222-2222-2222-222222222222", email: "b@x.io" };

describe("currentUser cache", () => {
  beforeEach(() => {
    __resetCurrentUserForTests();
  });

  it("starts empty until set", () => {
    expect(getCurrentUser()).toBeNull();
  });

  it("setCurrentUser(user) caches the user and mirrors a row into users", () => {
    const fake = makeFakeDb();
    setCurrentUser(fake.db, ALEX);

    expect(getCurrentUser()).toEqual(ALEX);
    expect(fake.prepared).toHaveLength(1);
    expect(fake.prepared[0]!.sql).toContain("insert into users");
    expect(fake.prepared[0]!.sql).toContain("on conflict(id) do update");
    expect(fake.prepared[0]!.args).toEqual([ALEX.id, ALEX.email]);
  });

  it("setCurrentUser(null) clears the cache without writing", () => {
    const fake = makeFakeDb();
    setCurrentUser(fake.db, ALEX);
    fake.prepared.length = 0;

    setCurrentUser(fake.db, null);
    expect(getCurrentUser()).toBeNull();
    expect(fake.prepared).toHaveLength(0);
  });

  it("re-setting overwrites the cache and re-mirrors so an email change propagates", () => {
    const fake = makeFakeDb();
    setCurrentUser(fake.db, ALEX);
    setCurrentUser(fake.db, BLAKE);

    expect(getCurrentUser()).toEqual(BLAKE);
    expect(fake.prepared).toHaveLength(2);
    expect(fake.prepared[1]!.args).toEqual([BLAKE.id, BLAKE.email]);
  });
});
