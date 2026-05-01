import { describe, expect, it } from "vitest";
import { groupErrors, parseTypecheckOutput } from "../lib/parse";

const SAMPLE = `
Scope: 5 of 6 workspace projects
shared typecheck$ tsc --noEmit
shared typecheck: Done
desktop typecheck$ tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
desktop typecheck: src/main/ipc/__tests__/focus.test.ts(23,24): error TS2307: Cannot find module '../focus/store' or its corresponding type declarations.
desktop typecheck: src/main/ipc/__tests__/inbox.test.ts(28,24): error TS2307: Cannot find module '../inbox/store' or its corresponding type declarations.
desktop typecheck: src/main/plan/store.ts(28,11): error TS2304: Cannot find name 'InboxSource'.
desktop typecheck: src/main/triage/store.ts(419,11): error TS2345: Argument of type 'X' is not assignable to parameter of type 'string'.
server typecheck$ tsc --noEmit
server typecheck: Done
`;

describe("parseTypecheckOutput", () => {
  it("extracts each TS error line into a structured record", () => {
    const errors = parseTypecheckOutput(SAMPLE);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toEqual({
      workspace: "desktop",
      file: "src/main/ipc/__tests__/focus.test.ts",
      line: 23,
      column: 24,
      code: "TS2307",
      message: "Cannot find module '../focus/store' or its corresponding type declarations.",
    });
  });

  it("ignores Done banners and progress lines", () => {
    const errors = parseTypecheckOutput("desktop typecheck: Done\nrandom noise\n");
    expect(errors).toEqual([]);
  });

  it("supports nested workspace paths (tools/schema-parity)", () => {
    const errors = parseTypecheckOutput(
      "tools/schema-parity typecheck: lib/parse.ts(10,2): error TS9999: oops\n",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.workspace).toBe("tools/schema-parity");
  });

  it("survives Windows line endings", () => {
    const errors = parseTypecheckOutput(
      "desktop typecheck: a.ts(1,1): error TS1: x\r\nshared typecheck: Done\r\n",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.workspace).toBe("desktop");
  });

  it("ignores warning lines that are not 'error'", () => {
    const errors = parseTypecheckOutput(
      "desktop typecheck: a.ts(1,1): warning TS1: x\n",
    );
    expect(errors).toEqual([]);
  });
});

describe("groupErrors", () => {
  it("groups by (workspace, file, code) regardless of line number", () => {
    const errors = parseTypecheckOutput(`
desktop typecheck: src/a.ts(10,1): error TS123: a
desktop typecheck: src/a.ts(20,1): error TS123: b
desktop typecheck: src/a.ts(30,1): error TS999: c
desktop typecheck: src/b.ts(1,1): error TS123: d
`);
    const buckets = groupErrors(errors);
    expect(buckets).toEqual([
      { workspace: "desktop", file: "src/a.ts", code: "TS123", count: 2 },
      { workspace: "desktop", file: "src/a.ts", code: "TS999", count: 1 },
      { workspace: "desktop", file: "src/b.ts", code: "TS123", count: 1 },
    ]);
  });

  it("sorts deterministically (workspace → file → code)", () => {
    const errors = parseTypecheckOutput(`
server typecheck: z.ts(1,1): error TS1: x
desktop typecheck: a.ts(1,1): error TS2: x
desktop typecheck: a.ts(1,1): error TS1: x
`);
    const buckets = groupErrors(errors);
    expect(buckets.map((b) => `${b.workspace}/${b.file}/${b.code}`)).toEqual([
      "desktop/a.ts/TS1",
      "desktop/a.ts/TS2",
      "server/z.ts/TS1",
    ]);
  });
});
