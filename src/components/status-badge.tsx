import { Badge } from '@/components/ui/badge';
import type { LoteStatus } from '@/lib/mocks/types';

const LABELS: Record<LoteStatus, string> = {
  importando: 'Importando',
  processando: 'Processando',
  revisao: 'Em revisão',
  publicando: 'Publicando',
  concluido: 'Concluído',
  erro: 'Erro',
};

const VARIANTS: Record<LoteStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  importando: 'outline',
  processando: 'outline',
  revisao: 'default',
  publicando: 'secondary',
  concluido: 'secondary',
  erro: 'destructive',
};

export function StatusBadge({ status }: { status: LoteStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}
