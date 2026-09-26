import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, CircleHelp, CircleX } from 'lucide-react';
import type { StatusTone } from '@/components/ui/status-pill';
import { fmtInt } from '@/lib/formato';
import { cn } from '@/lib/utils';
import type { ContagemPromo, SemaforoPromo } from '@/lib/promocoes';

// Mesmos tons/ícones do SemaforoPreco (src/components/semaforo-preco.tsx).
export const SEMAFORO_UI: Record<SemaforoPromo, { tone: StatusTone; label: string; Icon: typeof CircleCheck; dot: string; text: string }> = {
  verde: { tone: 'success', label: 'Vale a pena', Icon: CircleCheck, dot: 'bg-success', text: 'text-success' },
  amarelo: { tone: 'warning', label: 'Abaixo do mínimo', Icon: CircleAlert, dot: 'bg-warning', text: 'text-warning' },
  vermelho: { tone: 'danger', label: 'Prejuízo', Icon: CircleX, dot: 'bg-danger', text: 'text-danger' },
  indisponivel: { tone: 'neutral', label: 'Sem líquido', Icon: CircleHelp, dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
};
const ORDEM: SemaforoPromo[] = ['verde', 'amarelo', 'vermelho', 'indisponivel'];

const CHIP_CLASS = 'min-h-11 inline-flex items-center gap-2 rounded-lg border bg-card px-3 text-sm shadow-xs transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary/60 aria-pressed:bg-primary/5 aria-pressed:ring-1 aria-pressed:ring-primary/40 disabled:opacity-50 disabled:pointer-events-none';

/** Chip de filtro reutilizável (mesma aparência do gatilho de aba) para grupos `aria-pressed`
 *  sem painel associado; usado pelos semáforos e pelo "Todos" do detalhe. */
export function ChipFiltro({ ativo, onClick, disabled, title, ariaLabel, children }: {
  ativo: boolean; onClick: () => void; disabled?: boolean; title?: string; ariaLabel?: string; children: ReactNode;
}) {
  return (
    <button type="button" aria-pressed={ativo} disabled={disabled} title={title} aria-label={ariaLabel} onClick={onClick}
      className={CHIP_CLASS}>
      {children}
    </button>
  );
}

/** Barra + legenda somente leitura da distribuição de semáforos (card de campanha). */
export function DistribuicaoSemaforo({ contagem }: { contagem: ContagemPromo }) {
  const total = ORDEM.reduce((soma, s) => soma + contagem[s], 0);
  if (total === 0) return <p className="text-xs text-muted-foreground">Nenhum anúncio convidado.</p>;
  const presentes = ORDEM.filter((s) => contagem[s] > 0);
  const ariaLabel = presentes.map((s) => `${fmtInt(contagem[s])} ${SEMAFORO_UI[s].label.toLowerCase()}`).join(', ');
  return (
    <div>
      <div role="img" aria-label={ariaLabel} className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
        {presentes.map((s) => (
          <span key={s} style={{ flexGrow: contagem[s] }} className={cn('min-w-1 rounded-full', SEMAFORO_UI[s].dot)} />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {presentes.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn('size-2 rounded-full', SEMAFORO_UI[s].dot)} />
            <span className="font-medium tabular-nums text-foreground">{fmtInt(contagem[s])}</span>
            <span className="text-muted-foreground">{SEMAFORO_UI[s].label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Filtro por semáforo (detalhe): cada semáforo é um chip `aria-pressed`. */
export function ContagemSemaforo({ contagem, ativo, onFiltro }: {
  contagem: ContagemPromo; ativo?: SemaforoPromo | null; onFiltro?: (s: SemaforoPromo | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {ORDEM.map((s) => {
        const { label, dot } = SEMAFORO_UI[s];
        const n = contagem[s];
        const isAtivo = ativo === s;
        const conteudo = (
          <>
            <span className={cn('size-2 rounded-full', dot)} aria-hidden />
            <span className="font-semibold tabular-nums">{fmtInt(n)}</span>
            <span className="hidden text-muted-foreground sm:inline">{label}</span>
          </>
        );
        return onFiltro ? (
          <ChipFiltro key={s} ativo={isAtivo} disabled={n === 0 && !isAtivo} title={label}
            ariaLabel={`${label}: ${n}`} onClick={() => onFiltro(isAtivo ? null : s)}>
            {conteudo}
          </ChipFiltro>
        ) : (
          <span key={s} title={label} aria-label={`${label}: ${n}`} className={CHIP_CLASS}>
            {conteudo}
          </span>
        );
      })}
    </div>
  );
}
