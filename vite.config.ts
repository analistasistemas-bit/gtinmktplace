import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { pwaConfig } from './pwa.config';

// O virtual module do vite-plugin-pwa vaza no vitest (mergeConfig importa este arquivo) e o
// builder do Storybook também carrega este vite.config.ts — em nenhum dos dois casos o service
// worker faz sentido. process.env.VITEST é setado pelo próprio vitest; npm_lifecycle_event cobre
// os scripts "storybook" e "build-storybook".
const rodandoTestesOuStorybook =
  process.env.VITEST !== undefined || process.env.npm_lifecycle_event?.includes('storybook');

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(rodandoTestesOuStorybook ? [] : [VitePWA(pwaConfig)]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
