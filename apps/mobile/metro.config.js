// Metro config с поддержкой pnpm monorepo workspaces.
// Без этого RN не находит symlinked packages/core.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Смотрим в workspace для shared packages.
config.watchFolders = [workspaceRoot];

// pnpm уплотняет node_modules в одну папку — указываем metro где искать.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
