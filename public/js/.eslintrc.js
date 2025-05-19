module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: false, // Disable Node.js globals for this config
  },
  extends: 'eslint:recommended',
  globals: {
    // Browser globals
    document: 'readonly',
    window: 'readonly',
    fetch: 'readonly',
    // Chart.js
    Chart: 'readonly',
    // CommonJS
    module: 'readonly',
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    'no-unused-vars': ['warn', { args: 'none' }],
    'no-console': 'off',
    'no-undef': 'warn',
  },
};
