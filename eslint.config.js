import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      "**/dist/**",
      "**/.wrangler/**",
      "**/node_modules/**",
      "**/.local/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        crypto: "readonly",
        setTimeout: "readonly",
        fetch: "readonly",
      },
    },
  },
  {
    files: ["scripts/browser-smoke.mjs"],
    languageOptions: {
      globals: {
        chrome: "readonly",
        window: "readonly",
        document: "readonly",
        history: "readonly",
      },
    },
  },
);
