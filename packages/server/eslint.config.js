import { createConfig } from "../../eslint.shared.mjs";

export default createConfig({
  ignores: [
    "dist/**",
    "node_modules/**",
    "src/types/api-types.ts",
  ],
});
