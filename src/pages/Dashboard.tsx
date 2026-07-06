import { useMemo, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Wallet, Receipt, Coins, ShoppingBag, Target, PiggyBank, TrendingUp, Users,
  ArrowUp, ArrowDown, ArrowRight, AlertTriangle, ChevronRight, Trophy, MapPin, CalendarClock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { KpiCard } from '@/components/ui/kpi-card';
import { Skeleton } from '@/components/ui/skeleton';
import { AoVivo } from '@/components/ui/ao-vivo';
import { SeletorPeriodo } from '@/components/ui/seletor-periodo';
import { MapaBrasil } from '@/components/faturamento/mapa-brasil';
import { GraficoCockpit, type MetricaGrafico } from '@/components/dashboard/grafico-cockpit';
import { resolverJanela, janelaAnterior, type Periodo } from '@/lib/metricas';
import { agruparPorPeriodo } from '@/lib/resumo-vendas';
import { useResumoVendas } from '@/hooks/useResumoVendas';
import { useVendas } from '@/hooks/useVendas';
import { useCustos } from '@/hooks/useCustos';
import { useLotes } from '@/hooks/useLotes';
import { usePublicados } from '@/hooks/usePublicados';
import { useStatusPublicados } from '@/hooks/useStatusPublicados';
import { usePerguntasNaoRespondidas } from '@/hooks/usePerguntas';
import { useDevolucoes } from '@/hooks/useDevolucoes';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { calcularKpisDashboard } from '@/lib/dashboard-kpis';
import { montarPendencias } from '@/lib/pendencias';
import { topProdutos, calendarioCaixa, montarAtencao } from '@/lib/cockpit';
import { agruparPorPedido, calcularKpisPedidos } from '@/lib/pedidos-faturamento';
import { agruparPorGeografia } from '@/lib/geografia-vendas';
import { montarAliquotaResolver, montarCustoResolver, montarPesoResolver } from '@/lib/custos';

type Trend = 'up' | 'down' | 'neutral';
function delta(atual: number, anterior: number): { texto: string; trend: Trend } {
  if (anterior === 0) return { texto: atual > 0 ? 'novo' : '—', trend: atual > 0 ? 'up' : 'neutral' };
  const p = ((atual - anterior) / Math.abs(anterior)) * 100;
  const trend: Trend = p > 0.5 ? 'up' : p < -0.5 ? 'down' : 'neutral';
  return { texto: `${p >= 0 ? '+' : ''}${Math.round(p)}% vs. anterior`, trend };
}

function fmtDia(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Card de destaque do topo (Faturamento / Líquido). Gradiente de marca, valor grande, delta e
 *  drill-down para a tela de origem. */
function HeroVenda({ to, destino, icon: Icon, label, cor, valor, valorCor, delta, sub, className }: {
  to: string;
  destino: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  cor: string;
  valor: string;
  valorCor?: string;
  delta: { texto: string; trend: Trend };
  sub: string;
  className?: string;
}) {
  return (
    <Link
      to={to}
      aria-label={`${label} — ver ${destino}`}
      className={cn('group block h-full rounded-lg border bg-[image:var(--brand-gradient-soft)] px-4 py-4 shadow-sm outline-none ring-offset-background transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      <div className="mb-1 flex items-center justify-between gap-1.5 text-xs">
        <span className={cn('flex items-center gap-1.5', cor)}>
          <Icon className="h-4 w-4 shrink-0" /> {label}
        </span>
        <span className="flex items-center gap-0.5 text-muted-foreground">
          {destino} <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
      <div className={cn('text-3xl font-bold tabular-nums', valorCor)}>{valor}</div>
      <div className={cn('mt-0.5 flex items-center gap-0.5 text-xs',
        delta.trend === 'up' ? 'text-success' : delta.trend === 'down' ? 'text-destructive' : 'text-muted-foreground')}>
        {delta.trend === 'up' ? <ArrowUp className="h-3 w-3" /> : delta.trend === 'down' ? <ArrowDown className="h-3 w-3" /> : null}
        {delta.texto}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </Link>
  );
}

export default function Dashboard() {
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'preset', dias: 30 });
const [metrica, setMetrica] = useState<'faturamento' | MetricaGrafico>('faturamento');
  const janela = useMemo(() => resolverJanela(periodo), [periodo]);
  const janelaAnt = useMemo(() => janelaAnterior(janela, periodo), [janela, periodo]);

  const { resumo: r, isFetching, error } = useResumoVendas(janela);
  const { resumo: rAnt } = useResumoVendas(janelaAnt);
  const vendasRaw = useVendas(janela, 'todos'); // mesma chave de cache do useResumoVendas → sem request extra
  const vendasRawAnt = useVendas(janelaAnt, 'todos'); // idem (já buscado pelo rAnt) → delta por pacote
  const { data: custos } = useCustos();
  const { data: aliquotas } = useAliquotas();
  const carregando = vendasRaw.isPending;

  // Catálogo + pendências cross-módulo
  const { data: lotes = [] } = useLotes();
  const { data: publicados = [] } = usePublicados();
  const { data: statusData } = useStatusPublicados();
  const perguntasQ = usePerguntasNaoRespondidas();
  const devolucoesQ = useDevolucoes();

  const statusItens = statusData?.itens ?? [];
  const semStatus = statusData?.semCredencialML ?? false;
  const kpis = calcularKpisDashboard(lotes, publicados, statusItens);
  const errosDestino = montarPendencias(kpis.comProblema, lotes).find((p) => p.chave === 'erro')?.destino ?? '/publicados';
  const devolucoesAbertas = (devolucoesQ.data ?? []).filter((d) => (d.acoes_pendentes?.length ?? 0) > 0).length;
  const atencao = montarAtencao({
    aRevisar: kpis.aRevisar,
    comProblema: semStatus ? 0 : kpis.comProblema,
    erros: kpis.erros,
    errosDestino,
    perguntas: perguntasQ.data ?? 0,
    devolucoes: devolucoesAbertas,
  });

  // Gráfico: granularidade segue o período (dia até ~31d; senão semana). Espelha o Financeiro.
  const passo = periodo.tipo === 'hoje' || (periodo.tipo === 'preset' && periodo.dias <= 31) ? 'dia'
    : periodo.tipo === 'range'
      ? (!janela.desde || !janela.ate ? 'dia'
        : (Date.parse(janela.ate) - Date.parse(janela.desde)) / 86_400_000 <= 31 ? 'dia' : 'semana')
      : 'semana';
const serie = useMemo(() => agruparPorPeriodo(r.vendas, passo), [r.vendas, passo]);
const serieGrafico = useMemo(
  () => (metrica === 'faturamento' ? serie.map((p) => ({ ...p, liquido: p.bruto })) : serie),
  [metrica, serie],
);
const metricaGrafico: MetricaGrafico = metrica === 'pedidos' ? 'pedidos' : 'liquido';

  // Pedidos/ticket/compradores por PACOTE (agruparPorPedido) — mesmo nível do menu Faturamento
  // (fonte da verdade): uma compra com vários itens conta como 1 pedido. O resumo (r.pedidos/
  // r.ticket) conta por linha de ml_vendas, o que infla pedidos e reduz o ticket.
  const pedidos = useMemo(
    () => agruparPorPedido(
      vendasRaw.data ?? [],
      montarCustoResolver(custos),
      montarPesoResolver(custos),
      undefined,
      montarAliquotaResolver(custos, aliquotas ?? { nacional: 8, importado: 16 }),
    ),
    [vendasRaw.data, custos, aliquotas],
  );
  const kpisPedidos = useMemo(() => calcularKpisPedidos(pedidos), [pedidos]);
  const kpisPedidosAnt = useMemo(
    () => calcularKpisPedidos(agruparPorPedido(
      vendasRawAnt.data ?? [],
      montarCustoResolver(custos),
      montarPesoResolver(custos),
      undefined,
      montarAliquotaResolver(custos, aliquotas ?? { nacional: 8, importado: 16 }),
    )),
    [vendasRawAnt.data, custos, aliquotas],
  );
  const top = useMemo(() => topProdutos(vendasRaw.data ?? [], 5), [vendasRaw.data]);
  // Mesma agregação por UF do menu Faturamento › Geografia (pedidos + valor no nível de pacote).
  const geoUf = useMemo(() => agruparPorGeografia(pedidos), [pedidos]);
  const uf = useMemo(
    () => Object.fromEntries(geoUf.porUf.map((u) => [u.uf, u.pedidos])),
    [geoUf],
  );
  const [ufSelecionada, setUfSelecionada] = useState<string | null>(null);
  const ufSelecionadaInfo = geoUf.porUf.find((u) => u.uf === ufSelecionada) ?? null;
  const caixa = useMemo(() => calendarioCaixa(r.vendas), [r.vendas]);
  const rankingUf = useMemo(
    () => geoUf.porUf.slice(0, 5).map((u): [string, number] => [u.uf, u.pedidos]),
    [geoUf],
  );

  const dLiquido = delta(r.liquido, rAnt.liquido);

  const novoLoteBtn = (
    <Button asChild>
      <Link to="/lotes"><Plus className="mr-1 h-4 w-4" /> Novo lote</Link>
    </Button>
  );

  const catalogoSub = `${fmtInt(kpis.publicados)} ${kpis.publicados === 1 ? 'anúncio publicado' : 'anúncios publicados'}`
    + (semStatus ? '' : ` · ${fmtInt(kpis.ativos)} ${kpis.ativos === 1 ? 'ativo' : 'ativos'}`)
    + ` · ${fmtInt(kpis.variacoesPublicadas)} variações publicadas`;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Dashboard"
        subtitle={catalogoSub}
        actions={
          <div className="flex items-center gap-3">
            <AoVivo isFetching={isFetching} />
            {novoLoteBtn}
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Falha ao ler as vendas. As métricas podem estar incompletas.
        </div>
      )}

      <div className="mb-4">
        <SeletorPeriodo periodo={periodo} onPeriodo={setPeriodo} carregando={isFetching} />
      </div>

      {/* ── Destaque (Faturamento + Líquido) + 6 KPIs, todos da mesma altura ── */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5 lg:grid-rows-2">
        {carregando ? (
          <>
            <div className="col-span-2 h-full rounded-lg border bg-card p-4 shadow-sm lg:col-span-2 lg:col-start-1 lg:row-start-1"><Skeleton className="h-4 w-32" /><Skeleton className="mt-3 h-8 w-40" /></div>
            <div className="col-span-2 h-full rounded-lg border bg-card p-4 shadow-sm lg:col-span-2 lg:col-start-1 lg:row-start-2"><Skeleton className="h-4 w-32" /><Skeleton className="mt-3 h-8 w-40" /></div>
          </>
        ) : (
          <>
            <HeroVenda
              to="/faturamento"
              destino="Faturamento"
              icon={Receipt}
              label="Faturamento bruto"
              cor="text-info"
              valor={fmtBRL(r.bruto)}
              delta={delta(r.bruto, rAnt.bruto)}
              sub={`${fmtInt(kpisPedidos.pedidos)} pedidos · ${fmtInt(kpisPedidos.unidades)} unidades`}
              className="col-span-2 lg:col-span-2 lg:col-start-1 lg:row-start-1"
            />
            <HeroVenda
              to="/financeiro"
              destino="Financeiro"
              icon={Wallet}
              label="Líquido das vendas"
              cor="text-success"
              valor={fmtBRL(r.liquido)}
              valorCor="text-success"
              delta={dLiquido}
              sub={`comissão ${fmtBRL(r.comissao)} · frete ${fmtBRL(r.frete)}`}
              className="col-span-2 lg:col-span-2 lg:col-start-1 lg:row-start-2"
            />
          </>
        )}

        <KpiCard
          label="Líquido no faturamento" icon={Coins} loading={carregando} to="/faturamento"
          value={fmtBRL(kpisPedidos.liquido)}
          delta={delta(kpisPedidos.liquido, kpisPedidosAnt.liquido).texto}
          deltaTrend={delta(kpisPedidos.liquido, kpisPedidosAnt.liquido).trend}
          hint={r.margem != null ? `lucro ${fmtBRL(r.lucro)}` : undefined}
        />
        <KpiCard
          label="Markup no período" icon={TrendingUp} loading={carregando}
          value={r.markup != null ? `${r.markup >= 0 ? '+' : ''}${Math.round(r.markup * 100)}%` : '—'}
          valueClassName={r.markup != null ? (r.markup >= 0 ? 'text-success' : 'text-destructive') : undefined}
        />
        <KpiCard
          label="Compradores" icon={Users} loading={carregando} to="/faturamento"
          value={fmtInt(kpisPedidos.compradoresUnicos)}
          hint={`${kpisPedidos.pctRecompra.toFixed(1).replace('.', ',')}% recompra`}
        />
        <KpiCard
          label="Pedidos" icon={ShoppingBag} loading={carregando} to="/faturamento"
          value={fmtInt(kpisPedidos.pedidos)}
          delta={delta(kpisPedidos.pedidos, kpisPedidosAnt.pedidos).texto} deltaTrend={delta(kpisPedidos.pedidos, kpisPedidosAnt.pedidos).trend}
        />
        <KpiCard
          label="Ticket médio" icon={Target} loading={carregando} to="/faturamento"
          value={fmtBRL(kpisPedidos.ticket)}
          delta={delta(kpisPedidos.ticket, kpisPedidosAnt.ticket).texto} deltaTrend={delta(kpisPedidos.ticket, kpisPedidosAnt.ticket).trend}
        />
        <KpiCard
          label="A receber" icon={PiggyBank} loading={carregando} to="/financeiro"
          value={fmtBRL(r.aLiberar)}
          hint={r.proximaLiberacao
            ? `próxima em ${new Date(r.proximaLiberacao).toLocaleDateString('pt-BR')}`
            : 'nada a liberar'}
        />
      </div>

      {/* ── Precisa de atenção ─────────────────────────────────── */}
      {atencao.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium text-warning">
            <AlertTriangle className="h-4 w-4" /> Precisa de atenção
          </span>
          {atencao.map((a) => (
            <Link
              key={a.chave}
              to={a.destino}
              className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/5 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-warning/10"
            >
              {a.label}
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}

      {/* ── Evolução ───────────────────────────────────────────── */}
      <div className="mb-4 rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-sm font-medium">
            Evolução de vendas <span className="text-muted-foreground">({passo === 'dia' ? 'por dia' : 'por semana'})</span>
          </div>
          <div className="flex gap-1">
{(['faturamento', 'liquido', 'pedidos'] as const).map((m) => (
              <Button
                key={m} size="sm" variant={metrica === m ? 'default' : 'outline'}
                className="h-7 px-2.5 text-xs" onClick={() => setMetrica(m)}
              >
                {m === 'faturamento' ? 'Faturamento' : m === 'liquido' ? 'Líquido' : 'Pedidos'}
              </Button>
            ))}
          </div>
        </div>
{carregando ? (
  <Skeleton className="h-64 w-full" />
) : (
  <GraficoCockpit
    serie={serieGrafico}
    metrica={metricaGrafico}
    rotuloDinheiro={metrica === 'faturamento' ? 'Faturamento' : 'Líquido'}
  />
)}
      </div>

      {/* ── Top produtos | Liberações próximas ─────────────────── */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Trophy className="h-4 w-4 text-primary" /> Top produtos do período
            </div>
            <Link to="/publicados" className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
              Ver todos <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {top.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Sem vendas no período.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {top.map((p, i) => (
                <li key={p.mlItemId} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm" title={p.titulo}>{p.titulo}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmtInt(p.unidades)} un</span>
                  <span className="shrink-0 text-sm font-medium tabular-nums">{fmtBRL(p.valor)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <CalendarClock className="h-4 w-4 text-primary" /> Liberações próximas
            </div>
            <span className="text-xs text-muted-foreground">a receber {fmtBRL(r.aLiberar)}</span>
          </div>
          {caixa.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nada a liberar no horizonte.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {caixa.map((d) => (
                <li key={d.data} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" /> {fmtDia(d.data)}
                  </span>
                  <span className="font-medium tabular-nums text-success">{fmtBRL(d.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Mapa de vendas por UF ──────────────────────────────── */}
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-1.5 text-sm font-medium">
          <MapPin className="h-4 w-4 text-primary" /> Vendas por estado
        </div>
        {rankingUf.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sem vendas com destino no período.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <MapaBrasil
                valores={uf}
                unidade="pedidos"
                selecionada={ufSelecionada}
                onSelecionar={(sigla) => setUfSelecionada((s) => (s === sigla ? null : sigla))}
              />
              {ufSelecionadaInfo && (
                <div className="flex items-center justify-between rounded-md bg-primary/10 px-3 py-1.5 text-xs">
                  <span className="font-semibold">{ufSelecionadaInfo.uf}</span>
                  <span className="text-muted-foreground">
                    {fmtInt(ufSelecionadaInfo.pedidos)} {ufSelecionadaInfo.pedidos === 1 ? 'pedido' : 'pedidos'} · {fmtBRL(ufSelecionadaInfo.valor)}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-col justify-center gap-2">
              {rankingUf.map(([sigla, qtd]) => (
                <div key={sigla} className="flex items-center gap-3">
                  <span className="w-8 shrink-0 text-sm font-semibold">{sigla}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(qtd / rankingUf[0][1]) * 100}%` }} />
                  </div>
                  <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{fmtInt(qtd)} ped.</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
