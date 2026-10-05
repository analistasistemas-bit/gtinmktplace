import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fmtBRL } from '@/lib/formato';
import { cn } from '@/lib/utils';
import type { PainelAds } from '@/lib/ads-painel';
import { pct } from '@/lib/ads-apresentacao';

export interface GastosAssociadosProps {
  painel: PainelAds;
}

const detalheGrupo = (g: PainelAds['compartilhados'][number]) =>
  g.familias.length
    ? `Grupo ${g.id}: ${g.familias.join(', ')}${g.semCodigo > 0 ? ` + ${g.semCodigo} sem código` : ''}`
    : `Grupo ${g.id}: sem código identificado (${g.semCodigo} ${g.semCodigo === 1 ? 'anúncio' : 'anúncios'})`;

/** Gasto que não é de nenhuma família: compartilhados e não identificado. Recebe o painel inteiro, nunca a
 *  lista filtrada, e não rateia nada entre famílias (ADR-0179 D2). */
export function GastosAssociados({ painel }: GastosAssociadosProps) {
  const [aberto, setAberto] = useState(false);
  const idGrupos = useId();
  const { conta, compartilhados } = painel;
  const totalCompartilhado = conta?.compartilhado ?? compartilhados.reduce((s, g) => s + g.custo, 0);
  const naoId = conta && !conta.divergente ? conta.naoIdentificado : null;

  if (!compartilhados.length && naoId == null) return null;

  return (
    <section aria-label="Gastos associados" className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-medium">Gastos associados</h2>
        <p className="text-xs text-muted-foreground">Fora do gasto das famílias e sem rateio entre elas.</p>
      </div>

      {compartilhados.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 h-auto min-h-11 min-w-0 shrink py-1 whitespace-normal text-left sm:min-h-8"
              aria-expanded={aberto}
              aria-controls={idGrupos}
              onClick={() => setAberto(v => !v)}
            >
              Compartilhado entre famílias ({compartilhados.length} {compartilhados.length === 1 ? 'grupo' : 'grupos'})
              <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', aberto && 'rotate-180')} />
            </Button>
            <span className="shrink-0 text-sm tabular-nums">{fmtBRL(totalCompartilhado)}</span>
          </div>
          {aberto && (
            <ul id={idGrupos} className="space-y-1 border-l border-border pl-3 text-sm text-muted-foreground">
              {compartilhados.map(g => (
                <li key={g.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words">{detalheGrupo(g)}</span>
                  <span className="shrink-0 tabular-nums">{fmtBRL(g.custo)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {naoId != null && (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span>Gasto de Ads não identificado</span>
          <span className="shrink-0 tabular-nums">
            {fmtBRL(naoId)}{conta?.naoIdentificadoPct != null ? ` (${pct(conta.naoIdentificadoPct)})` : ''}
          </span>
        </div>
      )}
    </section>
  );
}
