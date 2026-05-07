import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
function readGitHash() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

// Vite plugin that injects the current package version + git hash into
// index.html as a meta tag, recomputed on every HTML request in dev so
// new commits show up without restarting the server.
const versionMetaPlugin = {
  name: 'inject-version-meta',
  transformIndexHtml() {
    const content = `${pkg.version}|${readGitHash()}`;
    return [{ tag: 'meta', attrs: { name: 'app-version', content }, injectTo: 'head' }];
  },
};

export default defineConfig({
  root: '.',
  base: process.env.NODE_ENV === 'production' ? '/FontMaker/' : '/',
  build: {
    outDir: 'dist',
  },
  plugins: [versionMetaPlugin],
});
