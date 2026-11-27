// Expo's defaults. They find the workspace root and its node_modules on their own.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
