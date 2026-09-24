import { CircleAlert, CircleCheck, CircleHelp, CircleX } from 'lucide-react';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { fmtInt } from '@/lib/formato';
import type { ContagemPromo, SemaforoPromo } from '@/lib/promocoes';

// Mesmos tons/ícones do SemaforoPreco (src/components/semaforo-preco.tsx).
export const SEMAFORO_UI: Record<SemaforoPromo, { tone: StatusTone; label: string; Icon: typeof CircleCheck }> = {
  verde: { tone: 'success', label: 'Vale a pena', Icon: CircleCheck },
  amarelo: { tone: 'warning', label: 'Abaixo do mínimo', Icon: CircleAlert },
  vermelho: { tone: 'danger', label: 'Prejuízo', Icon: CircleX },
  indisponivel: { tone: 'neutral', label: 'Sem líquido', Icon: CircleHelp },
};
const ORDEM: SemaforoPromo[] = ['verde', 'amarelo', 'vermelho', 'indisponivel'];

export function ContagemSemaforo({ contagem, ativo, onFiltro }: {
  contagem: ContagemPromo; ativo?: SemaforoPromo | null; onFiltro?: (s: SemaforoPromo | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {ORDEM.map((s) => {
        const { tone, label, Icon } = SEMAFORO_UI[s];
        const pill = (
          <StatusPill tone={tone} title={label}>
            <Icon className="size-3.5" aria-hidden />
            <span className="tabular-nums">{fmtInt(contagem[s])}</span>
            <span className="sr-only md:not-sr-only">{label}</span>
          </StatusPill>
        );
        return onFiltro ? (
          <button key={s} type="button" aria-pressed={ativo === s} onClick={() => onFiltro(ativo === s ? null : s)}
            className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-ring">
            {pill}
          </button>
        ) : <span key={s}>{pill}</span>;
      })}
    </div>
  );
}
