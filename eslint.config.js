import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unicorn from "eslint-plugin-unicorn";
import eslintConfigPrettier from "eslint-config-prettier";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "src-tauri", "package"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  unicorn.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "better-tailwindcss": betterTailwindcss,
    },
    settings: {
      "better-tailwindcss": {
        entryPoint: "src/index.css",
      },
    },
    rules: {
      "better-tailwindcss/no-restricted-classes": [
        "error",
        {
          restrict: [
            {
              pattern: String.raw`^(.*:)?(?!grid-cols-|transition-)[a-z0-9-]+-\[.+\](/.+)?$`,
              message: "Arbitrary values are banned. Add a token to @theme in src/index.css.",
            },
          ],
        },
      ],
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message:
                "Node.js core modules are not allowed in Tauri frontend. Use @tauri-apps/api equivalents or Rust commands instead.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "Global fetch is banned in the Tauri frontend. Use @tauri-apps/plugin-http's fetch to route requests through the Rust backend.",
        },
      ],
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Minimal standard React/TypeScript adjustments
      "unicorn/prevent-abbreviations": "off",
      "unicorn/name-replacements": "off",
      "unicorn/no-null": "off",
      "unicorn/filename-case": "off",
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message: "src/core is runtime-agnostic. Use the ports in src/core/ports.ts.",
            },
            {
              group: ["@tauri-apps/*"],
              message: "src/core must not depend on Tauri. Inject a Runtime from src/adapters.",
            },
            {
              group: ["react", "react-dom", "react/*", "react-dom/*"],
              message: "src/core must not depend on React.",
            },
            {
              group: ["@/adapters/*", "**/adapters/*"],
              message: "src/core must not import adapters. Adapters are injected.",
            },
            {
              group: ["@/hooks/*", "@/components/*", "**/hooks/*", "**/components/*"],
              message: "src/core must not import UI.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/agent/**/*.ts"],
    ignores: ["src/agent/cli/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message: "Node.js core modules are not allowed in Tauri frontend.",
            },
            {
              group: ["react", "react-dom", "react/*", "react-dom/*"],
              message: "src/agent must not depend on React.",
            },
            {
              group: ["@/hooks/*", "@/components/*", "**/hooks/*", "**/components/*"],
              message: "src/agent must not import UI.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "vite.config.ts",
      "src/agent/cli/**/*.ts",
      "src/adapters/node/**/*.ts",
      "tests/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["src/adapters/node/**/*.ts"],
    rules: {
      "no-restricted-globals": "off",
    },
  },
  {
    files: ["src/components/ui/**/*.tsx"],
    rules: {
      "better-tailwindcss/no-restricted-classes": "off",
    },
  },
  {
    files: ["tests/helpers/**/*.ts"],
    rules: {
      "unicorn/prefer-private-class-fields": "off",
    },
  },
  eslintConfigPrettier
);
