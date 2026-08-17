// Pulse (ADR-0119): tradução do jargão do ML para a linguagem do operador. Puro, sem I/O.
import type { PulseProduto } from './pulse';

export type Tom = 'neutro' | 'ok' | 'atencao' | 'risco';

export interface Selo {
  texto: string;
  tom: Tom;
  /** Explicação no title/tooltip — o operador não precisa decorar o vocabulário do ML. */
  ajuda?: string;
}

// Os textos abaixo traduzem os status de /suggestions/items/{id}/details exatamente como a
// documentação do ML os define — nada é inferido. O ML compara o preço do anúncio com um "preço
// de referência" próprio (concorrentes internos e externos), que NÃO é o menor preço da ficha:
// por isso um produto pode estar abaixo da referência e ainda assim mais caro que o menor rival.
// https://developers.mercadolivre.com.br/pt_br/referencias-de-precos

/** Posição do preço frente à referência do ML, do mais barato ao mais caro. */
const REFERENCIA: Record<string, Selo> = {
  no_benchmark_lowest: { texto: 'Abaixo da referência', tom: 'ok', ajuda: 'Seu preço está abaixo do preço de referência do Mercado Livre.' },
  no_benchmark_ok: { texto: 'Na referência', tom: 'ok', ajuda: 'Seu preço é igual ao preço de referência do Mercado Livre.' },
  with_benchmark_high: { texto: 'Acima da referência', tom: 'atencao', ajuda: 'Seu preço está alto em relação ao preço de referência do Mercado Livre.' },
  with_benchmark_highest: { texto: 'Acima de todos', tom: 'risco', ajuda: 'Seu preço está acima do preço de referência e acima do maior preço dos concorrentes.' },
};

/** Quando a referência vencedora é do tipo Markdown, o ML devolve o estado da promoção. */
const MARKDOWN: Record<string, Selo> = {
  not_optin_applied: { texto: 'Promoção sugerida', tom: 'atencao', ajuda: 'O Mercado Livre sugere uma promoção para este anúncio, e ela ainda não foi aceita.' },
  promotion_scheduled: { texto: 'Promoção agendada', tom: 'neutro', ajuda: 'A promoção foi aceita e começa na data programada.' },
  promotion_active: { texto: 'Promoção ativa', tom: 'ok', ajuda: 'A promoção está valendo agora.' },
};

/**
 * Selo da coluna "Referência do ML". Sem vínculo de catálogo o ML não calcula referência nenhuma
 * (404 em /suggestions) — dizer isso vale mais que um traço mudo, porque é acionável:
 * resolver a ficha divergente devolve a disputa e a referência de preço.
 */
export function seloPriceToWin(
  p: Pick<PulseProduto, 'ptw_status' | 'catalogo_status' | 'origem' | 'ptw_aplicavel'>,
): Selo | null {
  // O ML marcou a própria referência como não aplicável: a tela não pode usá-la para dizer que o
  // preço está alto ou baixo, senão afirma mais do que a fonte afirma — e o selo é lido como
  // veredito ("Acima da referência" empurra para baixar preço). `null` é outra coisa: significa que
  // a leitura não trouxe o campo, e aí o comportamento anterior vale.
  if (p.ptw_aplicavel === false) {
    return {
      texto: 'Referência não aplicável',
      tom: 'neutro',
      ajuda: 'O Mercado Livre calculou uma referência de preço para este anúncio, mas marcou que ela não se aplica agora. Por isso a tela não diz se o seu preço está alto ou baixo.',
    };
  }
  // Status novo do ML não vira badge com nome de API na tela do operador — o código cru fica no
  // tooltip, para o suporte conseguir rastrear. E o fallback não pode sugerir posição de preço
  // nenhuma: um status que não conhecemos não é "barato" nem "caro".
  if (p.ptw_status) {
    return REFERENCIA[p.ptw_status] ?? MARKDOWN[p.ptw_status]
      ?? { texto: 'Status não reconhecido', tom: 'neutro', ajuda: `Status do ML: ${p.ptw_status}` };
  }
  if (p.catalogo_status && p.catalogo_status !== 'vinculado') {
    return {
      texto: 'Sem vínculo de catálogo',
      tom: 'atencao',
      ajuda: 'Seu anúncio não está vinculado a esta ficha, então não disputa a página e o ML não calcula preço para ganhar. Resolva o vínculo pelo fluxo de catálogo.',
    };
  }
  if (p.origem === 'manual') {
    return { texto: 'Você não vende', tom: 'neutro', ajuda: 'Ficha adicionada para pesquisa — o price-to-win só existe para anúncios seus.' };
  }
  return null;
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
    return `Seu anúncio não está à venda no Mercado Livre (situação: ${p.anuncio_status}).`;
  }
  if (p.catalogo_status && p.catalogo_status !== 'vinculado') {
    return 'Seu anúncio não está vinculado a esta ficha, então não aparece entre as ofertas dela.';
  }
  return 'Seu anúncio não está entre as ofertas ativas da ficha.';
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
  return { texto: 'Fora do ar', tom: 'risco', ajuda: `Situação do anúncio no ML: ${p.anuncio_status}.` };
}

// Escala de preço frente à referência, do mais barato ao mais caro. Os estados de Markdown ficam
// de fora de propósito: "promoção agendada" não é uma posição de preço e ordená-la entre as
// outras inventaria uma comparação que o ML não fez.
const ORDEM: Record<string, number> = {
  no_benchmark_lowest: 0,
  no_benchmark_ok: 1,
  with_benchmark_high: 2,
  with_benchmark_highest: 3,
};

export function ordemPriceToWin(
  p: Pick<PulseProduto, 'ptw_status' | 'catalogo_status' | 'origem' | 'ptw_aplicavel'>,
): number | null {
  // Referência que o ML marcou como não aplicável não entra na escala de preço: ordenar por ela
  // colocaria a linha entre as posições ("abaixo", "acima") e contradiria o próprio selo, que diz
  // justamente que não há posição a afirmar.
  if (p.ptw_aplicavel === false) return 99;
  if (p.ptw_status && p.ptw_status in ORDEM) return ORDEM[p.ptw_status];
  return seloPriceToWin(p) ? 99 : null; // sem escala (sem vínculo, sem referência) vai para o fim
}

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
  const mapa: Record<string, string> = { gold: 'MercadoLíder Gold', platinum: 'MercadoLíder Platinum', silver: 'MercadoLíder' };
  return mapa[powerSeller] ?? 'MercadoLíder';
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
