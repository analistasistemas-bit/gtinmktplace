import { EMPTY_GTIN_REASON_SEM_CODIGO, categoriaAceitaEmptyGtinReason } from '../categoria/atributos.ts';
import { calcularPrecoDe } from '../preco/desconto.ts';
import { montarAtributosPacote, type DimensoesPacote } from './pacote.ts';
import type { AtributoItem } from '../canais/tipos.ts';

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
  title: string;
  category_id: string;
  price?: number;
  currency_id: string;
  buying_mode: string;
  listing_type_id: string;
  condition: string;
  pictures: PictureRef[];
  attributes: AtributoItem[];
  variations: VariacaoItem[];
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

// Ausência legítima de código universal: nulo/vazio ou código interno 3000* (não-EAN GS1).
// Um GTIN preenchido (mesmo malformado) NÃO é ausência — vai ao ML, que valida o formato.
export function gtinAusente(gtin: string | null): boolean {
  return !gtin || gtin.trim() === '' || /^3000/.test(gtin);
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
