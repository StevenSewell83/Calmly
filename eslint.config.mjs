// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import globals from "globals";

// Flat config at repo root. Workspaces (shared, server, desktop) inherit from
// here; per-area overrides live in the same array. We deliberately stay on
// non-type-aware rules for now — the type-aware rule set requires per-tsconfig
// parser projects and is ~5x slower; revisit once feedback patterns warrant it.

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/.pnpm/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/e2e-results/**",
      "**/test-results/**",
      "GUI_draft.ts",
      ".bd/**",
      ".beads/**",
      ".ralph/**",
      ".dev-mail/**",
      "**/*.d.ts",
    ],
  },

  // Base JS recommended.
  js.configs.recommended,

  // typescript-eslint non-type-checked recommended for every TS file.
  ...tseslint.configs.recommended,

  // Cross-workspace defaults.
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // We reach for `unknown` casts in IPC boundaries; opt-in error only when
      // the assertion isn't to a narrow type.
      "@typescript-eslint/no-explicit-any": "warn",
      // PREVENT-2: object-literal `as` casts erase optional/required mismatches.
      // Force callers to use `satisfies` or a typed const so structural drift
      // surfaces at compile time.
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
      ],
    },
  },

  // PREVENT-2: cap source files at 300 LOC across the three workspaces. Tests,
  // generated `.d.ts` files, and SQL migration glue are exempt (see ignores
  // and the per-files block below). Per-file overrides for currently-too-large
  // files are listed further down with a tracking-bead comment so they get
  // removed once the underlying refactor lands.
  {
    files: [
      "desktop/src/**/*.{ts,tsx}",
      "server/src/**/*.ts",
      "shared/src/**/*.ts",
    ],
    ignores: [
      "**/__tests__/**",
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
      "**/migrations/**",
      "**/*.d.ts",
    ],
    rules: {
      "max-lines": [
        "error",
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // PREVENT-2: ban literal enum strings outside `shared/`. Drift audit on
  // 2026-04-30 found dozens of stray "open" / "in_progress" etc. literals in
  // call-sites, which made it impossible to refactor TaskStatus safely. Force
  // imports from @calmly/shared instead. Tests, migrations, model definitions
  // (where the literal is the canonical source), and the shared package itself
  // are exempt — see the override block below.
  {
    files: ["desktop/src/**/*.{ts,tsx}", "server/src/**/*.ts"],
    ignores: [
      "**/__tests__/**",
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
      "**/migrations/**",
      "**/model/**",
      "**/db/migrations/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/^(open|in_progress|done|dropped)$/]",
          message:
            "Use TaskStatus from @calmly/shared, not a string literal.",
        },
        {
          selector: "Literal[value=/^(telegram|desktop)$/]",
          message: "Use Source enum from @calmly/shared, not a string literal.",
        },
      ],
    },
  },

  // Renderer (React) — enables react-hooks and react-refresh.
  {
    files: ["desktop/src/renderer/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // Main + preload + server + tooling — node globals.
  {
    files: [
      "desktop/src/main/**/*.{ts,tsx}",
      "desktop/src/preload/**/*.{ts,tsx}",
      "desktop/e2e/**/*.{ts,tsx}",
      "desktop/scripts/**/*.{js,mjs,ts}",
      "desktop/playwright.config.ts",
      "server/**/*.{ts,tsx}",
      "shared/**/*.{ts,tsx}",
      "scripts/**/*.{js,mjs,ts}",
      "*.{js,ts}",
      "**/*.config.{js,ts,cjs,mjs}",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Tests — looser rules so we can use vi.fn() casts freely.
  {
    files: [
      "**/__tests__/**/*.{ts,tsx}",
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
      "desktop/e2e/**/*.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      // Tests build object-literal fixtures that shape-match domain types via
      // `as`; insisting on `satisfies` for every fixture is more noise than
      // signal.
      "@typescript-eslint/consistent-type-assertions": "off",
      // Tests legitimately reference enum string literals in assertions and
      // mock payloads; the shared-import rule would create thousands of false
      // positives there.
      "no-restricted-syntax": "off",
      "max-lines": "off",
    },
  },

  // PREVENT-2: per-file overrides for the banned-literal rule. Each entry
  // names a file where the literal is part of a typed surface (store helpers
  // building TaskStatus arrays, IPC handlers passing typed Source values,
  // preload type definitions) — i.e. the *opposite* of the drift the rule
  // exists to catch. The rule still applies to the rest of the workspace.
  {
    files: [
      // Store layers build typed TaskStatus arrays / consts at module scope.
      "desktop/src/main/focus/store.ts",
      "desktop/src/main/plan/store.ts",
      "desktop/src/main/triage/store.ts",
      // IPC handlers pass typed enum values into the domain layer.
      "desktop/src/main/ipc/inbox.ts",
      // Preload api-types is the canonical renderer-side mirror of the shared
      // unions; pulling @calmly/shared into the renderer just for this would
      // tangle the dep graph.
      "desktop/src/preload/api-types.ts",
      // Renderer Today views read TaskStatus off typed payloads.
      "desktop/src/renderer/pages/Home/TodayList.tsx",
      "desktop/src/renderer/pages/Home/useTodaySummary.ts",
      // Triage switch narrows over the typed InboxItem["source"] union.
      "desktop/src/renderer/pages/Inbox/Triage.tsx",
      // React Router config — `path: "telegram"` is a route segment, not
      // a Source enum value (the regex match is coincidental).
      "desktop/src/renderer/router.tsx",
      // TGR-08: pure task-status gate builds a typed TaskStatus const set.
      "server/src/reminders/state.ts",
      // TGR-08: channel identifiers, same category as Source enum values —
      // defined once here so the rest of reminders/ imports the constants.
      "server/src/reminders/channels/types.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },

  // PREVENT-2: per-file max-lines overrides. Each entry cites the bead that
  // tracks the underlying split/refactor so this list shrinks over time.
  {
    files: ["desktop/src/renderer/pages/Inbox/Triage.tsx"],
    rules: {
      // TODO(calmly-3py.7): remove once Triage.tsx is split — see PREVENT-2.
      "max-lines": ["off"],
    },
  },
  {
    files: ["desktop/src/preload/api-types.ts"],
    rules: {
      // TODO(calmly-3py.6): remove once row types are deduped — see PREVENT-2.
      "max-lines": ["off"],
    },
  },
  {
    files: ["desktop/src/main/triage/store.ts"],
    rules: {
      // PREVENT-2 drift cleanup: 314 LOC, no dedicated bead — bump cap to 320
      // so the rule lands today; revisit when triage store is next touched.
      "max-lines": [
        "error",
        { max: 320, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ["desktop/src/main/index.ts"],
    rules: {
      // PREVENT-2 drift cleanup: 306 LOC, no dedicated bead — bump cap to 320
      // so the rule lands today; revisit when main bootstrap is next touched.
      "max-lines": [
        "error",
        { max: 320, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // CommonJS files (legacy migrations + .cjs configs) need commonjs globals
  // so `module`, `exports`, `require` aren't flagged as undefined.
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.commonjs,
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Prettier — must come LAST so it disables conflicting style rules.
  prettier,
);
