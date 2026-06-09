import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
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

export function StatusBadge({ status }: { status: LoteStatus }) {
  return <StatusPill tone={TONES[status]}>{LABELS[status]}</StatusPill>;
}
