export interface VarAnterior {
  codigo: string;
  ml_variation_id: string | null;
  cor: string | null;
  cor_origem: string | null;
  ml_picture_id: string | null;
  estoque: number;
}
export interface VarNova { codigo: string; }

export interface Herdado {
  ml_variation_id: string | null;
  cor: string | null;
  cor_origem: string | null;
  ml_picture_id: string | null;
  estoque_anterior: number | null;
}
export interface MudancaEstrutural {
  novas: string[];
  removidas: { codigo: string; cor: string | null }[];
}
export interface ResultadoCasamento {
  herdados: Record<string, Herdado>;
  mudancaEstrutural: MudancaEstrutural;
}

export function casarVariacoesUpdate(
  novas: VarNova[],
  anteriores: VarAnterior[],
): ResultadoCasamento {
  const porCodigo = new Map(anteriores.map((a) => [a.codigo, a]));
  const codigosNovos = new Set(novas.map((n) => n.codigo));

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
      };
    } else {
      herdados[n.codigo] = { ml_variation_id: null, cor: null, cor_origem: null, ml_picture_id: null, estoque_anterior: null };
      novasCores.push(n.codigo);
    }
  }

  const removidas = anteriores
    .filter((a) => !codigosNovos.has(a.codigo))
    .map((a) => ({ codigo: a.codigo, cor: a.cor }));

  return { herdados, mudancaEstrutural: { novas: novasCores, removidas } };
}
