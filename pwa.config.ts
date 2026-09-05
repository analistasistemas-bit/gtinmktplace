import type { VitePWAOptions } from 'vite-plugin-pwa';

// Configuração do vite-plugin-pwa (ADR-0153). Exportada à parte de vite.config.ts para poder
// ser importada por um teste sem carregar o Vite inteiro.
//
// manifest: false — o public/site.webmanifest já existente continua sendo a fonte única de
// nome, ícones e cores (D1). Gerar um segundo manifest criaria duas verdades.
//
// runtimeCaching: [] — regra inviolável do ADR-0153 (D3): o service worker nunca intercepta
// cross-origin. Resposta autenticada carrega dado de um org_id; um cache que não entende RLS
// pode servir para a conta errada. Não existe configuração de cache mais segura do que nenhuma.
export const pwaConfig: Partial<VitePWAOptions> = {
  registerType: 'prompt',
  manifest: false,
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: false,
    navigateFallback: '/index.html',
    runtimeCaching: [],
    // Dimensionado pelos chunks reais do build (pnpm build, 2026-09-05): o maior é
    // index-*.js com ~657 KiB (bundle principal), seguido de campo-*.js com ~506 KiB (three.js
    // da tela de Login), xlsx-*.js ~481 KiB, jspdf.es.min-*.js ~381 KiB e CartesianChart-*.js
    // (recharts) ~319 KiB. Todos ficam abaixo do default do Workbox (2 MiB), mas o default é
    // implícito e Workbox exclui do precache em silêncio quem passar do limite — sem erro no
    // build, só quebra offline em runtime. 3 MiB dá margem para esses chunks crescerem sem
    // reabrir esta conta; se algum chunk novo aproximar do teto, reveja este número.
    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
  },
};
