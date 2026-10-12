// Shared ESLint 9 flat config for Praxis web packages.
// Usage (eslint.config.mjs in a package):
//   import { praxisConfig } from "@praxis/config/eslint";
//   export default praxisConfig({ next: true });
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** @param {{ next?: boolean, ignores?: string[] }} [opts] */
export function praxisConfig(opts = {}) {
  const { next = false, ignores = [] } = opts;
  return tseslint.config(
    {
      ignores: [
        "**/node_modules/**",
        "**/.next/**",
        "**/dist/**",
        "**/out/**",
        "**/next-env.d.ts",
        "**/*.config.{js,cjs,mjs}",
        ...ignores,
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      files: ["**/*.{ts,tsx}"],
      plugins: {
        react,
        "react-hooks": reactHooks,
        "jsx-a11y": jsxA11y,
        ...(next ? { "@next/next": nextPlugin } : {}),
      },
      languageOptions: {
        globals: { ...globals.browser, ...globals.node },
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      settings: { react: { version: "19.0" } },
      rules: {
        ...react.configs.recommended.rules,
        ...react.configs["jsx-runtime"].rules,
        ...reactHooks.configs.recommended.rules,
        ...jsxA11y.configs.recommended.rules,
        ...(next ? { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs["core-web-vitals"].rules } : {}),
        "react/prop-types": "off",
        "react/no-unknown-property": ["error", { ignore: ["cmdk-input-wrapper", "vaul-drawer-wrapper"] }],
        "@typescript-eslint/no-unused-vars": [
          "warn",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
        ],
        "@typescript-eslint/consistent-type-imports": ["warn", { fixStyle: "inline-type-imports" }],
        "@typescript-eslint/no-explicit-any": "warn",
        "jsx-a11y/no-autofocus": "off",
        "no-console": ["warn", { allow: ["warn", "error"] }],
      },
    },
  );
}

export default praxisConfig();
