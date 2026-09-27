import { AlertTriangle } from 'lucide-react';
import type { DossieSku } from '@/lib/sku-dossie';
import { dataBR } from '@/components/sku-dossie/formato-dossie';

// ponytail: mesmo limiar do KPI "Faturamento com custo real" da aba (80%); recalibrar junto.
const LIMIAR_CUSTO_REAL = 0.8;

/** Discreto de propósito: diz até onde o histórico vai, sem competir com os números. */
export function QualidadeHistorico({ historicoDesde, qualidade }: Pick<DossieSku, 'historicoDesde' | 'qualidade'>) {
  const pct = qualidade.pctBrutoCustoReal;
  return (
    <section aria-labelledby="dossie-qualidade" className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
      <div className="flex flex-col gap-1.5 lg:flex-row lg:flex-wrap lg:items-baseline lg:gap-x-4">
        <h2 id="dossie-qualidade" className="font-medium text-foreground">Qualidade do histórico</h2>
        <p>
          {historicoDesde
            ? <span className="tabular-nums">{`Histórico desde ${dataBR(historicoDesde)}, a 1ª venda registrada no PubliAI.`}</span>
            : 'Nenhuma venda registrada no PubliAI.'}
        </p>
        {pct != null && (
          <p>
            {pct < LIMIAR_CUSTO_REAL && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-warning" aria-label="Abaixo de 80%" />}
            <span className="font-medium tabular-nums text-foreground">{(pct * 100).toFixed(1).replace('.', ',')}%</span>{' '}
            do faturamento com custo real.
          </p>
        )}
      </div>
      {qualidade.fontesParciais.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
          <span>Cobertura parcial:</span>
          <ul className="contents">
            {qualidade.fontesParciais.map((f, i) => (
              <li key={f}>{f}{i < qualidade.fontesParciais.length - 1 ? ';' : '.'}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
