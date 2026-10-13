module.exports = {
  root: true,
  extends: ["universe/native", "universe/shared/typescript"],
  ignorePatterns: ["node_modules/", "android/", "ios/", "backups/", "src.backup.*/", ".expo/"],
  env: {
    jest: true
  },
  rules: {
    "prettier/prettier": "off",
    "import/no-duplicates": "off"
  },
  overrides: [
    {
      files: ["*.config.js", ".eslintrc.js", "scripts/**/*.js", "remove-light-layer.js"],
      env: {
        node: true
      }
    }
  ]
};
