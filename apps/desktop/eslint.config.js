import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "src/renderer/vendor/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      // Allow unused vars prefixed with underscore
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Allow explicit any in targeted places (tighten over time)
      "@typescript-eslint/no-explicit-any": "warn",
      // Enforce no floating promises
      "@typescript-eslint/no-floating-promises": "error",
      // Allow empty catch blocks (common pattern in this codebase)
      "@typescript-eslint/no-empty-function": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='execFileSync'][arguments.0.value='which']",
          message: "Use resolveBinaryFromLoginShell or resolveBinaryFromLoginShellSync for binary discovery.",
        },
        {
          selector: "CallExpression[callee.name='execSync'][arguments.0.value=/\\bwhich\\b/]",
          message: "Use resolveBinaryFromLoginShell or resolveBinaryFromLoginShellSync for binary discovery.",
        },
      ],
    },
  },
  {
    files: ["src/main/**/*.ts", "src/server/**/*.ts"],
    rules: {
      "no-console": "error",
    },
  },
  {
    files: ["src/main/gateway-logger.ts"],
    rules: {
      "no-console": ["error", { allow: ["error", "warn", "log"] }],
    },
  },
);
