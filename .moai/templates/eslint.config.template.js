# 🎯 ESLint Configuration Template
# JS/TS 생태계 표준 (실무형)
#
# 사용법:
# 1. 이 파일을 프로젝트 루트에 eslint.config.js로 복사
# 2. npm install -D typescript-eslint eslint-plugin-check-file
# 3. package.json에 "lint": "eslint src/" 스크립트 추가
#
# 핵심 방향:
# - 코드: camelCase (JS 표준)
# - 타입: PascalCase
# - 상수: UPPER_CASE (선택)
# - property: 강제 안 함 (외부 라이브러리 호환성 핵심)
# - 파일명: kebab-case
#
# 장점:
# - ✅ 외부 라이브러리 100% 호환 (AWS, HTTP, DB 등)
# - ✅ 프론트/백엔드 통일 가능
# - ✅ ESLint 유지보수 거의 없음
# - ✅ JS/TS 생태계 표준 준수

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import checkFile from "eslint-plugin-check-file";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    plugins: { "check-file": checkFile },

    rules: {
      // ✅ 파일명: kebab-case
      "check-file/filename-naming-convention": [
        "error",
        { "**/*.ts": "KEBAB_CASE" },
        { ignoreMiddleExtensions: true },
      ],

      "@typescript-eslint/naming-convention": [
        "error",

        // ✅ 변수: camelCase (밑줄 허용)
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },

        // ✅ const 상수: camelCase or UPPER_CASE
        {
          selector: "variable",
          modifiers: ["const"],
          format: ["camelCase", "UPPER_CASE"],
        },

        // ✅ boolean 변수: 접두사 강제 (가독성 핵심)
        {
          selector: "variable",
          types: ["boolean"],
          format: ["camelCase"],
          prefix: ["is", "has", "can", "should"],
        },

        // ✅ 함수: camelCase
        {
          selector: "function",
          format: ["camelCase"],
        },

        // ✅ 파라미터: camelCase (밑줄 허용)
        {
          selector: "parameter",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },

        // ✅ 타입 계열: PascalCase
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },

        // ✅ enum 멤버: UPPER_CASE
        {
          selector: "enumMember",
          format: ["UPPER_CASE"],
        },

        // 🔥 핵심: property 강제 안 함 (외부 호환성)
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
    ignores: [
      "dist/**",
      "node_modules/**",
      "_reference/**",
      "src/types/api-types.ts",
    ],
  },
);
