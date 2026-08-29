/// <reference types="vitest" />
import { defineConfig, mergeConfig } from 'vite';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      // Fuso fixo: as fixtures de janela/KPI são escritas em BRT (ex.: 'T03:00:00.000Z' = 00:00
      // local) e bugs de fuso só aparecem em offset negativo. Sem isso a suíte roda em UTC no CI
      // e não pega o caso que quebrou o "Personalizado".
      env: { TZ: 'America/Sao_Paulo' },
      setupFiles: ['./src/test/setup.ts'],
      include: [
        './tests/**/*.test.{ts,tsx}',
        './src/**/__tests__/**/*.test.{ts,tsx}',
        './supabase/functions/**/__tests__/**/*.test.ts',
        './gateway/__tests__/**/*.test.ts',
        // Os testes da extensão ficam FORA de extensao-ml/: o Chrome recusa carregar uma
        // extensão que contenha pasta iniciada por "_" (nomes reservados), e __tests__ quebrava
        // o "Carregar sem compactação". A pasta da extensão só contém o que vai para o browser.
      ],
    },
  })
);
