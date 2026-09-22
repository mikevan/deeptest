// Bundles the extension into dist/extension.js and copies the two wasm files
// beside it. web-tree-sitter locates its runtime wasm at load time, so the
// extension passes an absolute path (see src/engine/depth/treeSitter.ts).
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// web-tree-sitter ships ESM and CJS builds. Its ESM build uses import.meta.url,
// which is undefined inside a CommonJS bundle, so point the bundler at the CJS
// file directly. The package's exports map hides it from a plain alias.
const treeSitterCjs = {
  name: 'web-tree-sitter-cjs',
  setup(build) {
    build.onResolve({ filter: /^web-tree-sitter$/ }, () => ({
      path: fileURLToPath(new URL('./node_modules/web-tree-sitter/web-tree-sitter.cjs', import.meta.url)),
    }));
  },
};


const watch = process.argv.includes('--watch');

// Stamp the product name and build number into the titles VS Code shows for
// the side panel. The container's title is what a person reads in the panel
// header, and it can only come from package.json, so it is written here.
//
// Corrected 2026-09-19: the older note here claimed the view's own title is
// hidden and that neither title can change at run time. Neither is true. The
// extension used to set view.title in resolveWebviewView, and VS Code rendered
// the container's title and that one joined by a colon, so the header read
// "DeepTest - Polyglot 1.0.10: DeepTest 1.0.10". The run-time assignment is
// gone; this is now the only place either title is set.
{
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const stamped = `DeepTest - Polyglot ${pkg.version}`;
  const container = pkg.contributes.viewsContainers.activitybar[0];
  const view = pkg.contributes.views.deeptest[0];
  if (container.title !== stamped || view.name !== stamped || view.contextualTitle !== stamped) {
    container.title = stamped;
    view.name = stamped;
    view.contextualTitle = stamped;
    writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

mkdirSync('dist', { recursive: true });
copyFileSync('node_modules/web-tree-sitter/web-tree-sitter.wasm', 'dist/web-tree-sitter.wasm');
// Emptied first, not just written into. Twice now a file that stopped being
// a hook has stayed in dist/hooks from an earlier build and shipped in the
// package, where nothing references it and nobody would notice.
rmSync('dist/hooks', { recursive: true, force: true });
mkdirSync('dist/hooks', { recursive: true });
// Every hook ships from the Witness package: the runtime, the loaders, the
// Vite plugin, the Jest transformer, the Karma plugin and its client, the
// Playwright hook and fixture, the Mocha boundary, and the bundled
// instrumenter. DeepTest has none of its own since 1.0.17. The library's
// index is bundled into extension.js, so its hooksDir() is dist/hooks.
const witnessHooks = 'node_modules/@projectrevivesolutions/witness/dist/hooks';
for (const file of readdirSync(witnessHooks)) {
  copyFileSync(`${witnessHooks}/${file}`, `dist/hooks/${file}`);
}
for (const file of readdirSync('vendor')) {
  if (file.endsWith('.wasm')) {
    copyFileSync(`vendor/${file}`, `dist/${file}`);
  }
}

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  plugins: [treeSitterCjs],
  sourcemap: true,
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
