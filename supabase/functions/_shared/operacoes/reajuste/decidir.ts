// I5 C3 — decisão pura por item conforme a etapa gravada. Conferência (escrita_pedida) só lê, nunca reescreve.
import { centavos } from './alvo.ts';
import type { Etapa } from './tipos.ts';

export type Vivo = { kind: 'ok'; preco: number; todasIguais: boolean; composicao: string[] | null } | { kind: 'falhou' };
export type DecisaoReajuste = { tipo: 'persistir' } | { tipo: 'escrever' } | { tipo: 'voltar_pendente' }
  | { tipo: 'fim'; status: 'mudou' | 'erro' | 'conferindo'; mensagem: string };

/** Composição como conjunto (ordem não importa); null só é igual a null. */
function mesmaComposicao(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
}

export function decidirReajuste(
  etapa: Etapa, alvo: number, anterior: number, vivo: Vivo, composicaoEsperada: string[] | null,
): DecisaoReajuste {
  if (etapa === 'ml_confirmado') return { tipo: 'persistir' };
  if (etapa === 'escrita_pedida') {
    if (vivo.kind === 'falhou') return { tipo: 'fim', status: 'conferindo', mensagem: 'Aguardando confirmação do ML' };
    if (!mesmaComposicao(vivo.composicao, composicaoEsperada)) {
      return { tipo: 'fim', status: 'erro', mensagem: 'Variações do anúncio mudaram durante o reajuste' };
    }
    const p = centavos(vivo.preco);
    if (vivo.todasIguais && p === centavos(alvo)) return { tipo: 'persistir' };
    if (vivo.todasIguais && p === centavos(anterior)) return { tipo: 'voltar_pendente' };
    return { tipo: 'fim', status: 'erro', mensagem: 'Preço alterado por terceiros durante o reajuste' };
  }
  if (vivo.kind === 'falhou') return { tipo: 'fim', status: 'erro', mensagem: 'Não foi possível ler o anúncio' };
  if (!mesmaComposicao(vivo.composicao, composicaoEsperada)) {
    return { tipo: 'fim', status: 'mudou', mensagem: 'Variações do anúncio mudaram — refaça o preview' };
  }
  if (!vivo.todasIguais || centavos(vivo.preco) !== centavos(anterior)) {
    return { tipo: 'fim', status: 'mudou', mensagem: 'O preço mudou desde o preview' };
  }
  return { tipo: 'escrever' };
}
