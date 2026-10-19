import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The ONNX Runtime version that is bundled with the installed
 * `@huggingface/transformers`, used to build the CDN fallback URL.
 */
function ortVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), 'node_modules', 'onnxruntime-web', 'package.json'), 'utf8'),
    );
    return pkg.version as string;
  } catch {
    return '1.31.0';
  }
}

/**
 * `onnxruntime-web` references its WASM binary with
 * `new URL('...wasm', import.meta.url)`, which makes Vite emit a ~27 MB copy of
 * the binary into `dist/`.
 *
 * The app always points ONNX Runtime at the locally hosted sidecar
 * (`public/local/runtime/ort-wasm-simd-threaded.asyncify.wasm`), so the
 * bundled copy is never fetched. This plugin rewrites the reference to the
 * public CDN URL that Transformers.js itself would use, which keeps the build
 * small without changing the runtime behaviour.
 */
function dropBundledOrtWasm(): Plugin {
  const version = ortVersion();
  const cdn = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist`;
  return {
    name: 'embed-anything:drop-bundled-ort-wasm',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('onnxruntime-web') && !id.includes('@huggingface/transformers')) return null;
      const pattern = /new URL\((["'])ort-wasm-simd-threaded[^"']*\.wasm\1,\s*import\.meta\.url\)\.href/g;
      const matches = code.match(pattern);
      if (!matches) return null;
      pattern.lastIndex = 0;
      const replaced = code.replace(pattern, JSON.stringify(`${cdn}/ort-wasm-simd-threaded.asyncify.wasm`));
      return { code: replaced, map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), dropBundledOrtWasm()],
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      // Required for SharedArrayBuffer / threaded ONNX Runtime WASM.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  worker: {
    format: 'es',
    // The worker bundle is built separately, so the plugin has to be listed
    // here as well.
    plugins: () => [dropBundledOrtWasm()],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@huggingface/transformers')) return 'transformers';
          if (id.includes('node_modules/react')) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
