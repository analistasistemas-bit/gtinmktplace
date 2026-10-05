import { useId, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Equal, Info, Minus, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtBRLSinal, fmtBRL } from '@/lib/formato';
import { cn } from '@/lib/utils';
import type { ContaPainel } from '@/lib/ads-painel';
import { NADA, pct, razao } from '@/lib/ads-apresentacao';
import { dataBRT } from '@/components/sku-dossie/formato-dossie';

const ROTULO = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';
const LEGENDA = 'text-xs text-muted-foreground';

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

/** Termo da ponte: linha compacta no mobile, coluna no desktop; `empilhado` = coluna sempre (resumo sem ponte). */
function Termo({ rotulo, valor, legenda, empilhado }: { rotulo: string; valor: string; legenda: string; empilhado?: boolean }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}
      className={cn('min-w-0', empilhado ? 'space-y-1' : 'flex items-baseline justify-between gap-3 md:block md:space-y-1')}>
      <p id={id} className={cn(ROTULO, 'shrink-0')}>{rotulo}</p>
      <div className={cn('min-w-0', !empilhado && 'text-right md:text-left')}>
        <p className={cn('font-semibold tracking-tight tabular-nums md:text-2xl xl:text-3xl', empilhado ? 'text-2xl' : 'text-lg')}>{valor}</p>
        <p className={LEGENDA}>{legenda}</p>
      </div>
    </div>
  );
}

/** Operador visual da ponte; no mobile vira só texto para leitor de tela (o "igual" vira separador). */
function Operador({ icone: Icone, texto, separador }: { icone: LucideIcon; texto: string; separador?: boolean }) {
  return (
    <div className={cn('md:flex md:justify-center', separador && 'border-t border-border md:border-0')}>
      <span aria-hidden className="hidden size-8 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground md:flex">
        <Icone className="size-4" />
      </span>
      <span className="sr-only">{texto}</span>
    </div>
  );
}

function PainelResultado({ conta, motivo, className }: { conta: ContaPainel; motivo: string | null; className?: string }) {
  const id = useId();
  const negativo = conta.resultado != null && conta.resultado < 0;
  return (
    <div
      role="group"
      aria-labelledby={id}
      className={cn(
        'min-w-0 space-y-1 rounded-lg border border-l-2 border-border bg-muted/30 p-4',
        conta.resultado == null ? 'border-l-border' : negativo ? 'border-l-danger' : 'border-l-primary',
        className,
      )}
    >
      <p id={id} className={ROTULO}>Resultado após Ads</p>
      <p className={cn('text-3xl font-semibold tracking-tight tabular-nums lg:text-4xl', negativo && 'text-danger')}>
        {conta.resultado == null ? NADA : fmtBRLSinal(conta.resultado)}
      </p>
      {motivo && <p className={LEGENDA}>{motivo}</p>}
    </div>
  );
}

function Ponto({ cor }: { cor: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', cor)} />;
}

/** Barra da margem: só com margem positiva (o domínio só calcula `margemConsumida` com lucro > 0). */
function BarraMargem({ consumida }: { consumida: number }) {
  const excede = consumida > 1;
  const rotulo = excede
    ? `Ads consumiu mais que a margem (${pct(consumida)})`
    : `Ads consumiu ${pct(consumida)} da margem; resultado ${pct(1 - consumida)}`;
  return (
    <div className="space-y-2">
      <div role="img" aria-label={rotulo} className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {excede ? (
          <div className="h-full w-full bg-danger" />
        ) : (
          <>
            <div className="h-full bg-primary motion-safe:transition-[width]" style={{ width: `${(1 - consumida) * 100}%` }} />
            <div className="h-full bg-warning motion-safe:transition-[width]" style={{ width: `${consumida * 100}%` }} />
          </>
        )}
      </div>
      <div aria-hidden className={cn(LEGENDA, 'flex flex-col gap-1 sm:flex-row sm:justify-between')}>
        {excede ? (
          <span className="flex items-center gap-2"><Ponto cor="bg-danger" />Ads consumiu mais que a margem ({pct(consumida)})</span>
        ) : (
          <>
            <span className="flex items-center gap-2"><Ponto cor="bg-primary" />Resultado {pct(1 - consumida)} da margem</span>
            <span className="flex items-center gap-2"><Ponto cor="bg-warning" />Ads consumiu {pct(consumida)}</span>
          </>
        )}
      </div>
    </div>
  );
}

function Indicador({ rotulo, valor, detalhe, className }: { rotulo: string; valor: string; detalhe?: ReactNode; className?: string }) {
  return (
    <dl className={cn('min-w-0 space-y-0.5', className)}>
      <dt className={ROTULO}>{rotulo}</dt>
      <dd className="text-lg font-semibold tracking-tight tabular-nums">{valor}</dd>
      {detalhe && <dd className={cn(LEGENDA, 'tabular-nums')}>{detalhe}</dd>}
    </dl>
  );
}

function LinhaComposicao({ cor, rotulo, valor }: { cor: string; rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="flex items-center gap-2 text-muted-foreground"><Ponto cor={cor} />{rotulo}</dt>
      <dd className="shrink-0 text-right tabular-nums">{valor}</dd>
    </div>
  );
}

/**
 * Resumo da conta: ponte Lucro antes − Despesa = Resultado, barra da margem e indicadores sempre visíveis;
 * provisório, custo e divergência ficam visíveis sem expandir. Usa os valores do domínio, sem recalcular (ADR-0179).
 */
export function ResumoConta({ conta, historicoDesde }: { conta: ContaPainel; historicoDesde: string | null }) {
  const [aberto, setAberto] = useState(false);
  const idComposicao = `${useId()}-composicao`;
  const motivo = motivoResultadoConta(conta, historicoDesde);
  const temPonte = conta.lucroAntes != null && conta.resultado != null;
  const legendaDespesa = conta.margemConsumida != null
    ? `${pct(conta.margemConsumida)} da margem`
    : 'despesa informada pela API de Ads';
  const custoMarcado = conta.fonteCusto === 'parcial' || conta.fonteCusto === 'estimado';
  // ponytail: sem barra da composição quando divergente — as parcelas não fecham com o total.
  const segmentos = !conta.divergente && conta.custo > 0 && conta.naoIdentificado != null
    ? [
      { cor: 'bg-primary', v: conta.emFamilias },
      { cor: 'bg-primary/50', v: conta.compartilhado },
      { cor: 'bg-muted-foreground/40', v: conta.naoIdentificado },
    ]
    : null;

  return (
    <section aria-label="Resumo da conta" className="space-y-6 rounded-lg border border-border bg-card p-4 sm:p-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Resumo da conta</h2>
          {(conta.diasAbertos > 0 || custoMarcado) && (
            <div className="flex flex-wrap gap-1.5">
              {conta.diasAbertos > 0 && (
                <StatusPill tone="warning" title="A atribuição de vendas do ML ainda pode mudar nestes dias.">
                  provisório — {conta.diasAbertos} {conta.diasAbertos === 1 ? 'dia' : 'dias'} com atribuição em aberto
                </StatusPill>
              )}
              {custoMarcado && <StatusPill tone="neutral">custo {conta.fonteCusto}</StatusPill>}
            </div>
          )}
        </div>
        {conta.divergente && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
            A soma dos grupos não fecha com o total da conta. A composição do gasto está indisponível.
          </p>
        )}
      </div>

      {temPonte ? (
        <div className="space-y-4">
          <div
            role="group"
            aria-label="Cálculo do resultado"
            className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1.25fr] md:items-center md:gap-4"
          >
            <Termo rotulo="Lucro antes de Ads" valor={fmtBRL(conta.lucroAntes!)} legenda="vendas do período" />
            <Operador icone={Minus} texto="menos" />
            <Termo rotulo="Despesa de Ads" valor={fmtBRL(conta.custo)} legenda={legendaDespesa} />
            <Operador icone={Equal} texto="igual a" separador />
            <PainelResultado conta={conta} motivo={motivo} />
          </div>
          {conta.lucroAntes! > 0 && conta.margemConsumida != null && <BarraMargem consumida={conta.margemConsumida} />}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[1fr_1.25fr] md:items-center md:gap-6 lg:grid-cols-[1fr_2rem_1fr_2rem_1.25fr] lg:gap-4">
          <Termo rotulo="Despesa de Ads" valor={fmtBRL(conta.custo)} legenda={legendaDespesa} empilhado />
          <PainelResultado conta={conta} motivo={motivo} className="lg:col-span-3 lg:col-start-3" />
        </div>
      )}

      <div className="space-y-4 border-t border-border pt-4">
        {/* lg: mesmas colunas da ponte (operadores = 2rem), para ROAS/ACOS/Vendas alinharem com os termos acima. */}
        <div role="group" aria-label="Indicadores"
          className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-[1fr_2rem_1fr_2rem_1.25fr] lg:gap-x-4">
          <Indicador rotulo="ROAS" valor={razao(conta.roas)} detalhe={`direto ${razao(conta.roasDireto)}`} />
          <Indicador rotulo="ACOS" valor={pct(conta.acos)} className="lg:col-start-3" />
          <div className="col-span-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-4 sm:col-span-1 lg:col-start-5">
            <Indicador rotulo="Vendas atribuídas" valor={fmtBRL(conta.vendasTotais)} detalhe={`direta ${fmtBRL(conta.vendasDiretas)}`} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 sm:h-8"
              aria-expanded={aberto}
              aria-controls={idComposicao}
              onClick={() => setAberto(v => !v)}
            >
              Composição do gasto
              <ChevronDown aria-hidden className={cn('size-4 motion-safe:transition-transform', aberto && 'rotate-180')} />
            </Button>
          </div>
        </div>

        {/* Montada sempre (hidden quando fechada) para o aria-controls apontar para um id existente. */}
        <div id={idComposicao} role="region" aria-label="Composição do gasto" hidden={!aberto}
          className="space-y-3 rounded-md bg-muted/30 p-3 sm:p-4">
          {segmentos && (
            <div aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-muted">
              {segmentos.map(s => (
                <div key={s.cor} className={cn('h-full', s.cor)} style={{ width: `${(s.v / conta.custo) * 100}%` }} />
              ))}
            </div>
          )}
          <dl className="space-y-1.5">
            <LinhaComposicao cor="bg-primary" rotulo="Em famílias" valor={fmtBRL(conta.emFamilias)} />
            <LinhaComposicao cor="bg-primary/50" rotulo="Compartilhado entre famílias" valor={fmtBRL(conta.compartilhado)} />
            {!conta.divergente && conta.naoIdentificado != null && (
              <LinhaComposicao cor="bg-muted-foreground/40" rotulo="Gasto de Ads não identificado"
                valor={`${fmtBRL(conta.naoIdentificado)}${conta.naoIdentificadoPct != null ? ` (${pct(conta.naoIdentificadoPct)})` : ''}`} />
            )}
          </dl>
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info aria-hidden className="mt-px size-3.5 shrink-0" />
        Resultado depois da despesa de Ads; não é o lucro causado pelo Ads.
      </p>
    </section>
  );
}
