import { cn } from '@/lib/utils';
import { fmtPontos, motivoLegivel } from './formato-campanha';

interface Props {
  equilibrioPct: number | null;
  motivo: string | null;
  acosAlvo: number | null;
  /** Tom vem do alerta de domínio `roas_acima_margem`, nunca calculado aqui. */
  acima: boolean;
  className?: string;
}

/** Margem para Ads: o texto carrega o sentido, a régua é decorativa. Escala 0..max(equilíbrio, alvo)×1,2 (teto 100). */
export function ReguaMargem({ equilibrioPct, motivo, acosAlvo, acima, className }: Props) {
  if (equilibrioPct == null) {
    return <span className={cn('block text-sm text-muted-foreground', className)}>{motivoLegivel(motivo)}</span>;
  }
  if (equilibrioPct <= 0) {
    return <span className={cn('block text-sm font-medium text-danger', className)}>Sem espaço para Ads</span>;
  }
  const escala = Math.min(100, Math.max(equilibrioPct, acosAlvo ?? 0) * 1.2);
  const largura = Math.min(100, (equilibrioPct / escala) * 100);
  const marcador = acosAlvo != null && acosAlvo > 0 ? Math.min(100, (acosAlvo / escala) * 100) : null;
  // Trunca para baixo: 19,996 % contra alvo 20 % nunca pode aparecer como "20 % · alvo 20 %".
  const texto = `Aguenta até ${fmtPontos(Math.floor(equilibrioPct * 10) / 10)}${acosAlvo != null ? ` · alvo ${fmtPontos(acosAlvo)}` : ''}`;
  return (
    <div role="img" aria-label={`Margem para Ads: ${texto}`} className={cn('space-y-1.5', className)}>
      <div aria-hidden className="relative h-1.5 w-full max-w-40 rounded-full bg-muted">
        <div data-testid="regua-preenchimento" style={{ width: `${largura}%` }}
          className={cn('h-full rounded-full motion-safe:transition-[width]', acima ? 'bg-danger' : 'bg-success')} />
        {marcador != null && (
          <div data-testid="regua-alvo" style={{ left: `${marcador}%` }}
            className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground" />
        )}
      </div>
      <span className={cn('block text-sm tabular-nums', acima && 'font-medium text-danger')}>{texto}</span>
    </div>
  );
}
