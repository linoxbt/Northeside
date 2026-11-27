// TypeScript and React lint for the whole workspace (audit 27 Nov, ops 5). Solidity is checked by
// forge fmt (contracts) and slither (CI). Kept to rules that catch bugs, not style.
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.netlify/**",
      "**/dist/**",
      "**/out/**",
      "contracts/lib/**",
      "contracts/out/**",
      "contracts/cache/**",
      "contracts/broadcast/**",
      "mobile/**",
      "**/*.generated.ts",
      "apps/web/netlify/functions/ops-worker.mjs",
      "apps/web/public/**",
      "packages/chain/src/abis.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      ...nextPlugin.configs.recommended.rules,
      "@next/next/no-img-element": "off",
      // App Router only: there is no pages/ directory for this rule to check.
      "@next/next/no-html-link-for-pages": "off",
      // Deliberate full-page navigations: to API routes that redirect (verification) or to reload state.
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
  {
    files: ["**/test/**", "**/*.test.ts", "apps/web/e2e/**", "**/scripts/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
