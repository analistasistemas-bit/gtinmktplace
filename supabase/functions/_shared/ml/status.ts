export type StatusPublicado = 'ativo' | 'pausado' | 'encerrado' | 'moderado' | 'inativo' | 'indisponivel';

export interface ItemMLStatus {
  id: string;
  status?: string;
  sub_status?: string[];
  available_quantity?: number;
  price?: number;
  listing_type_id?: string;
  /** Tags do item. `catalog_forewarning` = o ML sinaliza "prestes a ser pausado" por catálogo. */
  tags?: string[];
}

export type ListingTypeCanal = 'classico' | 'premium' | null;

export interface StatusParsed {
  status: StatusPublicado;
  motivo: string | null;
  estoque: number | null;
  preco: number | null;
  listingType: ListingTypeCanal;
  /** Tag `catalog_forewarning` do item — ver StatusCanal em contrato.ts. */
  catalogForewarning: boolean;
}

// gold_special = Clássico, gold_pro = Premium. Demais tipos (free, etc.) → null.
function mapListingType(id: string | undefined): ListingTypeCanal {
  if (id === 'gold_special') return 'classico';
  if (id === 'gold_pro') return 'premium';
  return null;
}

const MAP: Record<string, StatusPublicado> = {
  active: 'ativo',
  paused: 'pausado',
  closed: 'encerrado',
  inactive: 'inativo',
  under_review: 'moderado',
};

// Marcadores de moderação no sub_status que valem "moderado" qualquer que seja o status.
const MODERACAO_SUBS = ['forbidden', 'waiting_for_patch', 'poor_quality_thumbnail', 'poor_quality_picture'];

// Pausa PREVENTIVA do ML (doc "Moderaciones con pausado"): item sem vendas/abandonado, preço
// atípico, imagem por URL ainda não processada. O ML devolve `under_review` nesses casos, mas a
// própria doc separa isso das moderações por infração — "só pausa a publicação" e o vendedor
// reativa com PUT status=active. Tratar como moderado gerava alerta falso: 25/08/2026, dois
// anúncios sem estoque (MLB5040504553/MLB5001755829) dispararam "anúncio moderado" no Telegram e
// nas notificações e voltaram sozinhos a `paused`/`out_of_stock` horas depois, sem moderação.
const PREVENTIVA_SUBS = ['suspended_for_prevention'];

export function parseStatusML(item: ItemMLStatus | null): StatusParsed {
  if (!item || !item.status) {
    return { status: 'indisponivel', motivo: null, estoque: null, preco: null, listingType: null, catalogForewarning: false };
  }
  const sub = item.sub_status ?? [];
  // O ML move um item moderado de `under_review` para `inactive` (+ `deleted`) em horas, então
  // checar só o status perderia a janela. Qualquer marcador de moderação no sub_status já conta.
  // Só é pausa preventiva quando NENHUM outro sub_status acompanha — `suspended_for_prevention`
  // ao lado de `forbidden` continua sendo moderação.
  const preventiva = sub.length > 0 && sub.every((s) => PREVENTIVA_SUBS.includes(s));
  const moderado = sub.some((s) => MODERACAO_SUBS.includes(s))
    || (item.status === 'under_review' && !preventiva);
  // Só o `under_review` precisa do desvio: `paused` já cai em `pausado` pelo MAP, e
  // `closed`/`inactive` têm de manter o status próprio — `pausado` é o único estado que
  // `sincronizar-estoque` reativa sem decisão humana (ADR-0111).
  const status = moderado ? 'moderado'
    : (preventiva && item.status === 'under_review') ? 'pausado'
    : (MAP[item.status] ?? 'indisponivel');
  return {
    status,
    motivo: moderado && sub.length ? sub.join(', ') : null,
    estoque: item.available_quantity ?? null,
    preco: item.price ?? null,
    listingType: mapListingType(item.listing_type_id),
    catalogForewarning: (item.tags ?? []).includes('catalog_forewarning'),
  };
}
