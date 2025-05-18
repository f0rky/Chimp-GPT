module.exports = {
  root: true,
  env: {
    browser: true,
    es6: true
  },
  extends: ["eslint:recommended"],
  globals: {
    Chart: "readonly"
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module"
  },
  rules: {
    "no-unused-vars": "warn"
  }
};
