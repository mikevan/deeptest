// Bundles the extension into dist/extension.js and copies the two wasm files
// beside it. web-tree-sitter locates its runtime wasm at load time, so the
// extension passes an absolute path (see src/engine/depth/treeSitter.ts).
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// Stamp the build number into the titles VS Code shows for the side panel.
// When a container holds one view, VS Code puts the container's title in the
// panel header and hides the view's own title, and neither can change at
// run time. So the version goes into package.json at build time; every build
// bumps the version first, so the header always names the build it came from.
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
mkdirSync('dist/hooks', { recursive: true });
for (const file of readdirSync('hooks')) {
  copyFileSync(`hooks/${file}`, `dist/hooks/${file}`);
}
// The Witness hooks (runtime, loaders, Vite plugin, Playwright hook and
// fixture, Mocha boundary, and the bundled instrumenter) come from the
// library and ship beside DeepTest's own hooks. The library's index is
// bundled into extension.js, so its hooksDir() is dist/hooks at runtime.
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
