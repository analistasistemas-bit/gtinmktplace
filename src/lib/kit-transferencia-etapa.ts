// ADR-0200 (adendo 08/11): etapa da saga de transferência de kit em linguagem simples, para Publicados e Gerenciar
// kit. A ordem é a do worker (`PassoSaga` em supabase/functions/_shared/kit-variacao/saga.ts); `fim` não conta passo.

const ORDEM = [
  'pausar', 'aguardar', 'conciliar', 'calcular', 'reduzir', 'confirmar_reducao', 'aumentar', 'confirmar_aumento', 'reativar',
] as const;
export const TOTAL_PASSOS = ORDEM.length;

export interface EtapaEntrada {
  tipo: string;
  estado: string;
  passo: string;
  /** Fim da quarentena: último `passo1_em` dos alvos + T. Nulo antes do passo 1. */
  quarentenaAte?: string | null;
  /** Algum alvo é SKU de kit novo (o `aumentar` é o CREATE do anúncio). */
  criacao?: boolean;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function etapaTransferencia(t: EtapaEntrada, agoraMs: number): { numero: number | null; total: number; rotulo: string } {
  const desmontar = t.tipo === 'desmontar';
  const kit = t.tipo === 'montar' || t.tipo === 'repor';
  const rotulos: Record<string, string> = {
    pausar: t.criacao ? 'Pausando os anúncios das peças' : 'Pausando os anúncios das peças e do kit',
    aguardar: 'Aguardando 5 min de segurança',
    conciliar: 'Conferindo vendas',
    calcular: 'Calculando o novo estoque',
    reduzir: desmontar ? 'Tirando o estoque do kit' : 'Ajustando o estoque das peças',
    confirmar_reducao: 'Conferindo o estoque no Mercado Livre',
    aumentar: t.criacao ? 'Criando o anúncio do kit no Mercado Livre'
      : desmontar ? 'Devolvendo as peças aos anúncios individuais'
        : kit ? 'Colocando o estoque no kit' : 'Ajustando o estoque no Mercado Livre',
    confirmar_aumento: 'Conferindo o novo estoque no Mercado Livre',
    reativar: 'Reativando os anúncios',
  };
  if (t.passo === 'fim') return { numero: TOTAL_PASSOS, total: TOTAL_PASSOS, rotulo: 'Concluído' };
  const i = (ORDEM as readonly string[]).indexOf(t.passo);
  if (i < 0) return { numero: null, total: TOTAL_PASSOS, rotulo: 'Em andamento' };
  let rotulo = rotulos[t.passo];
  if (t.passo === 'aguardar' && t.quarentenaAte) {
    const resta = Math.ceil((Date.parse(t.quarentenaAte) - agoraMs) / 1000);
    if (resta > 0) rotulo += ` (faltam ${mmss(resta)})`;
  }
  return { numero: i + 1, total: TOTAL_PASSOS, rotulo };
}

/**
 * Fim da quarentena a partir do último `passo1_em`. ponytail: T fixo em 300 s, o padrão de `quarentenaDoEnv`; o front
 * não lê `KIT_QUARENTENA_S` (não definida em produção em 08/11). Se ela mudar, a contagem passa a mentir: expor T na
 * transferência.
 */
export function quarentenaAte(passo1: Array<string | null | undefined>): string | null {
  const ms = passo1.map((p) => (p ? Date.parse(p) : NaN)).filter((n) => !Number.isNaN(n));
  return ms.length ? new Date(Math.max(...ms) + 300_000).toISOString() : null;
}
