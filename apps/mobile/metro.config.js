const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The web workspace uses React 18. Pin Metro's React resolution to the native
// app's React 19 so hoisted packages share the renderer's React instance.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.resolve(__dirname, 'node_modules/react'),
};

module.exports = config;
