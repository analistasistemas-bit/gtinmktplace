import type { ReactNode } from 'react';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtBRLSinal, fmtBRL } from '@/lib/formato';
import type { ContaPainel } from '@/lib/ads-painel';

const NADA = '—';
export const pct = (v: number | null) => (v == null ? NADA : `${(v * 100).toFixed(1).replace('.', ',')}%`);
export const razao = (v: number | null) => (v == null ? NADA : `${v.toFixed(2).replace('.', ',')}×`);
const brl = (v: number | null) => (v == null ? NADA : fmtBRL(v));

function Bloco({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-lg font-semibold tabular-nums">{children}</p>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className="tabular-nums">{valor}</span>
    </div>
  );
}

/** Resumo da conta: lucro antes de Ads → despesa (3 parcelas) → resultado após Ads (ADR-0179). */
export function ResumoConta({ conta }: { conta: ContaPainel }) {
  return (
    <section aria-label="Resumo da conta" className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">Resumo da conta</h2>
        {conta.diasAbertos > 0 && (
          <StatusPill tone="warning" title="A atribuição de vendas do ML ainda pode mudar nestes dias.">
            provisório — {conta.diasAbertos} {conta.diasAbertos === 1 ? 'dia' : 'dias'} com atribuição em aberto
          </StatusPill>
        )}
        {(conta.fonteCusto === 'parcial' || conta.fonteCusto === 'estimado') && <StatusPill tone="neutral">custo {conta.fonteCusto}</StatusPill>}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Bloco rotulo="Lucro antes de Ads">{brl(conta.lucroAntes)}</Bloco>
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">Despesa de Ads</p>
          <p className="text-lg font-semibold tabular-nums">{fmtBRL(conta.custo)}</p>
          <Linha rotulo="Em famílias" valor={fmtBRL(conta.emFamilias)} />
          <Linha rotulo="Compartilhado entre famílias" valor={fmtBRL(conta.compartilhado)} />
          {!conta.divergente && conta.naoIdentificado != null && (
            <Linha rotulo="Gasto de Ads não identificado"
              valor={`${fmtBRL(conta.naoIdentificado)}${conta.naoIdentificadoPct != null ? ` (${pct(conta.naoIdentificadoPct)})` : ''}`} />
          )}
        </div>
        <Bloco rotulo="Resultado após Ads">
          <span className={conta.resultado != null && conta.resultado < 0 ? 'text-danger' : undefined}>
            {conta.resultado == null ? NADA : fmtBRLSinal(conta.resultado)}
          </span>
        </Bloco>
      </div>
      {conta.divergente && (
        <p role="alert" className="mt-3 text-sm text-warning">A soma dos grupos não fecha com o total da conta; o gasto não identificado fica oculto.</p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-3 sm:grid-cols-4">
        <Bloco rotulo="Margem consumida">{pct(conta.margemConsumida)}</Bloco>
        <Bloco rotulo="ROAS (total / direto)">{razao(conta.roas)} / {razao(conta.roasDireto)}</Bloco>
        <Bloco rotulo="ACOS">{pct(conta.acos)}</Bloco>
        <Bloco rotulo="Vendas atribuídas (total / direto)">{fmtBRL(conta.vendasTotais)} / {fmtBRL(conta.vendasDiretas)}</Bloco>
      </div>
    </section>
  );
}
