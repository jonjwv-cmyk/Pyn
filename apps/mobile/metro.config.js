// Metro config с поддержкой pnpm monorepo workspaces.
// Без этого RN не находит symlinked packages/core.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Смотрим в workspace для shared packages.
config.watchFolders = [workspaceRoot];

// Apps/mobile использует node-linker=hoisted (см. .npmrc) — плоский
// node_modules. Workspace root остаётся pnpm-strict (он не для RN).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Включаем hierarchical lookup — RN/Expo пакеты делают require() с относительными
// путями (например expo/src/Expo.ts require'aет 'expo-modules-core'), Metro
// должен подниматься по дереву узлов чтобы найти.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
