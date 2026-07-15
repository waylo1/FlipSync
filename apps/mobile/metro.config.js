// Monorepo (Turborepo + npm workspaces) : node_modules hoisté à la racine —
// Metro doit savoir remonter jusque là pour résoudre expo-router et les
// packages @flipsync/* (voir CLAUDE.md, structure monorepo).
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

module.exports = config
