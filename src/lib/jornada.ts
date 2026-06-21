import type { LoteStatus } from '@/lib/tipos-dominio';

export interface EtapaJornada {
  chave: string;
  label: string;
}

/** As 4 etapas visíveis da jornada do lote. `erro` é estado lateral, não etapa. */
export const ETAPAS_JORNADA: EtapaJornada[] = [
  { chave: 'enviado', label: 'Enviado' },
  { chave: 'processando', label: 'Processando' },
  { chave: 'revisao', label: 'Revisão' },
  { chave: 'publicado', label: 'Publicado' },
];

export interface EstadoJornada {
  /** Índice da etapa atual (0-3); ETAPAS_JORNADA.length (4) = tudo concluído. */
  indiceAtual: number;
  erro: boolean;
}

/** Mapeia o status técnico do lote para a posição na jornada visível. */
export function jornadaDoLote(status: LoteStatus): EstadoJornada {
  switch (status) {
    case 'importando':
      return { indiceAtual: 0, erro: false };
    case 'processando':
      return { indiceAtual: 1, erro: false };
    case 'revisao':
      return { indiceAtual: 2, erro: false };
    case 'publicando':
      return { indiceAtual: 3, erro: false };
    case 'concluido':
      return { indiceAtual: ETAPAS_JORNADA.length, erro: false };
    case 'erro':
      // Falha global de ingest/processamento: marca a etapa Processando.
      return { indiceAtual: 1, erro: true };
  }
}

/** Destino de retomada do lote conforme o status ("continuar de onde parei"). */
export function destinoDoLote(status: LoteStatus, id: string): string {
  if (status === 'revisao') return `/revisao/${id}`;
  if (status === 'concluido' || status === 'erro') return `/relatorio/${id}`;
  return `/progresso/${id}`;
}
