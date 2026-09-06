// ESLint 9 flat config（前端）
// 重点：react-hooks 依赖数组检查（useEffect 闭包过期/泄漏是本项目轮询类组件的主要风险面）。
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import unusedImports from 'eslint-plugin-unused-imports';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'unused-imports': unusedImports,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // espree 默认不把 JSX 标识符计为变量使用，必须开启此规则，
      // 否则 no-unused-vars 会误报所有 JSX 中使用的组件（且 --fix 会误删 import）
      'react/jsx-uses-vars': 'error',
      // HMR 仅约定 fast-refresh 导出形态，作为告警不阻塞
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // 未用 import 直接自动删除（--fix 可修）；局部未用变量仍报错督促手工清理
      'unused-imports/no-unused-imports': 'error',
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // 空 catch {} 是本项目显式降级风格（如 localStorage 在隐私模式不可用），允许
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // 测试与构建配置运行在 Node 环境（node:test / vite.config.js）
    files: ['test/**', 'vite.config.js', 'vite.config.mjs', 'tailwind.config.js', 'postcss.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
