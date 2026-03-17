// All openclaw pruning is now handled by openclaw-runtime/prune-runtime-paths.mjs
// via explicit path targets. This avoids blanket glob patterns that silently break
// runtime-required files (extensions/*/src/, docs/reference/templates/, etc.).
export async function pruneOpenclawPackage(_nodeModulesRoot) {
  // no-op — see openclaw-runtime/prune-runtime-paths.mjs
}
