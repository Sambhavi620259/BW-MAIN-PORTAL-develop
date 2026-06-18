import js from "@eslint/js";
import globals from "globals";
import reactPlugin from "eslint-plugin-react";

const isProduction =
  process.env.NODE_ENV === "production" || process.env.ESLINT_PROD === "true";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "e2e/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: { react: reactPlugin },
    settings: { react: { version: "detect" } },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      /**
       * Mark variables referenced in JSX as "used" so that no-unused-vars
       * does not raise false positives for component imports used only in JSX
       * (e.g. <Suspense>, <Route>, <Toaster>).
       */
      "react/jsx-uses-vars": "error",
      "no-console": isProduction
        ? ["error", { allow: ["warn", "error"] }]
        : ["warn", { allow: ["warn", "error"] }],
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
