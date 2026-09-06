// ESLint 9 flat config（服务端）
// 目标：发现真实缺陷（未定义/未用变量、重复声明、hooks 依赖在前端单独配置），
// 而非格式问题（格式由编辑器/后续 Prettier 处理）。
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'vendor/**',       // 本地 tgz 依赖（SheetJS），不检视
      'data/**',
      'uploads/**',
      'logs/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // _ 前缀参数/变量视为有意忽略；catch 的错误对象常被有意吞掉（降级路径）
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      // 空 catch {} 是本项目的显式降级风格（外部服务失败回退本地），允许；空 if/for 块仍报错
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 服务端统一用 logger，避免误用 console（utils.js 中那处是刻意的兜底日志）
      'no-console': 'warn',
    },
  },
  {
    // CLI 脚本（smoke/backup 等）直接面向终端输出，允许 console
    files: ['scripts/**'],
    rules: {
      'no-console': 'off',
    },
  },
];
