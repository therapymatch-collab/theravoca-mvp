// ESLint flat config — focused on catching the bugs that cause runtime
// crashes on production deploys. We DELIBERATELY do not enforce style
// here (Prettier/format is out of scope); we only flag:
//   • undefined identifiers (no-undef) — caught the missing useFaqs
//     import in iter-60 that crashed Landing.jsx.
//   • unused vars (no-unused-vars) — kept as warning so we still ship
//     PRs while a code-cleanup pass tackles them.
//
// Run via:  yarn lint   (warnings-as-errors)
//           yarn lint:strict   (forces `no-undef` even if elsewhere
//                               disabled).
import js from "@eslint/js";
import globals from "globals";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "build/**",
      "node_modules/**",
      "public/**",
      "src/components/ui/**", // shadcn vendored
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        process: "readonly",
      },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-prototype-builtins": "off",
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "react-hooks/rules-of-hooks": "error",
    },
    settings: {
      react: { version: "detect" },
    },
  },
];
