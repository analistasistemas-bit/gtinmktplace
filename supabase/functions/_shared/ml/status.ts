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

// Marcadores de moderação no sub_status que valem "moderado" qualquer que seja o status.
const MODERACAO_SUBS = ['forbidden', 'waiting_for_patch', 'poor_quality_thumbnail', 'poor_quality_picture'];

export function parseStatusML(item: ItemMLStatus | null): StatusParsed {
  if (!item || !item.status) {
    return { status: 'indisponivel', motivo: null, estoque: null, preco: null };
  }
  const sub = item.sub_status ?? [];
  // O ML move um item moderado de `under_review` para `inactive` (+ `deleted`) em horas, então
  // checar só o status perderia a janela. Qualquer marcador de moderação no sub_status já conta.
  const moderado = item.status === 'under_review' || sub.some((s) => MODERACAO_SUBS.includes(s));
  const status = moderado ? 'moderado' : (MAP[item.status] ?? 'indisponivel');
  return {
    status,
    motivo: moderado && sub.length ? sub.join(', ') : null,
    estoque: item.available_quantity ?? null,
    preco: item.price ?? null,
  };
}
