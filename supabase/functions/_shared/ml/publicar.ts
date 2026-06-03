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

// Defaults a confirmar contra a API real (Task 13).
const CURRENCY = 'BRL';
const BUYING_MODE = 'buy_it_now';
const LISTING_TYPE = 'gold_special';
const CONDITION = 'new';

function gtinValidoEan(gtin: string | null): boolean {
  if (!gtin) return false;
  if (/^3000/.test(gtin)) return false; // código interno, não-EAN
  return /^\d{8,14}$/.test(gtin);
}

export function montarPayloadItem(
  familia: FamiliaInput,
  variacoes: VariacaoInput[],
  capaPictureId: string | null,
): PayloadItem {
  const picIds = [
    ...(capaPictureId ? [capaPictureId] : []),
    ...variacoes.map((v) => v.ml_picture_id).filter((x): x is string => !!x),
  ];
  const pictures: PictureRef[] = [...new Set(picIds)].map((id) => ({ id }));

  const variations: VariacaoItem[] = variacoes.map((v) => {
    const variation: VariacaoItem = {
      attribute_combinations: [{ id: 'COLOR', value_name: v.cor ?? '' }],
      available_quantity: v.estoque,
      price: v.preco_publicacao ?? 0,
      picture_ids: v.ml_picture_id ? [v.ml_picture_id] : [],
      seller_custom_field: v.codigo,
    };
    if (gtinValidoEan(v.gtin)) {
      variation.attributes = [{ id: 'GTIN', value_name: v.gtin! }];
    } else {
      // Sem código universal — id/forma exatos confirmados no bug bash (Task 13).
      variation.attributes = [{ id: 'GTIN', value_name: 'EMPTY_GTIN_NUMBER' }];
    }
    return variation;
  });

  return {
    title: familia.titulo_ml ?? '',
    category_id: familia.categoria_ml_id ?? '',
    currency_id: CURRENCY,
    buying_mode: BUYING_MODE,
    listing_type_id: LISTING_TYPE,
    condition: CONDITION,
    pictures,
    attributes: familia.atributos_ml ?? [],
    variations,
  };
}
