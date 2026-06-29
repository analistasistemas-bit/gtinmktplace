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
