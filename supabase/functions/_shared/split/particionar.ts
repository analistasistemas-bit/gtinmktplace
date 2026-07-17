// Particionamento de cores em N anúncios ML (ADR-0048). O ML limita 100 variações por anúncio;
// produtos com mais cores viram vários anúncios ("partições"). Regras:
// - Ancoragem: cor já publicada (presente em `ancoragem`) fica fixa na sua partição — nunca
//   migra, então o UPDATE não embaralha o que já está no ar.
// - Cores novas: ordenadas por nome de cor (alfabético, tie por sku), preenchem a partição de
//   menor índice com espaço (< MAX); sem espaço, abre a próxima partição.
// O estoque NÃO entra aqui (a partição é só por contagem); o teto de 99.999 é garantido por
// `caparEstoque` no payload de cada anúncio.

export interface CorParticionavel {
  sku: string;
  cor: string | null;
}

export const MAX_VARIACOES_ML = 100;

export function particionar(
  cores: CorParticionavel[],
  ancoragem: Map<string, number>,
  max = MAX_VARIACOES_ML,
): Map<string, number> {
  const resultado = new Map<string, number>();
  const count = new Map<number, number>();
  let maxParticao = 0;

  for (const { sku } of cores) {
    if (ancoragem.has(sku)) {
      const p = ancoragem.get(sku)!;
      resultado.set(sku, p);
      count.set(p, (count.get(p) ?? 0) + 1);
      if (p > maxParticao) maxParticao = p;
    }
  }

  const novas = cores
    .filter((c) => !ancoragem.has(c.sku))
    .sort((a, b) => (a.cor ?? '').localeCompare(b.cor ?? '', 'pt') || a.sku.localeCompare(b.sku));

  for (const { sku } of novas) {
    let alvo = -1;
    for (let p = 0; p <= maxParticao; p++) {
      if ((count.get(p) ?? 0) < max) {
        alvo = p;
        break;
      }
    }
    if (alvo === -1) {
      alvo = maxParticao + 1;
      maxParticao = alvo;
    }
    resultado.set(sku, alvo);
    count.set(alvo, (count.get(alvo) ?? 0) + 1);
  }

  return resultado;
}

// ─── ADR-0078 F2: partição por PREÇO primeiro ────────────────────────────────────────────
// Chave de particionamento passa a ser a faixa de preço; dentro do grupo vale a regra
// alfabética/100 atual. Ancorada nunca migra (invariante #4); cruzar faixa = conflito LOUD.

export interface CorComPreco { sku: string; cor: string | null; precoCentavos: number | null; }
export interface ParticionarPorPrecoInput {
  cores: CorComPreco[];
  ancoragem: Map<string, number>;
  faixaVivaPorParticao: Map<number, number>;
  somenteEstoque: boolean;
  max?: number;
}
export interface ParticionarPorPrecoResultado {
  mapa: Map<string, number>;
  precoPorParticao: Map<number, number | null>;
  conflitos: string[];
}

export function particionarPorPreco(input: ParticionarPorPrecoInput): ParticionarPorPrecoResultado {
  const max = input.max ?? MAX_VARIACOES_ML;
  const mapa = new Map<string, number>();
  const count = new Map<number, number>();
  const precoPorParticao = new Map<number, number | null>();
  const conflitos: string[] = [];
  let maxParticao = -1;

  // 1. Ancoradas ficam onde estão (ADR-0048).
  const ancoradasPorParticao = new Map<number, CorComPreco[]>();
  for (const cor of input.cores) {
    const p = input.ancoragem.get(cor.sku);
    if (p == null) continue;
    mapa.set(cor.sku, p);
    count.set(p, (count.get(p) ?? 0) + 1);
    if (p > maxParticao) maxParticao = p;
    (ancoradasPorParticao.get(p) ?? ancoradasPorParticao.set(p, []).get(p)!).push(cor);
  }

  // 2. Preço-alvo por partição existente.
  for (const [p, ancoradas] of ancoradasPorParticao) {
    if (input.somenteEstoque) {
      // Nada será empurrado: a faixa é o preço VIVO (preco_publicado_ml / GET) — nunca o recalculado.
      precoPorParticao.set(p, input.faixaVivaPorParticao.get(p) ?? null);
      continue;
    }
    const naoNulos = new Set(
      ancoradas.map((c) => c.precoCentavos).filter((x): x is number => x != null),
    );
    if (naoNulos.size > 1) {
      conflitos.push(
        `Partição ${p}: preços divergentes entre cores já publicadas ` +
        `(${[...naoNulos].map((x) => (x / 100).toFixed(2)).join(' × ')}) — honrar exige dividir/migrar ` +
        `variação publicada (perde histórico); decida na Revisão`,
      );
      precoPorParticao.set(p, null);
      continue;
    }
    // 1 preço → a partição inteira reprecifica junto; 0 → preserva o vivo (semântica de hoje).
    precoPorParticao.set(p, naoNulos.size === 1 ? [...naoNulos][0] : (input.faixaVivaPorParticao.get(p) ?? null));
  }

  // 3. Cores novas: alfabética por cor (tie por sku) — regra atual do ADR-0048.
  const novas = input.cores
    .filter((c) => !input.ancoragem.has(c.sku))
    .sort((a, b) => (a.cor ?? '').localeCompare(b.cor ?? '', 'pt') || a.sku.localeCompare(b.sku));

  for (const cor of novas) {
    if (cor.precoCentavos == null) {
      conflitos.push(`Cor nova ${cor.sku} sem preço de publicação`);
      continue;
    }
    // Menor partição cuja faixa casa e tem espaço (desempate determinístico do spec).
    let alvo = -1;
    for (let p = 0; p <= maxParticao; p++) {
      if (precoPorParticao.get(p) === cor.precoCentavos && (count.get(p) ?? 0) < max) {
        alvo = p;
        break;
      }
    }
    if (alvo === -1) {
      alvo = maxParticao + 1;
      maxParticao = alvo;
      precoPorParticao.set(alvo, cor.precoCentavos);
    }
    mapa.set(cor.sku, alvo);
    count.set(alvo, (count.get(alvo) ?? 0) + 1);
  }

  return { mapa, precoPorParticao, conflitos };
}
