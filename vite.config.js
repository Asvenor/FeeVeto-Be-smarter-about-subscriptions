import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, import.meta.dirname, '');
  const publishableKey = environment.VITE_CLERK_PUBLISHABLE_KEY || environment.CLERK_PUBLISHABLE_KEY || '';

  return {
    base: './',
    plugins: [{
      name: 'feeveto-public-metadata',
      generateBundle() {
        for (const fileName of ['robots.txt', 'sitemap.xml']) {
          this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(import.meta.dirname, fileName), 'utf8') });
        }
      },
    }],
    define: {
      __FEEVETO_CLERK_PUBLISHABLE_KEY__: JSON.stringify(publishableKey),
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          privacy: resolve(import.meta.dirname, 'privacy.html'),
        },
      },
    },
  };
});
