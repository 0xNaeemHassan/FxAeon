// Flat ESLint config for the FxAeon monorepo.
//
// Philosophy: the type system (strict `tsc --noEmit`) and the test suite are
// the primary correctness gates. ESLint catches the things tsc does not —
// genuine bugs (unreachable code, accidental globals, mistaken comparisons) —
// while staying out of the way on stylistic matters that are better left to
// formatting tools. Fast, non-type-checked rules only, so it runs in seconds.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/build/**",
      "**/*.min.js",
      "apps/mini-app/next-env.d.ts",
      "apps/mini-app/e2e/__screenshots__/**",
      "packages/db/prisma/migrations/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // `any` is used deliberately at a few external-data boundaries; the type
      // system enforces the rest. Not worth blocking the build over.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      // Unused symbols are a warning (signal, not a hard failure); `_`-prefixed
      // args/vars and caught errors are intentionally ignored.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // Control characters appear in legitimate regexes (e.g. ANSI stripping).
      "no-control-regex": "off",
      // Playwright fixtures use the `async ({}, use) => …` empty-pattern idiom.
      "no-empty-pattern": "off",
    },
  },

  // React components (Mini App): the rules-of-hooks linting Next.js relies on.
  {
    files: ["apps/mini-app/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Plain CommonJS Node scripts (smoke-test.js, etc.).
  {
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Tests and scripts: relax a little further.
  {
    files: ["**/tests/**", "**/test/**", "**/*.test.*", "scripts/**", "**/scripts/**"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
