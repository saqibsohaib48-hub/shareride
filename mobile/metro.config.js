// Monorepo: let Metro see the shared package outside this folder.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../packages/shared');
const config = getDefaultConfig(projectRoot);
config.watchFolders = [sharedRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.extraNodeModules = { '@share-ride/shared': sharedRoot };
module.exports = config;
