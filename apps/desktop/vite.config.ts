import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';

/**
 * Копирует hand-written CommonJS preload (electron/preload.cjs) в
 * dist-electron/preload.cjs. Минует vite-plugin-electron, который упорно
 * собирает preload как ESM-wrapped, что ломает Electron sandbox.
 */
function copyPreloadPlugin(): Plugin {
  const files = [
    ['electron/preload.cjs', 'dist-electron/preload.cjs'],
    // §wave — preload guest webview SoundCloud (sendToHost OAuth URL)
    ['electron/wave-guest-preload.cjs', 'dist-electron/wave-guest-preload.cjs'],
  ] as const;
  const copy = () => {
    mkdirSync(resolve(__dirname, 'dist-electron'), { recursive: true });
    for (const [from, to] of files) {
      copyFileSync(resolve(__dirname, from), resolve(__dirname, to));
    }
  };
  return {
    name: 'pyn:copy-preload',
    buildStart() {
      copy();
    },
    configureServer(server) {
      copy();
      for (const [from] of files) {
        const abs = resolve(__dirname, from);
        server.watcher.add(abs);
      }
      server.watcher.on('change', (file) => {
        if (files.some(([from]) => file === resolve(__dirname, from))) copy();
      });
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: command === 'serve',
            rollupOptions: {
              // electron — Node API, оставляем external. `ws` — pure JS, его
              // бандлим inline; его optional native deps (bufferutil,
              // utf-8-validate) глушим через resolve.alias ниже на пустой stub,
              // т.к. vite-plugin-electron делает несколько rollup-проходов и
              // `external`-флаг не подхватывается всеми из них.
              // uiohook-napi — native .node, не бандлить (подгружается из node_modules)
              external: ['electron', 'uiohook-napi'],
            },
          },
          resolve: {
            alias: {
              bufferutil: resolve(__dirname, 'electron/stubs/empty.cjs'),
              'utf-8-validate': resolve(__dirname, 'electron/stubs/empty.cjs'),
            },
          },
        },
      },
    ]),
    copyPreloadPlugin(),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Те же stub-aliases повторно в renderer config — на случай, если ws
      // куда-то пробрался в renderer bundle.
      bufferutil: resolve(__dirname, 'electron/stubs/empty.cjs'),
      'utf-8-validate': resolve(__dirname, 'electron/stubs/empty.cjs'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
}));
