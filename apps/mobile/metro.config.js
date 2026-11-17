// The monorepo hoists React 19 (for the Next.js admin) to the root, while
// Expo SDK 52 / React Native 0.76 must run React 18. Packages hoisted to the
// root (react-native, expo-router, ...) would otherwise resolve the root
// React 19 and crash at runtime with a renderer mismatch. Force every
// `react` import in the bundle to this app's own copy.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

const reactDir = path.dirname(
  require.resolve("react/package.json", { paths: [projectRoot] }),
);

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react" || moduleName.startsWith("react/")) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(reactDir, "index.js") },
      moduleName,
      platform,
    );
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
