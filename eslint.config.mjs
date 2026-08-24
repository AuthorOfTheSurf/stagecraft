// Not a style linter — Prettier owns formatting. This config exists to ban
// patterns Prettier happily preserves, starting with single-line/braceless
// conditionals.
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      curly: ["error", "all"],
    },
  },
];
