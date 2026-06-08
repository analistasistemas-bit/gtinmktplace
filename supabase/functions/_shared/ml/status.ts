export type StatusPublicado = 'ativo' | 'pausado' | 'encerrado' | 'moderado' | 'inativo' | 'indisponivel';

export interface ItemMLStatus {
  id: string;
  status?: string;
  sub_status?: string[];
  available_quantity?: number;
  price?: number;
}

export interface StatusParsed {
  status: StatusPublicado;
  motivo: string | null;
  estoque: number | null;
  preco: number | null;
}

const MAP: Record<string, StatusPublicado> = {
  active: 'ativo',
  paused: 'pausado',
  closed: 'encerrado',
  inactive: 'inativo',
  under_review: 'moderado',
};

export function parseStatusML(item: ItemMLStatus | null): StatusParsed {
  if (!item || !item.status) {
    return { status: 'indisponivel', motivo: null, estoque: null, preco: null };
  }
  const sub = item.sub_status ?? [];
  const moderado = item.status === 'under_review' || sub.includes('waiting_for_patch');
  const status = moderado ? 'moderado' : (MAP[item.status] ?? 'indisponivel');
  return {
    status,
    motivo: moderado && sub.length ? sub.join(', ') : null,
    estoque: item.available_quantity ?? null,
    preco: item.price ?? null,
  };
}
