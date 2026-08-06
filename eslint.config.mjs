import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Throwaway scripts kept at the repo root for manual screenshotting and
    // one-off debugging. They're plain CommonJS Node scripts, so the app's
    // TypeScript/ESM rules don't apply and only produce noise.
    "tmp-*.js",
    "tmp-*.mjs",
  ]),
]);

export default eslintConfig;
