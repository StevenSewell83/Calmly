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
      "server/**/*.{ts,tsx}",
      "shared/**/*.{ts,tsx}",
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
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
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
