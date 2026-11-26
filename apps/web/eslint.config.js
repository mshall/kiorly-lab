import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: { ...reactHooks.configs.recommended.rules, ...jsxA11y.flatConfigs.recommended.rules, "@typescript-eslint/no-explicit-any": "off" },
  },  {
    // Pre-existing a11y findings from when jsx-a11y was first enabled (27 Nov 2026): these files are exempt until fixed one by one; every other file, and any new code, is checked.
    files: [
      "src/brand/components/web/KxControls.tsx",
      "src/components/kit.tsx",
      "src/components/ui.tsx",
      "src/features/orders/OrderDetailPage.tsx",
      "src/features/patients/PatientsPage.tsx",
      "src/features/preanalytics/StoragePage.tsx",
      "src/features/qc/LeveyJenningsChart.tsx",
      "src/features/reception/ReceptionPage.tsx",
      "src/features/referrers/ReferrersPage.tsx",
      "src/features/release/PublicReportPage.tsx",
      "src/features/settings/SettingsPage.tsx",
      "src/features/specimens/AccessioningPage.tsx",
      "src/features/specimens/SpecimenPanel.tsx",
      "src/features/subscription/PlanPage.tsx",
    ],
    rules: {
      "jsx-a11y/interactive-supports-focus": "off",
      "jsx-a11y/label-has-associated-control": "off",
      "jsx-a11y/heading-has-content": "off",
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "jsx-a11y/no-static-element-interactions": "off",
      "jsx-a11y/no-noninteractive-tabindex": "off",
      "jsx-a11y/no-autofocus": "off",
    },
  },
);
