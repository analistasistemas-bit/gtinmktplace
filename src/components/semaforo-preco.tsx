import { CircleCheck, CircleAlert, CircleX, CircleHelp, Truck } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { useTarifaML } from '@/hooks/useTarifaML';
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
}: {
  preco: number;
  piso: number;
  custo: number | null;
  categoriaMlId: string | null;
}) {
  const { data, isLoading } = useTarifaML(preco, categoriaMlId);
  const liquido = data ? data.classico.recebe : null;
  const sem: Semaforo = isLoading ? 'indisponivel' : calcularSemaforo(liquido, piso, custo);
  const cfg = CFG[sem];
  const Icon = cfg.Icon;
  return (
    <div className="flex flex-col items-start gap-1">
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
