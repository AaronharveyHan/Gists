module.exports = {
  root: true,
  env: { browser: true, es2021: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint", "react-hooks"],
  rules: {
    // TypeScript compiler flags unused vars with noUnusedLocals/noUnusedParameters
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": "off",
    // Explicit any is sometimes unavoidable with Tauri event payloads
    "@typescript-eslint/no-explicit-any": "off",
    // Allow non-null assertions — TypeScript strict mode already requires checking
    "@typescript-eslint/no-non-null-assertion": "off",
    // Allow ternary expressions as statements (e.g. set.has(x) ? set.delete(x) : set.add(x))
    "no-unused-expressions": "off",
    "@typescript-eslint/no-unused-expressions": [
      "error",
      { allowTernary: true, allowShortCircuit: true },
    ],
    // Empty catch blocks are intentional (swallowing non-critical errors)
    "no-empty": ["error", { allowEmptyCatch: true }],
    // react-hooks v7 introduced these rules which flag common valid React patterns:
    //   set-state-in-effect: fires on reset-on-prop-change patterns and loading-state setup
    //   refs: fires on the "always-fresh ref" pattern (fnRef.current = fn during render)
    //   immutability: fires on valid ref mutation inside effects (e.g. prevValue.current = x)
    "react-hooks/set-state-in-effect": "off",
    "react-hooks/refs": "off",
    "react-hooks/immutability": "off",
  },
  ignorePatterns: [
    "dist",
    "src-tauri",
    "e2e",
    "*.config.ts",
    "*.config.js",
    "*.config.mjs",
    "wdio.conf.ts",
  ],
};
