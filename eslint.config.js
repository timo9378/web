import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import react from '@eslint-react/eslint-plugin'
import reactPlugin from 'eslint-plugin-react'
import unusedImports from 'eslint-plugin-unused-imports'
// NOTE: eslint-plugin-jsx-a11y 暫不啟用——6.10.2(latest) 在 ESLint 9 flat config 下有
// minimatch interop crash（label-has-associated-control 直接炸掉整個 run）。待修好或升 ESLint 10 再加回。

// 漸進式 JS→TS 遷移用設定：
// - 全體套基底 + React Hooks(含 React Compiler 規則) + a11y + react-refresh
// - 型別感知(type-checked)規則「只」掛 **/*.{ts,tsx}，避免在還沒型別的 .js/.jsx 上狂噴
// - 噪音大的規則遷移期先設 warn，逐檔清完再翻 error
export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'stats.html', '.output', '.nitro', 'packages/*/index.ts'] },

  // ── 全體 ──
  js.configs.recommended,
  reactHooks.configs.recommended, // v6 flat：Rules of React + React Compiler 規則
  reactRefresh.configs.vite,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'unused-imports': unusedImports, react: reactPlugin },
    rules: {
      'no-unused-vars': 'off',
      // HMR-only、非正確性問題，遷移期設 warn（沿用你原本的設定）
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // ESLint 9 不內建 JSX 識別字使用追蹤 → 只在 JSX 用到的 import 會被誤判未使用。
      // 這條讓 no-unused / unused-imports 認得 <Component> 算「使用」。（ESLint 10 內建後可移除）
      'react/jsx-uses-vars': 'error',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' },
      ],
    },
  },

  // ── 只對 TS/TSX：型別感知全套 + @eslint-react TS preset ──
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      react.configs['recommended-typescript'],
    ],
    languageOptions: {
      parserOptions: {
        projectService: {
          // 根目錄的 config 檔不在任何 tsconfig 的 include 裡（tsconfig.json 只收 src、
          // tsconfig.scripts.json 只收 scripts），projectService 找不到 program 就會
          // 直接 parsing error。這裡讓它們走 default project 拿推斷型別。
          // 不改 tsconfig 的 include：那會把它們一起拉進 `tsc --noEmit` 的檢查範圍（CI 有跑）。
          allowDefaultProject: ['vitest.config.ts', 'vite.config.start.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error', // 你要的那條
      '@typescript-eslint/consistent-type-imports': 'error', // 強制 import type
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unused-vars': 'off', // 交給 unused-imports
      '@typescript-eslint/no-unnecessary-condition': 'warn', // 遷移期降噪，清完可翻 error
    },
  },

  // ── JS/JSX/CJS：確保不套型別感知規則（沒型別資訊會噴錯）──
  {
    files: ['**/*.{js,jsx,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // ── routes + start-app helpers：TanStack Router 用 throw redirect()/notFound() 做控制流程，放行 only-throw-error ──
  {
    files: ['src/routes/**/*.{ts,tsx}', 'src/localePage.tsx'],
    rules: {
      '@typescript-eslint/only-throw-error': 'off',
    },
  },
)
