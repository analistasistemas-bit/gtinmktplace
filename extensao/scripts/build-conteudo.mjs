// Content scripts MV3 não são módulos ES: cada um vira um IIFE autocontido (rollup só aceita 1 entrada por IIFE).
// Roda depois do `vite build` principal (que esvazia dist/).
import { build } from 'vite';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const mode = process.argv[2] ?? 'production';

for (const nome of ['anuncio', 'busca-ean', 'busca']) {
  await build({
    root: raiz,
    mode,
    configFile: false,
    envDir: path.resolve(raiz, '..'),
    logLevel: 'warn',
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: { entry: path.resolve(raiz, `src/conteudo/${nome}.ts`), formats: ['iife'], name: `publiai_${nome.replace('-', '_')}`, fileName: () => `${nome}.js` },
    },
  });
}
