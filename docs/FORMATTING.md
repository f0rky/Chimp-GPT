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

## Automatic Formatting

The project is set up with the following tools to automate code formatting:

1. **Husky**: Manages Git hooks to run checks before commits
2. **lint-staged**: Runs linters and formatters on staged files
3. **ESLint with Prettier integration**: Ensures code quality and consistent formatting

### Pre-commit Hooks

When you commit changes, the pre-commit hook will automatically:

1. Run Prettier on all staged files
2. Run ESLint with auto-fix on staged files
3. Prevent the commit if there are any errors that can't be automatically fixed

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
