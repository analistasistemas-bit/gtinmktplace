import { gtinAusente } from './publicar.ts';
import { EMPTY_GTIN_REASON_SEM_CODIGO, categoriaAceitaEmptyGtinReason } from '../categoria/atributos.ts';

export interface AtributoVar { id: string; value_name?: string; value_id?: string; }
export interface CorNovaInput {
  codigo: string;
  cor: string | null;
  estoque: number;
  preco_publicacao: number | null;
  gtin: string | null;
  ml_picture_id: string | null;
}
export interface VariacaoNovaPut {
  attribute_combinations: AtributoVar[];
  available_quantity: number;
  price: number;
  picture_ids: string[];
  attributes?: AtributoVar[];
  seller_custom_field: string;
}

// Variação nova (sem id) para o PUT — o ML cria. Reusa a regra de GTIN do CREATE
// (publicar.ts): GTIN ausente/3000* → EMPTY_GTIN_REASON nas categorias que aceitam.
export function montarVariacaoNova(
  v: CorNovaInput,
  capaPictureId: string | null,
  capa2PictureId: string | null,
  categoriaMlId: string | null,
): VariacaoNovaPut {
  const pics = [
    ...(capaPictureId ? [capaPictureId] : []),
    ...(capa2PictureId ? [capa2PictureId] : []),
    ...(v.ml_picture_id ? [v.ml_picture_id] : []),
  ];
  const variation: VariacaoNovaPut = {
    attribute_combinations: [{ id: 'COLOR', value_name: v.cor ?? '' }],
    available_quantity: v.estoque,
    price: v.preco_publicacao ?? 0,
    picture_ids: [...new Set(pics)],
    seller_custom_field: v.codigo,
  };
  if (gtinAusente(v.gtin)) {
    if (categoriaAceitaEmptyGtinReason(categoriaMlId)) {
      variation.attributes = [{ id: 'EMPTY_GTIN_REASON', value_id: EMPTY_GTIN_REASON_SEM_CODIGO }];
    }
  } else {
    variation.attributes = [{ id: 'GTIN', value_name: v.gtin! }];
  }
  return variation;
}

export interface MLVariacaoAtual {
  id: string | number;
  seller_custom_field?: string | null;
  available_quantity: number;
  picture_ids?: string[];
}
export interface EstoqueDesejado { codigo: string; estoque: number; }
export interface VariacaoUpdate { id: string | number; available_quantity: number; picture_ids?: string[]; }

// Reenvia TODAS as variações atuais do anúncio (o ML deleta as omitidas). Só
// available_quantity — sem price, para o ML preservar o preço de venda.
export function montarVariacoesUpdate(
  atuais: MLVariacaoAtual[],
  desejados: EstoqueDesejado[],
  picsPorCodigo?: Record<string, string[]>,
): VariacaoUpdate[] {
  const estoquePorCodigo = new Map(desejados.map((d) => [d.codigo, d.estoque]));
  return atuais.map((a) => {
    const codigo = a.seller_custom_field ?? '';
    const novo = estoquePorCodigo.get(codigo);
    const base: VariacaoUpdate = { id: a.id, available_quantity: novo ?? a.available_quantity };
    const pics = picsPorCodigo?.[codigo];
    if (pics && pics.length > 0) base.picture_ids = [...new Set(pics)];
    return base;
  });
}
