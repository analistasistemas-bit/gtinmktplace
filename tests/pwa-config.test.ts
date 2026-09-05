import { describe, expect, it } from 'vitest';
import type { VitePWAOptions } from 'vite-plugin-pwa';

import { pwaConfig } from '../pwa.config';

// workbox-build (dono do tipo RuntimeCaching) é dependência transitiva, não declarada no
// package.json — derivar o tipo do próprio VitePWAOptions evita importar de um módulo que o
// pnpm não promete resolver.
type WorkboxOptions = NonNullable<VitePWAOptions['workbox']>;
type RuntimeCaching = NonNullable<WorkboxOptions['runtimeCaching']>[number];

// ADR-0153 (D3): o service worker nunca intercepta cross-origin. Resposta autenticada carrega
// dado de um org_id; servir para a conta errada é vazamento entre organizações.

const urlsSupabase = [
  'https://xxxxxxxxxxxxxxxxxxxx.supabase.co/rest/v1/familias?select=*',
  'https://xxxxxxxxxxxxxxxxxxxx.supabase.co/auth/v1/token?grant_type=password',
  'https://xxxxxxxxxxxxxxxxxxxx.supabase.co/storage/v1/object/fotos/00123.jpg',
  'https://xxxxxxxxxxxxxxxxxxxx.supabase.co/functions/v1/ingest-lote',
].map((href) => new URL(href));

// Mesma forma de avaliação que o Workbox usa em runtime para decidir se uma regra intercepta
// uma requisição: string (match exato), RegExp (test) ou função de match.
function regraCasaComUrl(regra: RuntimeCaching, url: URL): boolean {
  const { urlPattern } = regra;
  if (typeof urlPattern === 'function') {
    // `event` é exigido pelo tipo do Workbox, mas a própria doc do Workbox diz que o match não
    // deve depender dele — não existe um FetchEvent real fora do service worker. sameOrigin:
    // false porque toda URL testada aqui é do Supabase, sempre cross-origin do app.
    const params = { url, sameOrigin: false, request: new Request(url) };
    return Boolean(urlPattern(params as Parameters<typeof urlPattern>[0]));
  }
  if (urlPattern instanceof RegExp) return urlPattern.test(url.href);
  return urlPattern === url.href;
}

describe('pwaConfig (ADR-0153)', () => {
  const runtimeCaching = pwaConfig.workbox?.runtimeCaching ?? [];

  it('a trava (regraCasaComUrl) realmente detecta uma regra que interceptaria o Supabase', () => {
    // Prova que o teste abaixo tem dente: uma regra plausível de ser adicionada por engano
    // (cachear qualquer chamada de API) precisa ser pega por regraCasaComUrl.
    const regraIngenua: RuntimeCaching = {
      urlPattern: /^https:\/\/.*\.supabase\.co\/.*/,
      handler: 'NetworkFirst',
    };
    expect(urlsSupabase.some((url) => regraCasaComUrl(regraIngenua, url))).toBe(true);
  });

  it('runtimeCaching está vazio e nenhuma regra casa com URL real do Supabase', () => {
    expect(runtimeCaching).toEqual([]);

    for (const regra of runtimeCaching) {
      for (const url of urlsSupabase) {
        expect(regraCasaComUrl(regra, url), `regra casou com ${url.href}`).toBe(false);
      }
    }
  });

  it('não gera um segundo manifest — site.webmanifest é a fonte única', () => {
    expect(pwaConfig.manifest).toBe(false);
  });

  it('atualização é por aviso, nunca automática (skipWaiting: false, registerType: prompt)', () => {
    expect(pwaConfig.registerType).toBe('prompt');
    expect(pwaConfig.workbox?.skipWaiting).toBe(false);
  });
});
