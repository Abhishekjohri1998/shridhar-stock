/**
 * Metro has to be told about the workspace: the app lives in app/ but imports
 * @stock/core from the repo root, and its dependencies are hoisted to the root
 * node_modules. Without watchFolders it will not see changes in shared; without
 * nodeModulesPaths it will not resolve the hoisted packages.
 */
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Two copies of React would break hooks, so resolution never walks up past those two.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
