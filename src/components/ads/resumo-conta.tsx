import { useId, useState } from 'react';
import { AlertTriangle, ChevronDown, Info, Minus, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KpiInfoButton } from '@/components/ui/kpi-card';
import { StatusPill } from '@/components/ui/status-pill';
import { fmtBRLSinal, fmtBRL } from '@/lib/formato';
import { cn } from '@/lib/utils';
import type { ContaPainel } from '@/lib/ads-painel';
import type { ResultadoContaAds } from '@/hooks/useAdsPainel';
import { NADA, pct } from '@/lib/ads-apresentacao';
import { dataBRT } from '@/components/sku-dossie/formato-dossie';

const ROTULO = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';
const LEGENDA = 'text-xs text-muted-foreground';

const MSG_CAUSAL = 'Resultado depois da despesa de Ads; não é o lucro causado pelo Ads.';
const PREFIXO = 'Resultado indisponível: ';

/** Motivo do resultado nulo (plano §4.9): fiscal, origem, histórico, custo; sem conta, série ao vivo ou catálogo. */
function motivoResultadoConta(
  conta: ResultadoContaAds | null,
  motivoConta: MotivoConta,
  historicoDesde: string | null,
): string | null {
  if (!conta) {
    return motivoConta === 'catalogo'
      ? `${PREFIXO}o catálogo não carregou, então o custo dos produtos é desconhecido.`
      : `${PREFIXO}a leitura ao vivo do ML veio incompleta neste período.`;
  }
  if (conta.resultado != null) return null;
  // Origem não resolvida: as alíquotas existem, falta a origem do produto (ADR-0055).
  if (conta.motivoFiscal === 'origem_nao_resolvida') return `${PREFIXO}produto vendido sem origem (nacional/importado).`;
  if (conta.motivoFiscal != null) return `${PREFIXO}confirme as alíquotas em Configurações.`;
  if (conta.fonteCusto == null) {
    return `${PREFIXO}período antes do histórico de vendas${historicoDesde ? ` (desde ${dataBRT(historicoDesde)})` : ''}.`;
  }
  return `${PREFIXO}sem custo cadastrado.`;
}

/** Termo da ponte: linha compacta no mobile, coluna no desktop; `empilhado` = coluna sempre (resumo sem ponte). */
function Termo({ rotulo, valor, legenda, empilhado }: { rotulo: string; valor: string; legenda: string; empilhado?: boolean }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}
      className={cn('min-w-0', empilhado ? 'space-y-1' : 'flex items-baseline justify-between gap-3 md:block md:space-y-1')}>
      {/* "O que é" ao lado do rótulo, fora do elemento que nomeia o grupo (aria-labelledby). */}
      <div className="flex shrink-0 items-center gap-1">
        <p id={id} className={ROTULO}>{rotulo}</p>
        <KpiInfoButton infoKey={`${rotulo}::Ads`} />
      </div>
      <div className={cn('min-w-0', !empilhado && 'text-right md:text-left')}>
        <p className={cn('font-semibold tracking-tight tabular-nums', empilhado ? 'text-xl' : 'text-lg md:text-xl')}>{valor}</p>
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

/** Estado do resultado (plano §4.7): fonte única do painel e da linha-resumo; cor só com base completa (custo real). */
function derivarResultado(conta: ResultadoContaAds | null) {
  const parcial = conta?.fonteCusto === 'parcial';
  const estimado = conta?.fonteCusto === 'estimado';
  const resultado = conta?.resultado ?? null;
  const negativo = resultado != null && resultado < 0 && conta?.fonteCusto === 'real';
  return { parcial, estimado, resultado, negativo, rotulo: parcial ? 'Resultado parcial após Ads' : 'Resultado após Ads' };
}

function PainelResultado({ conta, motivo }: { conta: ResultadoContaAds | null; motivo: string | null }) {
  const id = useId();
  const { parcial, estimado, resultado, negativo, rotulo } = derivarResultado(conta);
  return (
    <div
      role="group"
      aria-labelledby={id}
      className={cn(
        'min-w-0 space-y-1 rounded-lg border border-l-2 border-border bg-muted/30 p-4',
        resultado == null ? 'border-l-border' : negativo ? 'border-l-danger' : 'border-l-primary',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p id={id} className={ROTULO}>{rotulo}</p>
        {/* Só o parcial: a descrição de "Resultado após Ads::Ads" é a da família, não a da conta. */}
        {parcial && <KpiInfoButton infoKey="Resultado parcial após Ads::Ads" />}
        {estimado && <StatusPill tone="neutral">Estimado</StatusPill>}
      </div>
      <p className={cn('text-3xl font-semibold tracking-tight tabular-nums', negativo && 'text-danger')}>
        {resultado == null ? NADA : fmtBRLSinal(resultado)}
      </p>
      {motivo && <p className={LEGENDA}>{motivo}</p>}
      {parcial && resultado != null && <p className={LEGENDA}>Lucro calculado só com as vendas com custo cadastrado.</p>}
      {estimado && resultado != null && <p className={LEGENDA}>Há custo estimado nas vendas do período.</p>}
    </div>
  );
}

/**
 * Linha-resumo da primeira dobra (QA 2026-10-31, P1): responde "o Ads dá lucro?" antes dos KPIs, com o mesmo
 * estado, a mesma cor (só com base completa) e os mesmos motivos do painel de resultado. Sem cálculo próprio.
 * `onVerAcima` só existe em Desempenho; em Campanhas o atalho é omitido.
 */
export function LinhaResultado({ conta, motivo: motivoConta = null, historicoDesde, onVerAcima }: {
  conta: ResultadoContaAds | null;
  motivo?: MotivoConta;
  historicoDesde: string | null;
  onVerAcima?: () => void;
}) {
  const id = useId();
  const { parcial, estimado, resultado, negativo, rotulo } = derivarResultado(conta);
  const nota = motivoResultadoConta(conta, motivoConta, historicoDesde)
    ?? (parcial ? 'Lucro calculado só com as vendas com custo cadastrado.' : estimado ? 'Há custo estimado nas vendas do período.' : null);
  return (
    <div
      role="group"
      aria-labelledby={id}
      data-testid="linha-resultado"
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border border-l-4 border-border bg-card px-4 py-3',
        resultado == null ? 'border-l-border' : negativo ? 'border-l-danger' : 'border-l-primary',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        <p id={id} className={ROTULO}>{rotulo}</p>
        <p className={cn('text-2xl font-semibold tracking-tight tabular-nums', negativo && 'text-danger')}>
          {resultado == null ? NADA : fmtBRLSinal(resultado)}
        </p>
        {estimado && <StatusPill tone="neutral">Estimado</StatusPill>}
        {nota && <p className={cn(LEGENDA, 'min-w-0')}>{nota}</p>}
      </div>
      {onVerAcima && (
        <Button type="button" variant="outline" size="sm" className="h-8 max-sm:h-11 pointer-coarse:h-11" onClick={onVerAcima}>
          Ver famílias acima do equilíbrio
        </Button>
      )}
    </div>
  );
}

/** Referência neutra do mix vendido (plano §2.6): lucro antes de Ads ÷ faturamento, sem comparar com o ACOS total. */
function EquilibrioConta({ conta, faturamento }: { conta: ResultadoContaAds | null; faturamento: number | null }) {
  const id = useId();
  const baseCompleta = conta != null && conta.lucroAntes != null && conta.motivoFiscal == null
    && (conta.fonteCusto === 'real' || conta.fonteCusto === 'estimado');
  const valor = baseCompleta && faturamento != null && faturamento > 0 ? conta.lucroAntes! / faturamento : null;
  const legenda = valor != null
    ? 'Lucro antes de Ads ÷ vendas do período. Referência do mix vendido; não é meta de ACOS.'
    : conta?.fonteCusto === 'parcial'
      ? 'Indisponível: há vendas sem custo cadastrado.'
      : 'Indisponível: precisa de lucro antes de Ads completo e de vendas no período.';
  return (
    <div role="group" aria-labelledby={id} className="min-w-0 space-y-1 rounded-lg border border-border p-4">
      <p id={id} className={ROTULO}>Equilíbrio observado da conta</p>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">{pct(valor)}</p>
      <p className={LEGENDA}>{legenda}</p>
    </div>
  );
}

function Ponto({ cor }: { cor: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', cor)} />;
}

/** Barra da margem: só com margem positiva (o domínio só calcula `margemConsumida` com lucro > 0).
 *  `completa` = custo real; sem ela o excesso fica neutro, sem cor de interpretação (plano §4.7). */
function BarraMargem({ consumida, completa }: { consumida: number; completa: boolean }) {
  const excede = consumida > 1;
  const corExcesso = completa ? 'bg-danger' : 'bg-muted-foreground/60';
  const rotulo = excede
    ? `Ads consumiu mais que a margem (${pct(consumida)})`
    : `Ads consumiu ${pct(consumida)} da margem; resultado ${pct(1 - consumida)}`;
  return (
    <div className="space-y-2">
      <div role="img" aria-label={rotulo} className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {excede ? (
          <div className={cn('h-full w-full', corExcesso)} />
        ) : (
          <>
            <div className="h-full bg-primary motion-safe:transition-[width]" style={{ width: `${(1 - consumida) * 100}%` }} />
            <div className="h-full bg-warning motion-safe:transition-[width]" style={{ width: `${consumida * 100}%` }} />
          </>
        )}
      </div>
      <div aria-hidden className={cn(LEGENDA, 'flex flex-col gap-1 sm:flex-row sm:justify-between')}>
        {excede ? (
          <span className="flex items-center gap-2"><Ponto cor={corExcesso} />Ads consumiu mais que a margem ({pct(consumida)})</span>
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

function LinhaComposicao({ cor, rotulo, valor }: { cor: string; rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="flex items-center gap-2 text-muted-foreground"><Ponto cor={cor} />{rotulo}</dt>
      <dd className="shrink-0 text-right tabular-nums">{valor}</dd>
    </div>
  );
}

type MotivoConta = 'serie_incompleta' | 'catalogo' | null;
type Composicao = Pick<ContaPainel, 'emFamilias' | 'compartilhado' | 'naoIdentificado' | 'naoIdentificadoPct' | 'divergente'>;

/**
 * Resultado da conta após Ads (plano §3.2/§4.9): resultado como elemento mais forte, equilíbrio observado da conta
 * como referência neutra, ressalva causal sempre visível. Usa os valores do domínio (ADR-0179).
 * `conta` null = série ao vivo ausente/incompleta (ou catálogo sem carregar); `composicao` só quando os grupos chegam.
 */
export function ResumoConta({ conta, motivo: motivoConta = null, historicoDesde, faturamentoConta, composicao, onVerAcima }: {
  conta: ResultadoContaAds | null;
  motivo?: MotivoConta;
  historicoDesde: string | null;
  faturamentoConta: number | null;
  composicao?: Composicao;
  onVerAcima?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const idComposicao = `${useId()}-composicao`;
  const motivo = motivoResultadoConta(conta, motivoConta, historicoDesde);
  const temPonte = conta != null && conta.lucroAntes != null && conta.resultado != null;
  const legendaDespesa = conta?.margemConsumida != null
    ? `${pct(conta.margemConsumida)} da margem`
    : 'despesa informada pela API de Ads';
  const diasAbertos = conta?.diasAbertos ?? 0;
  // ponytail: sem barra da composição quando divergente — as parcelas não fecham com o total.
  const segmentos = conta && composicao && !composicao.divergente && conta.custo > 0 && composicao.naoIdentificado != null
    ? [
      { cor: 'bg-primary', v: composicao.emFamilias },
      { cor: 'bg-primary/50', v: composicao.compartilhado },
      { cor: 'bg-muted-foreground/40', v: composicao.naoIdentificado },
    ]
    : null;
  const baseSegmentos = segmentos?.reduce((t, sg) => t + sg.v, 0) ?? 0;
  const termos = conta && (
    <>
      <Termo rotulo="Lucro antes de Ads" valor={conta.lucroAntes != null ? fmtBRL(conta.lucroAntes) : NADA} legenda="vendas do período" empilhado={!temPonte} />
      {temPonte && <Operador icone={Minus} texto="menos" />}
      <Termo rotulo="Despesa de Ads" valor={fmtBRL(conta.custo)} legenda={legendaDespesa} empilhado={!temPonte} />
    </>
  );

  return (
    <section aria-label="Resumo da conta" className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Resultado da conta após Ads</h2>
          {diasAbertos > 0 && (
            <StatusPill tone="warning" title="A atribuição de vendas do ML ainda pode mudar nestes dias.">
              provisório: {diasAbertos} {diasAbertos === 1 ? 'dia' : 'dias'} com atribuição em aberto
            </StatusPill>
          )}
        </div>
        {onVerAcima && (
          <Button type="button" variant="outline" size="sm" className="h-8 max-sm:h-11 pointer-coarse:h-11" onClick={onVerAcima}>
            Ver famílias acima do equilíbrio
          </Button>
        )}
      </div>

      {composicao?.divergente && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          A soma dos grupos não fecha com o total da conta. A composição do gasto está indisponível.
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <PainelResultado conta={conta} motivo={motivo} />
        <EquilibrioConta conta={conta} faturamento={faturamentoConta} />
      </div>

      {conta && (temPonte ? (
        <div role="group" aria-label="Cálculo do resultado" className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-4">
          {termos}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">{termos}</div>
      ))}
      {conta && temPonte && conta.lucroAntes! > 0 && conta.margemConsumida != null && <BarraMargem consumida={conta.margemConsumida} completa={conta.fonteCusto === 'real'} />}

      {composicao && conta && (
        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 max-sm:h-11 pointer-coarse:h-11"
            aria-expanded={aberto}
            aria-controls={idComposicao}
            onClick={() => setAberto(v => !v)}
          >
            Composição do gasto
            <ChevronDown aria-hidden className={cn('size-4 motion-safe:transition-transform', aberto && 'rotate-180')} />
          </Button>
          {/* Montada sempre (hidden quando fechada) para o aria-controls apontar para um id existente. */}
          <div id={idComposicao} role="region" aria-label="Composição do gasto" hidden={!aberto}
            className="space-y-3 rounded-md bg-muted/30 p-3 sm:p-4">
            {segmentos && baseSegmentos > 0 && (
              <div aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                {/* Proporção sobre a soma das parcelas (base coletada), não sobre o investimento ao vivo: uma base só. */}
                {segmentos.map(sg => (
                  <div key={sg.cor} className={cn('h-full', sg.cor)} style={{ width: `${(sg.v / baseSegmentos) * 100}%` }} />
                ))}
              </div>
            )}
            <dl className="space-y-1.5">
              <LinhaComposicao cor="bg-primary" rotulo="Em famílias" valor={fmtBRL(composicao.emFamilias)} />
              <LinhaComposicao cor="bg-primary/50" rotulo="Compartilhado entre famílias" valor={fmtBRL(composicao.compartilhado)} />
              {!composicao.divergente && composicao.naoIdentificado != null && (
                <LinhaComposicao cor="bg-muted-foreground/40" rotulo="Gasto de Ads não identificado"
                  valor={`${fmtBRL(composicao.naoIdentificado)}${composicao.naoIdentificadoPct != null ? ` (${pct(composicao.naoIdentificadoPct)})` : ''}`} />
              )}
            </dl>
          </div>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info aria-hidden className="mt-px size-3.5 shrink-0" />
        {MSG_CAUSAL}
      </p>
    </section>
  );
}
