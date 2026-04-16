/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: [
    "next/core-web-vitals",
    "plugin:@typescript-eslint/recommended",
  ],
  plugins: ["@typescript-eslint"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "no-console": ["warn", { allow: ["warn", "error"] }],
    // Turkish strings naturally contain apostrophes — disable to avoid false positives
    "react/no-unescaped-entities": "off",
    // Next.js link enforcement — warn only during development
    "@next/next/no-html-link-for-pages": "warn",
  },
  ignorePatterns: ["node_modules/", ".next/"],
};
