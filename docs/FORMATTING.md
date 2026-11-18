# Code Formatting Guidelines

ChimpGPT uses Prettier and ESLint to maintain consistent code style and quality across the codebase.

## Prettier Configuration

The project uses Prettier with the following configuration:

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "bracketSpacing": true,
  "arrowParens": "avoid",
  "endOfLine": "lf"
}
```

### Key Style Rules

- Use single quotes for strings
- Use semicolons at the end of statements
- Use 2 spaces for indentation
- Maximum line length of 100 characters
- Include trailing commas in objects and arrays (ES5 compatible)
- Use spaces inside brackets and braces
- Omit parentheses around single arrow function parameters
- Use LF line endings

## Pre-commit Checks

The project uses Husky to run ESLint and Prettier checks before commits.
`lint-staged` is deliberately not used, removing its vulnerable `picomatch`
dependency path without disabling quality checks.

### Pre-commit Hooks

When you commit changes, the pre-commit hook runs:

1. `npm run lint`
2. `npm run format:check`, only if lint succeeds

Either failure rejects the commit. These are non-mutating, whole-repository
checks over the working tree, subject to the existing ESLint/Prettier ignores;
they do not auto-fix, format, stage, or stash files. Unstaged changes can therefore
cause a failure too. Whole-repository checks may take longer than staged-file checks.

To fix formatting, run `npm run format` explicitly, review the resulting diff,
and stage the intended changes before retrying the commit. Dependency auditing
remains available through `npm run security:audit` and the CI security workflow.

## Manual Commands

You can also run formatting commands manually:

- `npm run format`: Format all files in the project
- `npm run format:check`: Check if all files are properly formatted without modifying them
- `npm run lint`: Run ESLint on all files

## Ignoring Files

Some files and directories are excluded from formatting. See `.prettierignore` for the complete list.

## Editor Integration

For the best development experience, install Prettier and ESLint extensions for your code editor:

- **VS Code**:

  - [Prettier - Code formatter](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
  - [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)

- **WebStorm/IntelliJ IDEA**:

  - Prettier and ESLint are supported natively

- **Sublime Text**:
  - [Prettier-Sublime](https://packagecontrol.io/packages/JsPrettier)
  - [SublimeLinter-eslint](https://packagecontrol.io/packages/SublimeLinter-eslint)

## Troubleshooting

If you encounter issues with the pre-commit hook:

1. Make sure you have the latest dependencies: `npm install`
2. Try reinstalling Husky: `npx husky-init && npm install`
3. Check if Git hooks are properly installed: `ls -la .git/hooks/`
