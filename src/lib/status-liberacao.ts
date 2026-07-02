export type StatusLiberacao = 'aliberar' | 'liberado' | 'sacado' | 'sem_data';

export interface DadosStatusLiberacao {
  money_release_date: string | null;
  sacado_em: string | null;
}

export function statusLiberacao(v: DadosStatusLiberacao, agoraMs: number = Date.now()): StatusLiberacao {
  if (v.sacado_em) return 'sacado';
  if (!v.money_release_date) return 'sem_data';
  return Date.parse(v.money_release_date) <= agoraMs ? 'liberado' : 'aliberar';
}

export function labelStatusLiberacao(status: StatusLiberacao): string {
  switch (status) {
    case 'aliberar': return 'a liberar';
    case 'liberado': return 'liberado';
    case 'sacado': return 'sacado';
    case 'sem_data': return '—';
  }
}
