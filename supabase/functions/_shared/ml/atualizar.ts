import { gtinAusente, ordenarFotosVariacao } from './publicar.ts';
import { EMPTY_GTIN_REASON_SEM_CODIGO, categoriaAceitaEmptyGtinReason } from '../categoria/atributos.ts';
import { calcularPrecoDe } from '../preco/desconto.ts';

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
  original_price?: number;
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
  capa3PictureId: string | null,
  categoriaMlId: string | null,
  desconto?: { pct: number } | null,
): VariacaoNovaPut {
  const variation: VariacaoNovaPut = {
    attribute_combinations: [{ id: 'COLOR', value_name: v.cor ?? '' }],
    available_quantity: v.estoque,
    price: v.preco_publicacao ?? 0,
    picture_ids: ordenarFotosVariacao(capaPictureId, capa2PictureId, capa3PictureId, v.ml_picture_id),
    seller_custom_field: v.codigo,
  };
  if (desconto) {
    const de = calcularPrecoDe(variation.price, desconto.pct);
    if (de !== null) variation.original_price = de;
  }
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
export interface VariacaoUpdate { id: string | number; available_quantity: number; picture_ids?: string[]; price?: number; original_price?: number; }

// Reenvia TODAS as variações atuais do anúncio (o ML deleta as omitidas). Por
// padrão só available_quantity — sem price, para o ML preservar o preço de venda
// (reposição pura de estoque, ADR-0016).
// Quando desconto está ativo, envia price + original_price para ativar o selo.
// `precoFamilia` (adendo ADR-0016): preço de publicação atual da família. Quando
// informado, é propagado para TODA variação existente — o ML exige preço único
// entre variações, então incluir cor nova a um preço diferente obriga reprecificar
// o anúncio inteiro; e o operador quer que a alteração de preço alcance a família
// já publicada. Idempotente quando o preço não mudou. O desconto, se ativo, tem
// precedência (já define price/original_price por código).
export function montarVariacoesUpdate(
  atuais: MLVariacaoAtual[],
  desejados: EstoqueDesejado[],
  picsPorCodigo?: Record<string, string[]>,
  desconto?: { pct: number; precoPorCodigo: Record<string, number | null> } | null,
  precoFamilia?: number | null,
): VariacaoUpdate[] {
  const estoquePorCodigo = new Map(desejados.map((d) => [d.codigo, d.estoque]));
  return atuais.map((a) => {
    const codigo = a.seller_custom_field ?? '';
    const novo = estoquePorCodigo.get(codigo);
    const base: VariacaoUpdate = { id: a.id, available_quantity: novo ?? a.available_quantity };
    const pics = picsPorCodigo?.[codigo];
    if (pics && pics.length > 0) base.picture_ids = [...new Set(pics)];
    if (desconto) {
      const preco = desconto.precoPorCodigo[codigo];
      if (preco != null) {
        const de = calcularPrecoDe(preco, desconto.pct);
        if (de !== null) { base.price = preco; base.original_price = de; }
      }
    }
    if (precoFamilia != null && base.price == null) base.price = precoFamilia;
    return base;
  });
}
