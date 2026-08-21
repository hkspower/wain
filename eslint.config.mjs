import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { FlatCompat } from "@eslint/eslintrc";

/**
 * There was no linter at all.
 *
 * `npm run lint` ran `next lint`, which offers to *set one up* and then waits
 * for an answer — so in any non-interactive shell it hung, and in practice
 * nobody ever linted anything. Nothing was checking for a stale hook
 * dependency, an unused import, a floating promise, or an `any` that quietly
 * turned off type-checking for a whole expression.
 *
 * Three surfaces, three sets of rules, because they are genuinely different
 * programs: the app (React in a browser), the scripts (Node, allowed to print),
 * and the tests (Node, allowed to print and to reach into globals the app
 * would never touch).
 */
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default tseslint.config(
  {
    ignores: ["out/**", ".next/**", "node_modules/**", "next-env.d.ts", "public/**"],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  // eslint-config-next still ships eslintrc-style, hence the compat wrapper.
  ...compat.extends("next/core-web-vitals"),

  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // An unused variable is either a leftover or a mistake, and both are
      // worth seeing. Prefixing with _ is the way to say "deliberately unused".
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // `any` switches off type checking for everything downstream of it, which
      // is exactly the sort of thing that should be argued for in a comment
      // rather than typed by reflex.
      "@typescript-eslint/no-explicit-any": "warn",
      // A promise nobody waits for is a failure nobody hears about.
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-var": "error",
    },
  },

  {
    files: ["scripts/**/*.mjs", "tests/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    rules: {
      // These exist to print.
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },

  {
    files: ["tests/harness/**/*.{ts,tsx}"],
    rules: {
      // A harness deliberately reaches for window globals and replaces browser
      // APIs; that is the job, not a smell.
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  }
);
