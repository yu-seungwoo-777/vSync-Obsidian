import js from "@eslint/js";
import tseslint from "typescript-eslint";
import checkFile from "eslint-plugin-check-file";

/**
 * Shared ESLint config for Vector (server + plugin + web).
 *
 * Naming convention:
 * - Code: camelCase (TypeScript standard)
 * - Types: PascalCase
 * - Constants: UPPER_CASE allowed
 * - Properties: not enforced (external SDK / HTTP / DB compatibility)
 *
 * Exceptions:
 * - src/dto/**: snake_case allowed (internal camelCase <-> external snake_case boundary)
 * - api-types.ts: snake_case allowed (OpenAPI wire format, auto-generated)
 *
 * Note: The "types" filter in @typescript-eslint/naming-convention requires
 * type-checked linting, so it is intentionally not used here.
 */
export function createConfig({ files, ignores, dtoFiles, testFiles } = {}) {
  const defaultFiles = ["src/**/*.ts", "tests/**/*.ts"];
  const defaultIgnores = ["dist/**", "node_modules/**", "_reference/**"];
  const defaultDtoFiles = ["src/dto/**/*.ts", "**/api-types.ts"];
  const defaultTestFiles = ["tests/**/*.test.ts"];

  return tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      files: files ?? defaultFiles,
      plugins: { "check-file": checkFile },

      rules: {
        // Filename: kebab-case
        "check-file/filename-naming-convention": [
          "error",
          { "**/*.ts": "KEBAB_CASE" },
          { ignoreMiddleExtensions: true },
        ],

        "@typescript-eslint/naming-convention": [
          "error",

          // Variable: camelCase + UPPER_CASE
          {
            selector: "variable",
            format: ["camelCase", "UPPER_CASE"],
            leadingUnderscore: "allow",
          },

          // Const variable: camelCase + UPPER_CASE
          {
            selector: "variable",
            modifiers: ["const"],
            format: ["camelCase", "UPPER_CASE"],
          },

          // Function: camelCase
          {
            selector: "function",
            format: ["camelCase"],
          },

          // Parameter: camelCase
          {
            selector: "parameter",
            format: ["camelCase"],
            leadingUnderscore: "allow",
          },

          // Type: PascalCase
          {
            selector: "typeLike",
            format: ["PascalCase"],
          },

          // Enum member: UPPER_CASE
          {
            selector: "enumMember",
            format: ["UPPER_CASE"],
          },

          // Property: free (external compatibility)
          {
            selector: "property",
            format: null,
          },
          {
            selector: "objectLiteralProperty",
            format: null,
          },
        ],

        "@typescript-eslint/no-unused-vars": [
          "warn",
          { argsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/no-explicit-any": "warn",
      },
    },
    {
      ignores: ignores ?? defaultIgnores,
    },
    // Test files: relax filename rule (test files use kebab-case naturally)
    {
      files: testFiles ?? defaultTestFiles,
      rules: {
        "check-file/filename-naming-convention": "off",
      },
    },
    // DTO / wire format exception: snake_case allowed
    {
      files: dtoFiles ?? defaultDtoFiles,
      rules: {
        "@typescript-eslint/naming-convention": [
          "error",
          {
            selector: "variable",
            format: ["camelCase", "snake_case", "UPPER_CASE"],
          },
          {
            selector: "parameter",
            format: ["camelCase", "snake_case"],
          },
          {
            selector: "property",
            format: null,
          },
        ],
      },
    },
  );
}
