import type { ValorComProveniencia } from '../_shared/ml/proveniencia.ts';

/** 429/5xx ou falha de rede: o ML devolve `local_rate_limited` sob rajada (calculadora + tabela de frete). */
const TRANSITORIO = /\(HTTP (429|5\d\d)\)|não respondeu o frete/;

/**
 * Frete com retentativa só em falha transitória (mesmo padrão de `buscarListingPriceComRetentativa`).
 * `buscarFreteVendedorComProveniencia` não lança — falha vira `estimated` com `motivo` —, então a
 * detecção é pelo motivo. Esgotou → devolve a última resposta (a tela mostra frete desconhecido).
 * ponytail: local à calculadora; mover para `_shared` exige redeployar os 6 importadores do helper.
 */
export async function freteComRetentativa(
  buscar: () => Promise<ValorComProveniencia<number>>,
  esperasMs: number[] = [1000, 3000],
  dormir: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<ValorComProveniencia<number>> {
  for (let tentativa = 0; ; tentativa++) {
    const resp = await buscar();
    const transitorio = resp.proveniencia === 'estimated' && TRANSITORIO.test(resp.motivo ?? '');
    if (!transitorio || tentativa >= esperasMs.length) return resp;
    await dormir(esperasMs[tentativa]);
  }
}
