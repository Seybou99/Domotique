// Configuration Metro pour le monorepo : sans ces deux réglages, Metro ne
// surveille pas packages/contract et ne résout pas les dépendances hissées
// à la racine du workspace.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// La recherche hiérarchique reste activée : npm workspaces hisse la plupart des
// paquets à la racine, mais certains restent imbriqués (dépendances transitives
// en conflit de version) et Metro doit pouvoir remonter jusqu'à eux.

module.exports = config;
