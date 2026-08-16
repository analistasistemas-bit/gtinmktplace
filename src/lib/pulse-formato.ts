// Pulse (ADR-0119): tradução do jargão do ML para a linguagem do operador. Puro, sem I/O.
import type { PulseProduto } from './pulse';

export type Tom = 'neutro' | 'ok' | 'atencao' | 'risco';

export interface Selo {
  texto: string;
  tom: Tom;
  /** Explicação no title/tooltip — o operador não precisa decorar o vocabulário do ML. */
  ajuda?: string;
}

/** Escala do "preço para ganhar" do ML, do mais barato ao mais caro. */
const PTW: Record<string, Selo> = {
  with_benchmark_lowest: { texto: 'Menor preço', tom: 'ok', ajuda: 'Você tem o menor preço entre os concorrentes desta ficha.' },
  with_benchmark_low: { texto: 'Abaixo da média', tom: 'ok', ajuda: 'Seu preço está abaixo da média do mercado.' },
  with_benchmark_mid: { texto: 'Na média', tom: 'neutro', ajuda: 'Seu preço está na média do mercado.' },
  with_benchmark_high: { texto: 'Acima da média', tom: 'atencao', ajuda: 'O Mercado Livre considera seu preço acima do competitivo.' },
  with_benchmark_highest: { texto: 'Preço mais alto', tom: 'risco', ajuda: 'Você tem o preço mais alto entre os concorrentes desta ficha.' },
  sharing_first_place: { texto: 'Dividindo o 1º', tom: 'ok', ajuda: 'Você divide o primeiro lugar da disputa.' },
  no_benchmark_lowest: { texto: 'Sem concorrência', tom: 'neutro', ajuda: 'O ML não encontrou referência de comparação para esta ficha.' },
  no_benchmark: { texto: 'Sem referência', tom: 'neutro', ajuda: 'O ML ainda não avaliou a competitividade deste anúncio.' },
};

/**
 * Selo da coluna Price-to-win. Sem vínculo de catálogo o ML não calcula sugestão nenhuma
 * (404 em /suggestions) — dizer isso vale mais que um traço mudo, porque é acionável:
 * resolver a ficha divergente devolve a disputa e o price-to-win.
 */
export function seloPriceToWin(p: Pick<PulseProduto, 'ptw_status' | 'catalogo_status' | 'origem'>): Selo | null {
  // Status novo do ML não vira badge com nome de API na tela do operador — o código cru fica no
  // tooltip, para o suporte conseguir rastrear.
  if (p.ptw_status) {
    return PTW[p.ptw_status] ?? { texto: 'Sem referência', tom: 'neutro', ajuda: `Status do ML: ${p.ptw_status}` };
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

/** Posição na escala do price-to-win, do mais barato ao mais caro. Ordena a coluna. */
const ORDEM: Record<string, number> = {
  with_benchmark_lowest: 0,
  sharing_first_place: 1,
  with_benchmark_low: 2,
  with_benchmark_mid: 3,
  with_benchmark_high: 4,
  with_benchmark_highest: 5,
};

export function ordemPriceToWin(p: Pick<PulseProduto, 'ptw_status' | 'catalogo_status' | 'origem'>): number | null {
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
