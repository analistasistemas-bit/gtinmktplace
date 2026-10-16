export interface VarAnterior {
  codigo: string;
  ml_variation_id: string | null;
  cor: string | null;
  cor_origem: string | null;
  ml_picture_id: string | null;
  estoque: number;
  preco_publicacao: number | string | null;
  /** Último preço confirmado no ML (ADR-0078 F1) — gravado em todo UPDATE, inclusive "somente estoque". */
  preco_publicado_ml?: number | string | null;
  /** D1 do reajuste: preço fixado pelo operador/reajuste — o re-ingest herda junto com o preço. */
  preco_editado_pelo_operador?: boolean;
}
export interface VarNova { codigo: string; }

export interface Herdado {
  ml_variation_id: string | null;
  cor: string | null;
  cor_origem: string | null;
  ml_picture_id: string | null;
  estoque_anterior: number | null;
  preco_publicacao: number | string | null;
  /** Ausente = nunca confirmado no ML (mesmo que null). */
  preco_publicado_ml?: number | string | null;
  preco_editado_pelo_operador?: boolean;
}
export interface MudancaEstrutural {
  novas: string[];
  removidas: { codigo: string; cor: string | null }[];
}
export interface ResultadoCasamento {
  herdados: Record<string, Herdado>;
  mudancaEstrutural: MudancaEstrutural;
}

// Cor já no anúncio sempre entra no UPDATE. "Já no anúncio": Legacy = tem ml_variation_id;
// User Products (ADR-0088) = SKU ativo em anuncios_externos_itens (ml_variation_id é sempre null lá —
// sem isto toda cor UP sem foto no lote virava "nova" e saía da publicação). Cor nova entra marcada
// só com foto E estoque (zerada dorme até repor); senão desmarcada, o operador reinclui na Revisão.
export function excluidaNoUpdate(p: {
  mlVariationId: string | null;
  ativaUP: boolean;
  temFoto: boolean;
  estoque: number;
}): boolean {
  if (p.mlVariationId != null || p.ativaUP) return false;
  return !(p.temFoto && p.estoque > 0);
}

export function casarVariacoesUpdate(
  novas: VarNova[],
  anteriores: VarAnterior[],
): ResultadoCasamento {
  const porCodigo = new Map(anteriores.map((a) => [a.codigo, a]));
  const codigosNovos = new Set(novas.map((n) => n.codigo));

  // Preço confirmado da família (menor, como o precoPubFamilia do ingest): fallback da variação que
  // nunca foi confirmada no ML (ex.: cor que ficou fora por falta de foto). Sem ele, Legacy ficaria
  // com dois preços (confirmadas no preço do ML, não confirmadas no preço velho) → split/LOUD.
  // Só Legacy (alguma variação com ml_variation_id): em User Products o preço é por SKU (ADR-0160)
  // e um SKU sem confirmação mantém o próprio preço.
  const ehLegacy = anteriores.some((a) => a.ml_variation_id != null);
  const confirmados = anteriores
    .map((a) => a.preco_publicado_ml)
    .filter((p): p is number | string => p != null)
    .map(Number);
  // Só com preço único: família dividida em faixas (ADR-0078) tem confirmados divergentes e o
  // menor seria o preço de outra faixa — lá a variação sem confirmação mantém o próprio.
  const precoUnico = confirmados.length > 0 && confirmados.every((p) => p === confirmados[0]);
  const precoConfirmadoFamilia = ehLegacy && precoUnico ? confirmados[0] : null;

  const herdados: Record<string, Herdado> = {};
  const novasCores: string[] = [];
  for (const n of novas) {
    const ant = porCodigo.get(n.codigo);
    if (ant) {
      herdados[n.codigo] = {
        ml_variation_id: ant.ml_variation_id,
        cor: ant.cor,
        cor_origem: ant.cor_origem,
        ml_picture_id: ant.ml_picture_id,
        estoque_anterior: ant.estoque,
        // ADR-0016 adendo 2026-10-16: herda o preço que está no ar (preço mudado direto no ML não
        // volta ao valor velho do app); preço fixado pelo operador (D15) mantém o fixado.
        preco_publicacao: ant.preco_editado_pelo_operador === true
          ? ant.preco_publicacao
          : ant.preco_publicado_ml ?? precoConfirmadoFamilia ?? ant.preco_publicacao,
        preco_publicado_ml: ant.preco_publicado_ml ?? null,
        preco_editado_pelo_operador: ant.preco_editado_pelo_operador,
      };
    } else {
      herdados[n.codigo] = { ml_variation_id: null, cor: null, cor_origem: null, ml_picture_id: null, estoque_anterior: null, preco_publicacao: null, preco_publicado_ml: null };
      novasCores.push(n.codigo);
    }
  }

  const removidas = anteriores
    .filter((a) => !codigosNovos.has(a.codigo))
    .map((a) => ({ codigo: a.codigo, cor: a.cor }));

  return { herdados, mudancaEstrutural: { novas: novasCores, removidas } };
}
