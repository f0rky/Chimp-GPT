const globals = require('globals');
const js = require('@eslint/js');
const prettier = require('eslint-plugin-prettier');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  // Global ignores
  {
    ignores: [
      '**/node_modules/',
      'dist/',
      'build/',
      'coverage/',
      'logs/',
      '**/*.log',
      '**/npm-debug.log*',
      '**/yarn-debug.log*',
      '**/yarn-error.log*',
      '**/.env',
      '**/.env.*',
      '**/.vscode/',
      '**/.idea',
      '**/.DS_Store',
      '**/*.suo',
      '**/*.ntvs*',
      '**/*.njsproj',
      '**/*.sln',
      '**/*.sw?',
      '**/._*',
      '**/.Spotlight-V100',
      '**/.Trashes',
      '**/ehthumbs.db',
      '**/Thumbs.db',
      'archive/',
      'docs/',
      'public/dashboard/',
      '**/*.md',
      '**/*.css',
      'public/*.css',
      '**/data/',
      '**/*.json',
      '**/*.jsonl',
      'tests/',
      '**/*.test.js',
      '**/*.spec.js',
      '**/*.config.js',
      '**/*.conf.js',
      '**/*.min.js',
      '**/.nyc_output/',
      '**/.next/',
      '**/.cache/',
      '**/.temp/',
      '**/.tmp/',
      '**/.vercel/',
      '**/.netlify/',
    ],
  },

  // Base configuration for all files
  js.configs.recommended,
  prettierConfig,
  {
    plugins: {
      prettier,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.commonjs,
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      // Prettier integration
      'prettier/prettier': ['error', {}, { usePrettierrc: true }],

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
      'no-label-var': 'error',
      'no-restricted-globals': ['error', 'event', 'fdescribe'],
      'no-shadow': 'error',
      'no-shadow-restricted-names': 'error',
      'no-undef': 'error',
      'no-undef-init': 'error',
      'no-undefined': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],

      // Node.js and CommonJS
      'no-var': 'error',
      'prefer-const': 'error',

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
  },

  // Node.js specific rules (excluding browser and test files)
  {
    files: ['**/*.js'],
    ignores: ['public/**/*.js', '**/*.test.js'],
    languageOptions: {
      sourceType: 'script',
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
      'require-await': 'off',
      // Allow redeclaring performance from perf_hooks in Node.js
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },

  // Browser specific rules
  {
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Custom browser globals
        Chart: 'readonly',
        $: 'readonly',
        jQuery: 'readonly',
        process: 'readonly',
      },
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
      'no-undef': 'warn',
    },
  },

  // Test files
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
      },
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
      'require-await': 'error',
    },
  },
];
