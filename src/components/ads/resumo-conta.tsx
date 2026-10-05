import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtBRLSinal, fmtBRL } from '@/lib/formato';
import { cn } from '@/lib/utils';
import type { ContaPainel } from '@/lib/ads-painel';
import { dataBRT } from '@/components/sku-dossie/formato-dossie';

const NADA = '—';
export const pct = (v: number | null) => (v == null ? NADA : `${(v * 100).toFixed(1).replace('.', ',')}%`);
export const razao = (v: number | null) => (v == null ? NADA : `${v.toFixed(2).replace('.', ',')}×`);

const VALOR_PRIMARIO = 'text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl';

/** Resultado nulo: com `fonteCusto` nulo o lucro é desconhecido por histórico; senão, por custo (ADR-0179). */
function motivoResultadoConta(
  conta: ContaPainel,
  historicoDesde: string | null,
): string | null {
  if (conta.resultado != null) return null;

  if (conta.fonteCusto == null) {
    return historicoDesde
      ? `período antes do histórico de vendas (desde ${dataBRT(historicoDesde)})`
      : 'período antes do histórico de vendas';
  }

  return 'sem custo cadastrado';
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="text-right tabular-nums">{valor}</dd>
    </div>
  );
}

/**
 * Resumo da conta: despesa e resultado em destaque; provisório, custo e divergência ficam visíveis sem
 * expandir. A ponte só aparece com lucro conhecido e usa os valores do domínio, sem recalcular (ADR-0179).
 */
export function ResumoConta({ conta, historicoDesde }: { conta: ContaPainel; historicoDesde: string | null }) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  const idDespesa = `${id}-despesa`;
  const idResultado = `${id}-resultado`;
  const idComposicao = `${id}-composicao`;
  const motivo = motivoResultadoConta(conta, historicoDesde);
  const temPonte = conta.lucroAntes != null && conta.resultado != null;

  return (
    <section aria-label="Resumo da conta" className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-6">
      <h2 className="text-sm font-medium text-muted-foreground">Resumo da conta</h2>

      <div className="grid gap-6 sm:grid-cols-2">
        <div role="group" aria-labelledby={idDespesa} className="min-w-0 space-y-1">
          <p id={idDespesa} className="text-sm text-muted-foreground">Despesa de Ads</p>
          <p className={VALOR_PRIMARIO}>{fmtBRL(conta.custo)}</p>
        </div>

        <div role="group" aria-labelledby={idResultado} className="min-w-0 space-y-1">
          <p id={idResultado} className="text-sm text-muted-foreground">Resultado após Ads</p>
          <p className={cn(VALOR_PRIMARIO, conta.resultado != null && conta.resultado < 0 && 'text-danger')}>
            {conta.resultado == null ? NADA : fmtBRLSinal(conta.resultado)}
          </p>
          {motivo && <p className="text-xs text-muted-foreground">{motivo}</p>}
          {(conta.diasAbertos > 0 || conta.fonteCusto === 'parcial' || conta.fonteCusto === 'estimado') && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {conta.diasAbertos > 0 && (
                <StatusPill tone="warning" title="A atribuição de vendas do ML ainda pode mudar nestes dias.">
                  provisório — {conta.diasAbertos} {conta.diasAbertos === 1 ? 'dia' : 'dias'} com atribuição em aberto
                </StatusPill>
              )}
              {(conta.fonteCusto === 'parcial' || conta.fonteCusto === 'estimado') && (
                <StatusPill tone="neutral">custo {conta.fonteCusto}</StatusPill>
              )}
            </div>
          )}
          {conta.divergente && (
            <p role="alert" className="pt-1 text-sm text-warning">
              A soma dos grupos não fecha com o total da conta. A composição do gasto está indisponível.
            </p>
          )}
        </div>
      </div>

      {temPonte && (
        <div role="group" aria-label="Cálculo do resultado" className="rounded-md bg-muted/50 px-3 py-2 text-sm">
          <div className="flex items-baseline justify-between gap-3 sm:hidden">
            <span className="text-muted-foreground">Lucro antes de Ads</span>
            <span className="tabular-nums">{fmtBRL(conta.lucroAntes!)}</span>
          </div>
          <p className="hidden tabular-nums sm:block">
            <span className="text-muted-foreground">Lucro antes de Ads </span>{fmtBRL(conta.lucroAntes!)}
            <span className="text-muted-foreground"> − Despesa de Ads </span>{fmtBRL(conta.custo)}
            <span className="text-muted-foreground"> = Resultado após Ads </span>{fmtBRLSinal(conta.resultado!)}
          </p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">Resultado depois da despesa de Ads; não é o lucro causado pelo Ads.</p>

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 sm:h-8"
          aria-expanded={aberto}
          aria-controls={idComposicao}
          onClick={() => setAberto(v => !v)}
        >
          Composição e indicadores
          <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform', aberto && 'rotate-180')} />
        </Button>
      </div>

      {aberto && (
        <div id={idComposicao} role="region" aria-label="Composição e indicadores" className="grid gap-6 border-t border-border pt-4 sm:grid-cols-2">
          <dl className="space-y-1.5">
            <Linha rotulo="Em famílias" valor={fmtBRL(conta.emFamilias)} />
            <Linha rotulo="Compartilhado entre famílias" valor={fmtBRL(conta.compartilhado)} />
            {!conta.divergente && conta.naoIdentificado != null && (
              <Linha rotulo="Gasto de Ads não identificado"
                valor={`${fmtBRL(conta.naoIdentificado)}${conta.naoIdentificadoPct != null ? ` (${pct(conta.naoIdentificadoPct)})` : ''}`} />
            )}
          </dl>
          <dl className="space-y-1.5">
            <Linha rotulo="Margem consumida" valor={pct(conta.margemConsumida)} />
            <Linha rotulo="ROAS (total / direto)" valor={`${razao(conta.roas)} / ${razao(conta.roasDireto)}`} />
            <Linha rotulo="ACOS total" valor={pct(conta.acos)} />
            <Linha rotulo="Vendas atribuídas (total / direta)" valor={`${fmtBRL(conta.vendasTotais)} / ${fmtBRL(conta.vendasDiretas)}`} />
          </dl>
        </div>
      )}
    </section>
  );
}
