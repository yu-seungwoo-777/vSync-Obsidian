import { createConfig } from "../../eslint.shared.mjs";

export default createConfig({
  ignores: [
    "node_modules/**",
    "main.js",
    "src/types/api-types.ts",
  ],
});
