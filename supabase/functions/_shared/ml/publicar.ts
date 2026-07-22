import {
  EMPTY_GTIN_REASON_SEM_CODIGO, categoriaAceitaEmptyGtinReason, categoriaExigeFamilyName,
} from '../categoria/atributos.ts';
import { calcularPrecoDe } from '../preco/desconto.ts';
import { montarAtributosPacote, type DimensoesPacote } from './pacote.ts';

// E6 (ADR-0061): o tipo é dono no contrato; importado p/ uso local e re-exportado p/ compat.
import type { AtributoItem } from '../canais/contrato.ts';
export type { AtributoItem };
export interface PictureRef { id: string; }
export interface VariacaoItem {
  attribute_combinations: AtributoItem[];
  available_quantity: number;
  price: number;
  original_price?: number;
  picture_ids: string[];
  attributes?: AtributoItem[];
  seller_custom_field?: string;
}
export interface PayloadItem {
  // ADR-0084: item plano (family_name) omite title — a ML gera a partir de atributos/family_name.
  title?: string;
  category_id: string;
  price?: number;
  available_quantity?: number;
  original_price?: number;
  seller_custom_field?: string;
  currency_id: string;
  buying_mode: string;
  listing_type_id: string;
  condition: string;
  pictures: PictureRef[];
  attributes: AtributoItem[];
  variations?: VariacaoItem[];
  family_name?: string;
}

interface FamiliaInput {
  titulo_ml: string | null;
  descricao_ml: string | null;
  categoria_ml_id: string | null;
  atributos_ml: AtributoItem[];
}
interface VariacaoInput {
  codigo: string; cor: string | null; estoque: number;
  preco_publicacao: number | null; gtin: string | null; ml_picture_id: string | null;
}

/** Ordena as variações com a principal primeiro; o resto por código ascendente.
 *  Genérica em T (só exige `codigo`) p/ servir CREATE (VariacaoInput) e testes. */
export function ordenarVariacoesPrincipal<T extends { codigo: string }>(
  variacoes: T[],
  principalCodigo: string | null,
): T[] {
  const resto = [...variacoes].sort((a, b) => a.codigo.localeCompare(b.codigo));
  if (!principalCodigo) return resto;
  const idx = resto.findIndex((v) => v.codigo === principalCodigo);
  if (idx < 0) return resto;
  const [principal] = resto.splice(idx, 1);
  return [principal, ...resto];
}

// condition/buying_mode confirmados válidos no MLB (Task 13). listing_type vem do
// operador (gold_special = Clássico, gold_pro = Premium); default Clássico.
const CURRENCY = 'BRL';
const BUYING_MODE = 'buy_it_now';
const LISTING_TYPE_PADRAO = 'gold_special';
const CONDITION = 'new';
const COR_UNITARIA = 'Único';

// Ausência legítima de código universal: nulo/vazio, código interno 3000* (não-EAN GS1),
// ou comprimento inválido (GTIN válido = 8, 12, 13 ou 14 dígitos). Códigos de 9 dígitos
// são IDs internos de fornecedor, não GTINs reais — tratamos como ausentes para evitar
// rejeição silenciosa pelo ML (ex.: lote #48 com gtin="533100017").
const GTIN_COMPRIMENTOS_VALIDOS = new Set([8, 12, 13, 14]);
export function gtinAusente(gtin: string | null): boolean {
  if (!gtin || gtin.trim() === '') return true;
  const digits = gtin.trim().replace(/\D/g, '');
  if (/^3000/.test(digits)) return true;
  return !GTIN_COMPRIMENTOS_VALIDOS.has(digits.length);
}

/** Ordena as fotos de uma variação. O ML usa a 1ª picture_id como capa da galeria
 *  da cor, então a 1ª posição é sempre uma foto "principal": a foto-capa da família
 *  quando existe, senão a própria foto da cor. capa2 e capa3 são, por definição, a 2ª
 *  e a 3ª foto comuns e NUNCA podem liderar — sem capa, a própria foto sobe para a 1ª
 *  e as comuns ficam logo atrás (capa3 sempre após a capa2). */
export function ordenarFotosVariacao(
  capa: string | null,
  capa2: string | null,
  capa3: string | null,
  propria: string | null,
): string[] {
  const lider = capa ?? propria;
  return [...new Set([lider, capa2, capa3, propria].filter((x): x is string => !!x))];
}

export function montarPayloadItem(
  familia: FamiliaInput,
  variacoes: VariacaoInput[],
  capaPictureId: string | null,
  capa2PictureId: string | null,
  capa3PictureId: string | null,
  listingTypeId: string = LISTING_TYPE_PADRAO,
  desconto?: { pct: number } | null,
  dimensoes?: DimensoesPacote | null,
  aceitaEmptyGtinOverride?: boolean,
  formato?: 'plano',
): PayloadItem {
  // item.pictures lidera com uma foto principal (capa da família, ou a 1ª foto de cor
  // quando não há capa); capa2 e capa3 nunca assumem a 1ª posição.
  const fotosCor = variacoes.map((v) => v.ml_picture_id).filter((x): x is string => !!x);
  const lider = capaPictureId ?? fotosCor[0] ?? null;
  const picIds = [lider, capa2PictureId, capa3PictureId, ...fotosCor].filter((x): x is string => !!x);
  const pictures: PictureRef[] = [...new Set(picIds)].map((id) => ({ id }));

  // E4: categoria prevista passa o flag lido do schema; aviamento (override) usa o helper hard-coded.
  const aceitaEmptyGtin = aceitaEmptyGtinOverride ?? categoriaAceitaEmptyGtinReason(familia.categoria_ml_id);
  const variacaoUnica = variacoes.length === 1;

  // ADR-0084: categorias que exigem family_name (Zíperes/MLB271227) também rejeitam o array
  // `variations` em si (validado via API real) — o item tem que ser plano (price/available_quantity
  // no corpo raiz, sem variations). Só sabemos publicar essa combinação com 1 variação: com >1 cor
  // caberia 1 anúncio por cor compartilhando family_name, redesenho maior fora de escopo aqui —
  // falha LOUD em vez de mandar um payload que a ML vai rejeitar (ou pior, publicar errado).
  // ADR-0087: `formato` força o ramo quando informado (retry reativo); sem ele, a categoria
  // no Set continua sendo só o seed inicial — categorias novas descobrem o formato certo
  // reagindo à resposta do ML em vez de precisar entrar nesse Set primeiro.
  if (formato === 'plano' || (formato === undefined && categoriaExigeFamilyName(familia.categoria_ml_id))) {
    if (!variacaoUnica) {
      throw new Error(
        `Categoria ${familia.categoria_ml_id} não suporta múltiplas cores agrupadas em variations `
        + '(exige item plano por cor com family_name — não implementado para >1 variação, ADR-0084).',
      );
    }
    const v = variacoes[0];
    const cor = v.cor?.trim() || COR_UNITARIA;
    const atributosFlat: AtributoItem[] = [
      ...(familia.atributos_ml ?? []),
      { id: 'COLOR', value_name: cor },
    ];
    if (gtinAusente(v.gtin)) {
      if (aceitaEmptyGtin) atributosFlat.push({ id: 'EMPTY_GTIN_REASON', value_id: EMPTY_GTIN_REASON_SEM_CODIGO });
    } else {
      atributosFlat.push({ id: 'GTIN', value_name: v.gtin! });
    }
    const atributosPacoteFlat = dimensoes ? montarAtributosPacote(dimensoes) : [];
    const precoFlat = v.preco_publicacao ?? 0;
    // Validado via API real: com family_name, a ML rejeita `title` (auto-gerado a partir de
    // atributos/family_name, doc oficial) e `original_price` ("The fields [original_price, title]
    // are invalid for requested call") — nenhum dos dois entra no payload plano.
    return {
      category_id: familia.categoria_ml_id ?? '',
      currency_id: CURRENCY,
      buying_mode: BUYING_MODE,
      listing_type_id: listingTypeId,
      condition: CONDITION,
      pictures,
      attributes: [...atributosFlat, ...atributosPacoteFlat],
      price: precoFlat,
      available_quantity: v.estoque,
      seller_custom_field: v.codigo,
      family_name: familia.titulo_ml ?? '',
    };
  }

  const variations: VariacaoItem[] = variacoes.map((v) => {
    const cor = v.cor?.trim() || (variacaoUnica ? COR_UNITARIA : '');
    // A capa entra como 1ª foto de cada cor: com variações, o ML exibe a galeria
    // por variação, então sem isso a foto-capa do anúncio nunca apareceria.
    const variation: VariacaoItem = {
      attribute_combinations: [{ id: 'COLOR', value_name: cor }],
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
      // Sem código real (nulo ou interno 3000*): declara o motivo. GTIN é conditional_required,
      // então em categorias sem EMPTY_GTIN_REASON (ex.: botão) o atributo é simplesmente omitido.
      if (aceitaEmptyGtin) {
        variation.attributes = [{ id: 'EMPTY_GTIN_REASON', value_id: EMPTY_GTIN_REASON_SEM_CODIGO }];
      }
    } else {
      // GTIN preenchido: válido (ML aceita) ou malformado (ML rejeita e expõe o erro ao
      // operador). Nunca declarar "sem código" para um valor preenchido — seria dado falso.
      variation.attributes = [{ id: 'GTIN', value_name: v.gtin! }];
    }
    return variation;
  });

  // Dimensões/peso (ADR-0018): SELLER_PACKAGE_* da variação representativa. Inválido → [] (ML estima).
  const atributosPacote = dimensoes ? montarAtributosPacote(dimensoes) : [];

  return {
    title: familia.titulo_ml ?? '',
    category_id: familia.categoria_ml_id ?? '',
    currency_id: CURRENCY,
    buying_mode: BUYING_MODE,
    listing_type_id: listingTypeId,
    condition: CONDITION,
    pictures,
    attributes: [...(familia.atributos_ml ?? []), ...atributosPacote],
    variations,
  };
}
