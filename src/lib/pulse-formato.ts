// Pulse (ADR-0119): tradução do jargão do ML para a linguagem do operador. Puro, sem I/O.
import type { PulseProduto } from './pulse';
import type { MotivoQualificacao, StatusQualificacao } from '../../supabase/functions/_shared/concorrencia/qualificacao';

export type Tom = 'neutro' | 'ok' | 'atencao' | 'risco';

export interface Selo {
  texto: string;
  tom: Tom;
  /** Explicação no title/tooltip — o operador não precisa decorar o vocabulário do ML. */
  ajuda?: string;
}

/**
 * Por que a coluna "Seu preço" está vazia. Célula financeira em branco sem motivo lê como tela
 * quebrada; e o motivo é acionável — "sem vínculo" tem conserto, "pausado" não é problema.
 * O preço vem da nossa oferta na ficha, então some junto com ela.
 */
export function motivoSemPrecoProprio(
  p: Pick<PulseProduto,
    'origem' | 'catalogo_status' | 'ultimo_snapshot_em' | 'meu_preco_em' | 'anuncio_status' | 'anuncio_sub_status'>,
): string {
  if (p.origem === 'manual') return 'Ficha adicionada para pesquisa — você não vende este produto.';
  if (!p.ultimo_snapshot_em) return 'Ainda sem a primeira coleta.';
  // Preço nunca lido ainda: cada execução tem teto de produtos, então uma sobra fica para o ciclo
  // seguinte. Sem esta trava, esses produtos seriam anunciados como "pausados" — afirmação sobre
  // o anúncio a partir de uma leitura que não aconteceu.
  if (!p.meu_preco_em) return 'Preço ainda não lido do Mercado Livre — aguarde a próxima coleta.';
  // Situação real do anúncio, quando conhecida, vence qualquer dedução: some da ficha tanto quem
  // está pausado quanto quem perdeu o vínculo, e "sem estoque" e "em moderação" são problemas
  // diferentes com a mesma aparência.
  if (p.anuncio_status && p.anuncio_status !== 'active') {
    if (p.anuncio_sub_status?.includes('out_of_stock')) {
      return 'Seu anúncio está pausado no Mercado Livre por estoque zerado — repor o estoque o reativa.';
    }
    if (pausaPreventiva(p.anuncio_sub_status)) {
      return 'Seu anúncio está pausado preventivamente pelo Mercado Livre — não é moderação; reative-o em Publicados.';
    }
    return `Seu anúncio não está à venda no Mercado Livre (situação: ${p.anuncio_status}).`;
  }
  if (p.catalogo_status && p.catalogo_status !== 'vinculado') {
    return 'Seu anúncio não está vinculado a esta ficha, então não aparece entre as ofertas dela.';
  }
  return 'Seu anúncio não está entre as ofertas ativas da ficha.';
}

/** Pausa preventiva do ML — ver PREVENTIVA_SUBS em supabase/functions/_shared/ml/status.ts. */
function pausaPreventiva(sub: string[] | null | undefined): boolean {
  return !!sub?.includes('suspended_for_prevention');
}

/** Etiqueta da situação do anúncio no ML, para a lista. `null` quando está tudo normal (ativo). */
export function seloAnuncio(
  p: Pick<PulseProduto, 'anuncio_status' | 'anuncio_sub_status'>,
): Selo | null {
  if (!p.anuncio_status || p.anuncio_status === 'active') return null;
  if (p.anuncio_sub_status?.includes('out_of_stock')) {
    return { texto: 'Sem estoque', tom: 'atencao', ajuda: 'Anúncio pausado no Mercado Livre por estoque zerado.' };
  }
  if (p.anuncio_status === 'paused') {
    return { texto: 'Pausado no ML', tom: 'atencao', ajuda: 'Anúncio pausado no Mercado Livre.' };
  }
  // O ML devolve `under_review` na pausa preventiva; o Pulse guarda o status cru, então a
  // distinção que `parseStatusML` faz (ADR-0035, adendo 25/08) precisa existir aqui também —
  // senão pausa administrativa aparece como "Fora do ar".
  if (pausaPreventiva(p.anuncio_sub_status)) {
    return { texto: 'Pausado no ML', tom: 'atencao', ajuda: 'Pausa preventiva do Mercado Livre (não é moderação).' };
  }
  return { texto: 'Fora do ar', tom: 'risco', ajuda: `Situação do anúncio no ML: ${p.anuncio_status}.` };
}

// Escala de preço frente à referência, do mais barato ao mais caro. Os estados de Markdown ficam
// de fora de propósito: "promoção agendada" não é uma posição de preço e ordená-la entre as
// outras inventaria uma comparação que o ML não fez.
/** Tipo de anúncio do ML na linguagem do vendedor. */
export function tipoAnuncio(tier: string | null): string {
  if (!tier) return '—';
  if (tier.includes('gold_pro')) return 'Premium';
  if (tier.includes('gold_special')) return 'Clássico';
  if (tier.includes('gold')) return 'Ouro';
  if (tier.includes('silver') || tier.includes('bronze') || tier.includes('free')) return 'Grátis';
  return 'Outro'; // tipo novo do ML não vira jargão de API na tela
}

/** Reputação do vendedor. Sem selo o ML devolve null — mostrar "—·" antes do volume é ruído. */
export function reputacao(powerSeller: string | null): string | null {
  if (!powerSeller) return null;
  const mapa: Record<string, string> = { gold: 'MercadoLíder Gold', platinum: 'MercadoLíder Platinum', silver: 'MercadoLíder Silver' };
  return mapa[powerSeller] ?? 'MercadoLíder';
}

/** Traduções estáveis dos códigos da regra compartilhada de qualificação. */
export function rotuloStatusQualificacao(status: StatusQualificacao): string {
  const rotulos: Record<StatusQualificacao, string> = {
    relevante: 'Relevante',
    observacao: 'Em observação',
    fora_referencia: 'Fora da referência',
  };
  return rotulos[status];
}

/** Traduções estáveis dos códigos da regra compartilhada de qualificação. */
export function rotuloMotivoQualificacao(motivo: MotivoQualificacao): string {
  const rotulos: Record<MotivoQualificacao, string> = {
    QUALIFICADO: 'Qualificado',
    DADOS_INSUFICIENTES: 'Dados insuficientes',
    POUCAS_TRANSACOES: 'Poucas transações',
    SEM_VISITAS_30D: 'Sem visitas nos últimos 30 dias',
    REPUTACAO_BAIXA: 'Reputação baixa',
  };
  return rotulos[motivo];
}

/** Cor consolidada da reputação do vendedor, sem vazar o identificador do Mercado Livre. */
export function rotuloReputacao(nivel: string | null): string {
  const rotulos: Record<string, string> = {
    '5_green': 'Reputação verde',
    '4_light_green': 'Reputação verde-clara',
    '3_yellow': 'Reputação amarela',
    '2_orange': 'Reputação laranja',
    '1_red': 'Reputação vermelha',
  };
  return nivel ? rotulos[nivel] ?? 'Reputação não informada' : 'Reputação não informada';
}

export interface Posicao {
  /** Diferença do nosso preço para o menor concorrente, em %. Negativo = estamos mais baratos. */
  deltaPct: number;
  texto: string;
  tom: Tom;
}

/**
 * Onde estamos em relação ao menor concorrente. É a leitura que decide reprecificar — por isso
 * vira coluna própria em vez de ficar escondida no detalhe.
 */
export function posicaoVsMercado(meuPreco: number | null, menorConcorrente: number | null): Posicao | null {
  if (meuPreco == null || menorConcorrente == null || menorConcorrente <= 0) return null;
  const deltaPct = ((meuPreco - menorConcorrente) / menorConcorrente) * 100;
  if (Math.abs(deltaPct) < 0.5) return { deltaPct, texto: 'Empatado', tom: 'neutro' };
  // "mais barato" já carrega o sinal; o "-" na frente leria como negação da frase.
  if (deltaPct < 0) return { deltaPct, texto: `${Math.abs(deltaPct).toFixed(0)}% mais barato`, tom: 'ok' };
  return {
    deltaPct,
    texto: `+${deltaPct.toFixed(0)}% mais caro`,
    tom: deltaPct >= 15 ? 'risco' : 'atencao',
  };
}

/** Classe do badge por tom — mesma paleta semântica do resto do app. */
export function classeTom(tom: Tom): string {
  switch (tom) {
    case 'ok': return 'border-success/30 bg-success/10 text-success';
    case 'atencao': return 'border-warning/30 bg-warning/10 text-warning';
    case 'risco': return 'border-destructive/30 bg-destructive/10 text-destructive';
    default: return 'border-border bg-muted/50 text-muted-foreground';
  }
}
