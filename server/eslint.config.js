import globals from 'globals';

export default [{
  files: ['src/**/*.js', 'test/**/*.js', 'scripts/**/*.mjs'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
  rules: {
    'no-undef': 'error',
    'no-unreachable': 'error',
    'no-dupe-keys': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
}];
