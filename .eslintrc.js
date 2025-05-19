module.exports = {
  root: true,
  env: {
    commonjs: true,
    es2021: true,
    node: true,
    jest: true,
  },
  plugins: ['prettier'],
  extends: [
    'eslint:recommended',
    'plugin:prettier/recommended', // Enables eslint-plugin-prettier and eslint-config-prettier
  ],
  overrides: [
    // Node.js specific rules
    {
      files: ['**/*.js'],
      excludedFiles: ['public/**/*.js', '**/*.test.js'],
      parserOptions: {
        sourceType: 'script',
        ecmaVersion: 'latest',
      },
      rules: {
        'no-unused-vars': [
          'warn',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrors: 'none',
            ignoreRestSiblings: true,
          },
        ],
        'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
        'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
        'no-undef': 'error',
        'no-var': 'error',
        'prefer-const': 'error',
        'no-constant-condition': ['error', { checkLoops: false }],
        'no-empty': ['error', { allowEmptyCatch: true }],
        'require-await': 'off', // Disable require-await for non-test files
      },
    },

    // Browser specific rules
    {
      files: ['public/**/*.js'],
      env: {
        browser: true,
        node: false,
      },
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 'latest',
      },
      rules: {
        'no-unused-vars': [
          'warn',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrors: 'none',
            ignoreRestSiblings: true,
          },
        ],
        'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
        'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
        'no-undef': 'warn',
        'prettier/prettier': ['error', {}, { usePrettierrc: true }],
      },
      globals: {
        // Browser globals
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        // Web APIs
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        // Chart.js
        Chart: 'readonly',
        // Common libraries
        $: 'readonly',
        jQuery: 'readonly',
        // Environment variables (handled by webpack/vite)
        process: 'readonly',
      },
    },

    // Test files
    {
      files: ['**/*.test.js'],
      env: {
        jest: true,
        node: true,
      },
      rules: {
        'no-unused-vars': [
          'warn',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrors: 'none',
            ignoreRestSiblings: true,
          },
        ],
        'no-console': 'off',
        'no-debugger': 'off',
        'no-undef': 'error',
        'require-await': 'error', // Enforce async tests to have await
      },
    },
  ],
  parserOptions: {
    ecmaVersion: 'latest',
  },
  rules: {
    // Error prevention
    'no-cond-assign': 'error',
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-control-regex': 'error',
    'no-delete-var': 'error',
    'no-empty': ['error', { allowEmptyCatch: true }],
    'no-empty-character-class': 'error',
    'no-ex-assign': 'error',
    'no-extra-boolean-cast': 'error',
    'no-inner-declarations': 'error',
    'no-invalid-regexp': 'error',
    'no-regex-spaces': 'error',
    'no-sparse-arrays': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
    'no-unsafe-negation': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',

    // Best practices
    'array-callback-return': 'error',
    'block-scoped-var': 'error',
    'consistent-return': 'error',
    'default-case': 'error',
    'dot-notation': 'error',
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-alert': 'warn',
    'no-caller': 'error',
    'no-case-declarations': 'error',
    'no-else-return': 'error',
    'no-empty-function': 'warn',
    'no-empty-pattern': 'error',
    'no-eval': 'error',
    'no-extend-native': 'error',
    'no-extra-bind': 'error',
    'no-fallthrough': 'error',
    'no-floating-decimal': 'error',
    'no-global-assign': 'error',
    'no-implied-eval': 'error',
    'no-iterator': 'error',
    'no-labels': 'error',
    'no-lone-blocks': 'error',
    'no-loop-func': 'error',
    'no-multi-str': 'error',
    'no-new': 'error',
    'no-new-func': 'error',
    'no-new-wrappers': 'error',
    'no-octal': 'error',
    'no-octal-escape': 'error',
    'no-param-reassign': ['error', { props: false }],
    'no-proto': 'error',
    'no-redeclare': 'error',
    'no-return-assign': 'error',
    'no-script-url': 'error',
    'no-self-assign': 'error',
    'no-self-compare': 'error',
    'no-sequences': 'error',
    'no-throw-literal': 'error',
    'no-unmodified-loop-condition': 'error',
    'no-unused-expressions': 'error',
    'no-unused-labels': 'error',
    'no-useless-call': 'error',
    'no-useless-concat': 'error',
    'no-useless-escape': 'error',
    'no-void': 'error',
    'no-warning-comments': 'warn',
    'no-with': 'error',
    'prefer-promise-reject-errors': 'error',
    radix: 'error',
    'require-await': 'error',
    'wrap-iife': ['error', 'inside'],
    yoda: 'error',

    // Variables
    'no-catch-shadow': 'error',
    'no-delete-var': 'error',
    'no-label-var': 'error',
    'no-restricted-globals': ['error', 'event', 'fdescribe'],
    'no-shadow': 'error',
    'no-shadow-restricted-names': 'error',
    'no-undef': 'error',
    'no-undef-init': 'error',
    'no-undefined': 'off',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],

    // Stylistic Issues (handled by Prettier)
    // 'prettier/prettier' is already defined at the top of the rules

    // Disable formatting rules that conflict with Prettier
    semi: 'off',
    quotes: 'off',
    'comma-dangle': 'off',
    'object-curly-spacing': 'off',
    'array-bracket-spacing': 'off',
    'space-in-parens': 'off',
    'no-multiple-empty-lines': 'off',
    'eol-last': 'off',
    'space-before-function-paren': 'off',
    'space-before-blocks': 'off',
    'padded-blocks': 'off',
    indent: 'off',
    'keyword-spacing': 'off',
    'space-infix-ops': 'off',
    'comma-spacing': 'off',
    'brace-style': 'off',
    'no-multi-spaces': 'off',
    'key-spacing': 'off',
    'arrow-spacing': 'off',
  },
};
