import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      "deepseek_package_0_build_repair/**",
      "**/node_modules/**",
      ".next/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
];

export default eslintConfig;
