import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { loteFalhouNaPublicacao, type ResultadoPublicacao } from '@/lib/jornada';
import type { LoteStatus } from '@/lib/tipos-dominio';

const LABELS: Record<LoteStatus, string> = {
  importando: 'Importando',
  processando: 'Processando',
  revisao: 'Em revisão',
  publicando: 'Publicando',
  concluido: 'Concluído',
  erro: 'Erro',
};

const TONES: Record<LoteStatus, StatusTone> = {
  importando: 'info',
  processando: 'info',
  revisao: 'info',
  publicando: 'info',
  concluido: 'success',
  erro: 'danger',
};

interface Props {
  status: LoteStatus;
  /** Desfecho da publicação, quando a tela souber: lote fechado sem nenhuma família publicada
   *  não é "Concluído" verde. Mesma regra do stepper (`loteFalhouNaPublicacao`). */
  resultado?: ResultadoPublicacao;
}

export function StatusBadge({ status, resultado }: Props) {
  if (loteFalhouNaPublicacao(status, resultado)) {
    return <StatusPill tone="danger">Não publicado</StatusPill>;
  }
  return <StatusPill tone={TONES[status]}>{LABELS[status]}</StatusPill>;
}
