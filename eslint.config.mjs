import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      "**/node_modules/**",
      ".next/**",
      "**/.next/**",
      // Operational tooling, not shipped app code: k6 load scripts (k6 globals)
      // and one-off .mjs/.js verification scripts. App code in src/ and e2e/
      // remains fully linted. Patterns are glob-nested so copies that live
      // under a subdirectory (e.g. .kilo/worktrees, the Design_* deliverable)
      // are treated the same as the root-level originals.
      "loadtest/**",
      "**/loadtest/**",
      "scripts/**",
      "**/scripts/**",
      // Local developer tooling (Kilo Code worktrees / agent state) — never
      // shipped, and absent on CI.
      ".kilo/**",
      // Supabase CLI state and disposable local verification artifacts.
      "supabase/.temp/**",
      // Nested duplicate project accidentally committed as a broken gitlink
      // (mode 160000 with no .gitmodules entry). It is untracked and local-only.
      "Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Leading underscore marks an intentionally unused binding (e.g. the
      // (_prev, _form) signature required by useActionState).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
];

export default eslintConfig;
