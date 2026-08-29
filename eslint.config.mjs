import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      "**/node_modules/**",
      ".next/**",
      // Operational tooling, not shipped app code: k6 load scripts (k6 globals)
      // and one-off .mjs/.js verification scripts. App code in src/ and e2e/
      // remains fully linted.
      "loadtest/**",
      "scripts/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
];

export default eslintConfig;
