import { EMPTY_GTIN_REASON_SEM_CODIGO, categoriaAceitaEmptyGtinReason } from '../categoria/atributos.ts';

export interface AtributoItem { id: string; value_name?: string; value_id?: string; }
export interface PictureRef { id: string; }
export interface VariacaoItem {
  attribute_combinations: AtributoItem[];
  available_quantity: number;
  price: number;
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

// Ausência legítima de código universal: nulo/vazio ou código interno 3000* (não-EAN GS1).
// Um GTIN preenchido (mesmo malformado) NÃO é ausência — vai ao ML, que valida o formato.
export function gtinAusente(gtin: string | null): boolean {
  return !gtin || gtin.trim() === '' || /^3000/.test(gtin);
}

export function montarPayloadItem(
  familia: FamiliaInput,
  variacoes: VariacaoInput[],
  capaPictureId: string | null,
  capa2PictureId: string | null,
  listingTypeId: string = LISTING_TYPE_PADRAO,
): PayloadItem {
  const comuns = [capaPictureId, capa2PictureId].filter((x): x is string => !!x);
  const picIds = [
    ...comuns,
    ...variacoes.map((v) => v.ml_picture_id).filter((x): x is string => !!x),
  ];
  const pictures: PictureRef[] = [...new Set(picIds)].map((id) => ({ id }));

  const aceitaEmptyGtin = categoriaAceitaEmptyGtinReason(familia.categoria_ml_id);
  const variations: VariacaoItem[] = variacoes.map((v) => {
    // A capa entra como 1ª foto de cada cor: com variações, o ML exibe a galeria
    // por variação, então sem isso a foto-capa do anúncio nunca apareceria.
    const picsVariacao = [
      ...comuns,
      ...(v.ml_picture_id ? [v.ml_picture_id] : []),
    ];
    const variation: VariacaoItem = {
      attribute_combinations: [{ id: 'COLOR', value_name: v.cor ?? '' }],
      available_quantity: v.estoque,
      price: v.preco_publicacao ?? 0,
      picture_ids: [...new Set(picsVariacao)],
      seller_custom_field: v.codigo,
    };
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

  return {
    title: familia.titulo_ml ?? '',
    category_id: familia.categoria_ml_id ?? '',
    currency_id: CURRENCY,
    buying_mode: BUYING_MODE,
    listing_type_id: listingTypeId,
    condition: CONDITION,
    pictures,
    attributes: familia.atributos_ml ?? [],
    variations,
  };
}
