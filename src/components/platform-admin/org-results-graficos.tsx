import { useMemo, useState, type ReactNode } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fmtInt } from '@/lib/formato';
import { EIXO, TOOLTIP, kCompacto } from '@/components/sku-dossie/serie-pontos';
import type { MonthlyReport, SeriesPoint } from '@/lib/platform-admin';
import { brl, diasDoMes, lucroDoMes, mesCurto, nomeDoMes, pct } from '@/lib/relatorio-mensal-ui';

// Mesma mistura do Ads: chart-3 puro dá menos de 3:1 sobre o card no tema claro.
const COR_LUCRO = 'color-mix(in oklch, var(--chart-3), var(--foreground) 25%)';

const dd = (n: number) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------------------------
// Diário: dia i do mês × dia i do mês anterior
// ---------------------------------------------------------------------------------------------
type Visao = 'gross' | 'orders' | 'profit';

const VISOES: { chave: Visao; rotulo: string }[] = [
  { chave: 'gross', rotulo: 'Faturamento' },
  { chave: 'orders', rotulo: 'Pedidos' },
  { chave: 'profit', rotulo: 'Lucro após Ads' },
];

export type PontoDia = {
  dia: number;
  rotulo: string;
  atual: number | null;
  /** Só existe para faturamento: o contrato traz o mês anterior apenas nessa medida. */
  anterior: number | null;
  dataAtual: string;
  dataAnterior: string | null;
};

/** Um ponto por dia do mês. Dia que o contrato não traz (ou medida nula) é lacuna, nunca zero. */
export function pontosDiarios(report: Pick<MonthlyReport, 'month' | 'previous_month' | 'daily'>, visao: Visao): PontoDia[] {
  const porDia = new Map(report.daily.map((d) => [d.day.slice(8, 10), d]));
  const diasAnt = diasDoMes(report.previous_month);
  return Array.from({ length: diasDoMes(report.month) }, (_, i) => {
    const n = i + 1;
    const d = porDia.get(dd(n));
    const atual = !d ? null : visao === 'gross' ? d.gross_cents : visao === 'orders' ? d.orders : d.profit_after_ads_cents;
    return {
      dia: n, rotulo: dd(n), atual,
      anterior: visao === 'gross' && d ? d.prev_gross_cents : null,
      dataAtual: `${dd(n)}/${report.month.slice(5, 7)}`,
      dataAnterior: n <= diasAnt ? `${dd(n)}/${report.previous_month.slice(5, 7)}` : null,
    };
  });
}

const fmtValor = (visao: Visao, v: number | null) => (v == null ? '—' : visao === 'orders' ? fmtInt(v) : brl(v));
const diferenca = (visao: Visao, a: number | null, b: number | null) => {
  if (a == null || b == null) return '—';
  const d = a - b;
  return `${d > 0 ? '+' : d < 0 ? '−' : ''}${fmtValor(visao, Math.abs(d))}`;
};

function TooltipDia({ active, payload, visao }: { active?: boolean; payload?: Array<{ payload: PontoDia }>; visao: Visao }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="space-y-1 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="font-medium">{p.dataAtual}</div>
      <div className="flex justify-between gap-6"><span className="text-muted-foreground">Atual</span><span className="tabular-nums">{fmtValor(visao, p.atual)}</span></div>
      {visao === 'gross' && (
        <>
          <div className="flex justify-between gap-6"><span className="text-muted-foreground">Anterior{p.dataAnterior ? ` (${p.dataAnterior})` : ''}</span><span className="tabular-nums">{fmtValor(visao, p.anterior)}</span></div>
          <div className="flex justify-between gap-6 border-t pt-1"><span className="text-muted-foreground">Diferença</span><span className="tabular-nums">{diferenca(visao, p.atual, p.anterior)}</span></div>
        </>
      )}
    </div>
  );
}

export function GraficoDiario({ report, motivoSemLucro }: { report: MonthlyReport; motivoSemLucro: string }) {
  const [visao, setVisao] = useState<Visao>('gross');
  const [tabela, setTabela] = useState(false);
  const pontos = useMemo(() => pontosDiarios(report, visao), [report, visao]);
  const temDado = pontos.some((p) => p.atual != null);
  const comparar = visao === 'gross' && pontos.some((p) => p.anterior != null);
  const nomeVisao = VISOES.find((v) => v.chave === visao)!.rotulo;

  return (
    <section aria-labelledby="graf-diario" className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h3 id="graf-diario" className="text-sm font-medium">Evolução diária</h3>
          <p className="text-xs text-muted-foreground">Dia a dia de {nomeDoMes(report.month)}{comparar ? `, contra o mesmo dia de ${nomeDoMes(report.previous_month)}` : ''}</p>
        </div>
        <div role="group" aria-label="Medida do gráfico" className="flex flex-wrap gap-1">
          {VISOES.map((v) => (
            <Button key={v.chave} size="sm" variant={visao === v.chave ? 'default' : 'outline'}
              className="h-7 px-2.5 text-xs max-sm:min-h-11 pointer-coarse:min-h-11" aria-pressed={visao === v.chave} onClick={() => setVisao(v.chave)}>
              {v.rotulo}
            </Button>
          ))}
        </div>
      </div>

      <ul aria-label="Legenda" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-chart-1" />{mesCurto(report.month)}</li>
        {comparar && <li className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-muted-foreground" />{mesCurto(report.previous_month)}</li>}
      </ul>

      <div className="h-56 sm:h-64">
        {temDado ? (
          <div role="img" aria-label={`${nomeVisao} por dia de ${nomeDoMes(report.month)}`} className="h-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={pontos} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="rotulo" tick={EIXO} stroke="var(--border)" tickLine={false} minTickGap={12} />
                <YAxis width={visao === 'orders' ? 32 : 62} tick={EIXO} stroke="var(--border)" allowDecimals={false}
                  tickFormatter={(v) => (visao === 'orders' ? fmtInt(Number(v)) : `R$ ${kCompacto(Number(v) / 100)}`)} />
                <Tooltip content={<TooltipDia visao={visao} />} cursor={TOOLTIP.cursor} />
                {comparar && <Line dataKey="anterior" name="Anterior" type="linear" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />}
                {visao === 'orders'
                  ? <Bar dataKey="atual" name="Atual" fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  : <Line dataKey="atual" name="Atual" type="linear" stroke="var(--chart-1)" strokeWidth={2.25} dot={{ r: 2.5, fill: 'var(--chart-1)', stroke: 'var(--card)', strokeWidth: 1.5 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="grid h-full place-items-center px-4 text-center text-xs text-muted-foreground">
            {visao === 'profit' ? `Lucro após Ads por dia indisponível: ${motivoSemLucro}.` : 'Nenhum dia com dados neste mês.'}
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Dia sem dado aparece como lacuna, nunca como zero.
        {visao !== 'gross' && ' O contrato traz o mês anterior dia a dia apenas para o faturamento.'}
      </p>

      {temDado && (
        <>
          <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs max-sm:min-h-11 pointer-coarse:min-h-11" aria-expanded={tabela} onClick={() => setTabela(!tabela)}>
            {tabela ? 'Ocultar dados' : 'Ver dados'}
          </Button>
          {tabela && (
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-xs tabular-nums">
                <caption className="sr-only">{nomeVisao} por dia de {nomeDoMes(report.month)}, um dia por linha.</caption>
                <thead className="sticky top-0 bg-card text-left text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 font-medium">Dia</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">{mesCurto(report.month)}</th>
                    {visao === 'gross' && <th scope="col" className="px-2 py-1.5 text-right font-medium">{mesCurto(report.previous_month)}</th>}
                    {visao === 'gross' && <th scope="col" className="px-2 py-1.5 text-right font-medium">Diferença</th>}
                  </tr>
                </thead>
                <tbody>
                  {pontos.map((p) => (
                    <tr key={p.dia} className="border-t">
                      <th scope="row" className="px-2 py-1 text-left font-normal">{p.dataAtual}</th>
                      <td className="px-2 py-1 text-right">{fmtValor(visao, p.atual)}</td>
                      {visao === 'gross' && <td className="px-2 py-1 text-right">{fmtValor(visao, p.anterior)}</td>}
                      {visao === 'gross' && <td className="px-2 py-1 text-right">{diferenca(visao, p.atual, p.anterior)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Evolução mensal (até 12 meses): barras de faturamento e lucro; margem em painel próprio
// ---------------------------------------------------------------------------------------------
type PontoMes = {
  month: string; rotulo: string; gross: number | null; lucro: number | null; margem: number | null;
  /** Lucro/margem deste mês são após Ads (senão, antes de Ads). Escolha por mês, do contrato. */
  aposAds: boolean; parcial: boolean; indisponivel: boolean;
};

export function pontosMensais(series: SeriesPoint[]): PontoMes[] {
  return series.slice(-12).map((p) => ({
    month: p.month, rotulo: mesCurto(p.month), gross: p.gross_cents, ...lucroDoMes(p),
    parcial: p.partial, indisponivel: p.unavailable_reason != null,
  }));
}

const rotuloLucroDoMes = (p: PontoMes) => (p.aposAds ? 'Lucro após Ads' : `Lucro antes de Ads${p.parcial ? ' (parcial)' : ''}`);
const rotuloMargemDoMes = (p: PontoMes) => (p.aposAds ? 'Margem s/ venda após Ads' : 'Margem s/ venda (antes de Ads)');

function TooltipMes({ active, payload }: { active?: boolean; payload?: Array<{ payload: PontoMes }> }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="space-y-1 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="font-medium">{p.rotulo}{p.parcial ? ' · lucro parcial' : ''}</div>
      {p.indisponivel ? <div className="text-muted-foreground">Mês não calculado</div> : (
        <>
          <div className="flex justify-between gap-6"><span className="text-muted-foreground">Faturamento</span><span className="tabular-nums">{brl(p.gross)}</span></div>
          <div className="flex justify-between gap-6"><span className="text-muted-foreground">{rotuloLucroDoMes(p)}</span><span className="tabular-nums">{brl(p.lucro)}</span></div>
          <div className="flex justify-between gap-6"><span className="text-muted-foreground">{rotuloMargemDoMes(p)}</span><span className="tabular-nums">{pct(p.margem)}</span></div>
        </>
      )}
    </div>
  );
}

export function EvolucaoMensal({ series }: { series: SeriesPoint[] }) {
  const [tabela, setTabela] = useState(false);
  const pontos = useMemo(() => pontosMensais(series), [series]);
  const todosApos = pontos.every((p) => p.indisponivel || p.aposAds);
  const nenhumApos = pontos.every((p) => !p.aposAds);
  // Rótulo do conjunto: único quando todos os meses são do mesmo tipo; senão explica a mistura.
  const rotuloLucro = todosApos ? 'Lucro após Ads' : nenhumApos ? 'Lucro antes de Ads' : 'Lucro (após Ads quando disponível)';
  const rotuloMargem = todosApos ? 'Margem s/ venda após Ads' : nenhumApos ? 'Margem s/ venda (antes de Ads)' : 'Margem s/ venda (após Ads quando disponível)';
  const temMargem = pontos.some((p) => p.margem != null);
  const algumParcial = pontos.some((p) => p.parcial);

  return (
    <section aria-labelledby="graf-mensal" className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <div>
        <h3 id="graf-mensal" className="text-sm font-medium">Evolução de {pontos.length} meses</h3>
        <p className="text-xs text-muted-foreground">Faturamento e {rotuloLucro.toLowerCase()} por mês-calendário</p>
      </div>
      <ul aria-label="Legenda" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-chart-1" />Faturamento</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ backgroundColor: COR_LUCRO }} />{rotuloLucro}</li>
      </ul>
      <div className="h-56 sm:h-60" role="img" aria-label={`Faturamento e ${rotuloLucro} dos últimos ${pontos.length} meses`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={pontos} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="rotulo" tick={EIXO} stroke="var(--border)" tickLine={false} interval="preserveStartEnd" minTickGap={4} />
            <YAxis width={62} tick={EIXO} stroke="var(--border)" tickFormatter={(v) => `R$ ${kCompacto(Number(v) / 100)}`} />
            <Tooltip content={<TooltipMes />} cursor={TOOLTIP.cursor} />
            <Bar dataKey="gross" name="Faturamento" fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            <Bar dataKey="lucro" name={rotuloLucro} fill={COR_LUCRO} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-md border bg-muted/30 p-3">
        <h4 className="mb-1 text-xs font-medium">{rotuloMargem}</h4>
        {temMargem ? (
          <div className="h-28" role="img" aria-label={`${rotuloMargem} por mês`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pontos} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="rotulo" tick={EIXO} stroke="var(--border)" tickLine={false} interval="preserveStartEnd" minTickGap={4} />
                <YAxis width={48} tick={EIXO} stroke="var(--border)" domain={['auto', 'auto']} tickFormatter={(v) => pct(Number(v), 1)} />
                <Tooltip content={<TooltipMes />} />
                <Line dataKey="margem" type="linear" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 2.5, fill: 'var(--chart-2)', stroke: 'var(--card)', strokeWidth: 1.5 }} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Indisponível nos meses exibidos.</p>
        )}
      </div>

      {algumParcial && <p className="text-xs text-muted-foreground">Meses com lucro parcial têm itens sem lucro calculável; a margem desses meses é só sobre esses itens.</p>}
      {!todosApos && !nenhumApos && <p className="text-xs text-muted-foreground">Meses sem Ads completo mostram o lucro e a margem antes de Ads (indicado em cada mês).</p>}

      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs max-sm:min-h-11 pointer-coarse:min-h-11" aria-expanded={tabela} onClick={() => setTabela(!tabela)}>
        {tabela ? 'Ocultar dados' : 'Ver dados'}
      </Button>
      {tabela && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs tabular-nums">
            <caption className="sr-only">Evolução mensal, um mês por linha.</caption>
            <thead className="bg-card text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">Mês</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">Faturamento</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">Lucro</th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">Margem s/ venda</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Base</th>
              </tr>
            </thead>
            <tbody>
              {pontos.map((p) => (
                <tr key={p.month} className="border-t">
                  <th scope="row" className="px-2 py-1 text-left font-normal">{p.rotulo}{p.parcial ? ' (parcial)' : ''}</th>
                  <Cel>{p.indisponivel ? 'não calculado' : brl(p.gross)}</Cel>
                  <Cel>{p.indisponivel ? '—' : brl(p.lucro)}</Cel>
                  <Cel>{p.indisponivel ? '—' : pct(p.margem)}</Cel>
                  <td className="px-2 py-1 text-muted-foreground">{p.indisponivel ? '—' : p.aposAds ? 'após Ads' : 'antes de Ads'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Cel({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn('px-2 py-1 text-right', className)}>{children}</td>;
}
