import { defineConfig, loadEnv, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Manifest gerado por modo (ADR-0189 D-14): o build de desenvolvimento aceita a sessão também
// do app local. A lista de origens do SW é lida do próprio manifest (`chrome.runtime.getManifest`),
// então código e manifest nunca divergem.
function manifest(mode: string): Plugin {
  return {
    name: 'publiai-manifest',
    generateBundle() {
      const m = JSON.parse(readFileSync(path.resolve(__dirname, 'manifest.json'), 'utf8'));
      if (mode === 'development') m.externally_connectable.matches.push('http://localhost:5173/*');
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(m, null, 2) });
    },
  };
}

export default defineConfig(({ mode }) => {
  // .env.local/.env.test vivem na raiz do repo (mesmos nomes do app web).
  const env = loadEnv(mode, path.resolve(__dirname, '..'), 'VITE_');
  if (mode !== 'test' && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) {
    // ponytail: não reprova o build (o CI não tem .env.local); a chamada falha em runtime.
    console.warn('[extensao] VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY ausentes: a extensão não chamará o servidor.');
  }
  return {
    envDir: '..',
    resolve: {
      alias: { '@margem': path.resolve(__dirname, '../supabase/functions/_shared/extensao/margem.ts') },
    },
    plugins: [manifest(mode)],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      modulePreload: false,
      rollupOptions: {
        input: {
          sw: path.resolve(__dirname, 'src/sw.ts'),
          painel: path.resolve(__dirname, 'src/painel/index.html'),
        },
        // Chrome recusa arquivo/pasta com prefixo `_` na extensão: nomes fixos sem `[name]` em chunks.
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/c-[hash].js',
          assetFileNames: 'assets/a-[hash][extname]',
        },
      },
    },
  };
});
