import { CircleCheck, CircleAlert, CircleX, CircleHelp, Truck } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { useTarifaML } from '@/hooks/useTarifaML';
import type { DimensoesFrete } from '@/lib/tarifa';
import { calcularSemaforo, freteSobConta, type Semaforo } from '@/lib/semaforo';

const CFG: Record<Semaforo, { tone: StatusTone; label: string; Icon: typeof CircleCheck }> = {
  verde: { tone: 'success', label: 'Vale a pena', Icon: CircleCheck },
  amarelo: { tone: 'warning', label: 'Abaixo do mínimo', Icon: CircleAlert },
  vermelho: { tone: 'danger', label: 'Prejuízo', Icon: CircleX },
  indisponivel: { tone: 'neutral', label: 'Viabilidade indisponível', Icon: CircleHelp },
};

/**
 * Semáforo "vale a pena publicar?" (ADR-0020). Usa a comissão Clássico do mesmo
 * `useTarifaML` do card "Você recebe" (react-query deduplica a chamada).
 */
export function SemaforoPreco({
  preco,
  piso,
  custo,
  categoriaMlId,
  dimensoes,
  aliquotaPct = 0,
}: {
  preco: number;
  piso: number;
  custo: number | null;
  categoriaMlId: string | null;
  /** Mesmas dimensões do card "Você recebe" — mantém o líquido consistente e dedupe na chamada. */
  dimensoes?: DimensoesFrete | null;
  /** Mesma alíquota do card "Você recebe" (ADR-0055) — mantém o líquido e o dedupe consistentes. */
  aliquotaPct?: number;
}) {
  const { data, isLoading } = useTarifaML(preco, categoriaMlId, dimensoes, aliquotaPct);
  const liquido = data ? data.classico.recebe : null;
  const sem: Semaforo = isLoading ? 'indisponivel' : calcularSemaforo(liquido, piso, custo);
  const cfg = CFG[sem];
  const Icon = cfg.Icon;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusPill tone={cfg.tone}>
        <Icon className="mr-1 h-3 w-3" />
        {cfg.label}
      </StatusPill>
      {freteSobConta(preco) && (
        <StatusPill tone="neutral" title="Acima de R$ 19 o Mercado Livre dá frete grátis ao comprador por sua conta">
          <Truck className="mr-1 h-3 w-3" />
          frete por sua conta
        </StatusPill>
      )}
    </div>
  );
}
