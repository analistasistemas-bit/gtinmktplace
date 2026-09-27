import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Boxes, CloudOff, ChevronRight, DollarSign, Lightbulb, Package, Percent, PieChart, ReceiptText, Scale, TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SeletorPeriodo } from '@/components/ui/seletor-periodo';
import { fmtBRL, fmtBRLSinal, fmtInt, fmtMarkup } from '@/lib/formato';
import { rotuloAnterior, type Periodo } from '@/lib/metricas';
import { formatarNomeProduto, normalizarParaBusca } from '@/lib/texto';
import { useVendasSku } from '@/hooks/useVendasSku';
import { LinkDossie, RankingSku, type ChaveOrdem } from '@/components/faturamento/ranking-sku';
import { SEM_CODIGO, agruparPorFamilia, curvaAbc, deltaPp, deltaValor, type Delta, type LinhaSku } from '@/lib/vendas-sku';

// Idioma do app para "sem valor" (o mesmo de fmtMarkup e da aba Vendas).
const NADA = '—';
const pct = (v: number | null) => (v == null ? NADA : `${(v * 100).toFixed(1).replace('.', ',')}%`);
// Delta zero não tem sinal nem cor: "+R$ 0,00" em verde lia como alta.
const comDelta = (d: Delta | null, rot: string) => (!d ? {}
  : { delta: `${d.tendencia === 'neutral' ? d.texto.replace(/^[+\u2212]/, '') : d.texto} ${rot}`, deltaTrend: d.tendencia });
const valorOrdem = (l: Pick<LinhaSku, 'acc' | 'm'>, k: ChaveOrdem): number =>
  k === 'lucro' ? l.m.lucro ?? -Infinity : k === 'lucroPorUnidade' ? l.m.lucroPorUnidade ?? -Infinity
    : k === 'bruto' ? l.acc.bruto : l.acc.unidades;
const SELECT = 'h-7 max-w-full rounded-md border border-input bg-background px-2 text-xs dark:[color-scheme:dark] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const BOTAO = 'h-7 px-2.5 text-xs';

function Carregando() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando vendas por SKU">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <KpiCard key={i} size="compact" label="" value="" loading />)}
      </div>
      <div className="rounded-lg border bg-card">
        <div className="h-10 border-b bg-muted/50" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-0">
            <Skeleton className="size-8 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/2 max-w-64" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="hidden h-4 w-16 sm:block" />
            <Skeleton className="hidden h-4 w-16 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Painel({ icone: Icone, titulo, children }: { icone: typeof Lightbulb; titulo: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border bg-card px-3 py-2.5 shadow-sm">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icone className="h-3.5 w-3.5 shrink-0" aria-hidden />{titulo}
      </h3>
      {children}
    </section>
  );
}

export function AbaVendasSku() {
  const [periodo, setPeriodo] = useState<Periodo>({ tipo: 'mes_atual' });
  const [busca, setBusca] = useState('');
  const [familia, setFamilia] = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [origem, setOrigem] = useState<'' | 'nacional' | 'importado'>('');
  const [soSemCusto, setSoSemCusto] = useState(false);
  const [porFamilia, setPorFamilia] = useState(false);
  const [baseAbc, setBaseAbc] = useState<'lucro' | 'bruto'>('lucro');
  const [ordem, setOrdem] = useState<ChaveOrdem>('lucro');
  const { dados, isLoading, isFetching, isError, refetch } = useVendasSku(periodo);

  const opcoes = useMemo(() => {
    const ls = dados?.linhas ?? [];
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return { familias: uniq(ls.map((l) => l.nomeFamilia)), fornecedores: uniq(ls.map((l) => l.fornecedor)) };
  }, [dados]);
  const filtradas = useMemo(() => {
    const q = normalizarParaBusca(busca);
    return (dados?.linhas ?? [])
      .filter((l) =>
        (!q || normalizarParaBusca(`${l.codigo} ${l.titulo ?? ''} ${l.nomeFamilia ?? ''}`).includes(q))
        && (!familia || l.nomeFamilia === familia)
        && (!fornecedor || l.fornecedor === fornecedor)
        && (!origem || l.origem === origem)
        && (!soSemCusto || l.m.fonteCusto === 'sem_custo' || l.m.fonteCusto === 'parcial'))
      .sort((a, b) => valorOrdem(b, ordem) - valorOrdem(a, ordem) || a.codigo.localeCompare(b.codigo));
  }, [dados, busca, familia, fornecedor, origem, soSemCusto, ordem]);
  const familias = useMemo(() => (porFamilia
    ? agruparPorFamilia(filtradas).sort((a, b) => valorOrdem(b, ordem) - valorOrdem(a, ordem) || a.codigoPai.localeCompare(b.codigoPai))
    : null), [filtradas, porFamilia, ordem]);
  // ABC na linha que a tabela mostra: família quando agrupado, variação quando não.
  const abc = useMemo(() => curvaAbc(
    familias ? familias.map((f) => ({ ...f.filhos[0], codigo: f.codigoPai, acc: f.acc, m: f.m })) : filtradas, baseAbc,
  ), [familias, filtradas, baseAbc]);

  const filtrosAtivos = !!busca || !!familia || !!fornecedor || !!origem || soSemCusto;
  const limparFiltros = () => { setBusca(''); setFamilia(''); setFornecedor(''); setOrigem(''); setSoSemCusto(false); };

  const seletor = (
    <SeletorPeriodo periodo={periodo} onPeriodo={setPeriodo} mostrarMesAtual rotulo="Período" carregando={isFetching && !isLoading} />
  );

  if (isError && !dados) {
    return (
      <div className="space-y-4">
        {seletor}
        <EmptyState
          icon={CloudOff}
          title="Não foi possível carregar as vendas por SKU"
          description="A busca das vendas ou do catálogo falhou. Tente de novo; se continuar, troque o período ou recarregue a página."
          action={<Button variant="outline" size="sm" onClick={() => { void refetch(); }}>Tentar de novo</Button>}
        />
      </div>
    );
  }

  if (isLoading || !dados) return <div className="space-y-4">{seletor}<Carregando /></div>;

  if (dados.linhas.length === 0) {
    const ja90 = periodo.tipo === 'preset' && periodo.dias === 90;
    return (
      <div className="space-y-4">
        {seletor}
        <EmptyState
          icon={Boxes}
          title="Nenhuma venda neste período"
          description={ja90
            ? 'Sem pedidos faturados nos últimos 90 dias. Sincronize as vendas na aba Vendas para trazê-las do Mercado Livre.'
            : 'Sem pedidos faturados no recorte escolhido. Amplie o período ou sincronize as vendas na aba Vendas.'}
          action={ja90
            ? <Button asChild variant="outline" size="sm"><Link to={{ search: '' }}>Ir para Vendas</Link></Button>
            : <Button variant="outline" size="sm" onClick={() => setPeriodo({ tipo: 'preset', dias: 90 })}>Ver últimos 90 dias</Button>}
        />
      </div>
    );
  }

  const { kpis, kpisAnterior: ka } = dados;
  const rot = rotuloAnterior(periodo);
  const semCusto = dados.linhas.filter((l) => l.m.fonteCusto === 'sem_custo');
  const parciais = dados.linhas.filter((l) => l.m.fonteCusto === 'parcial');
  const brutoSemCusto = [...semCusto, ...parciais].reduce((s, l) => s + l.acc.bruto - l.acc.brutoComCusto, 0);
  const totalLinhas = familias ? familias.length : filtradas.length;
  const nPrejuizo = dados.linhas.filter((l) => l.codigo !== SEM_CODIGO && l.m.lucro != null && l.m.lucro < 0).length;

  return (
    <div className="space-y-4">
      {seletor}

      {(semCusto.length > 0 || parciais.length > 0) && (
        <button
          type="button"
          onClick={() => setSoSemCusto((v) => !v)}
          aria-pressed={soSemCusto}
          className="group flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-left text-sm transition-colors duration-(--motion-duration-state) hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
          {semCusto.length > 0 && <span className="font-medium">{semCusto.length} {semCusto.length === 1 ? 'SKU sem custo' : 'SKUs sem custo'}</span>}
          {semCusto.length > 0 && parciais.length > 0 && <span className="text-muted-foreground" aria-hidden>·</span>}
          {parciais.length > 0 && <span className="font-medium">{parciais.length} com lucro parcial</span>}
          <span className="text-muted-foreground">
            <span className="tabular-nums">{fmtBRL(brutoSemCusto)}</span> de faturamento sem lucro calculado. Cadastre o custo para entrar na conta.
          </span>
          <span className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium">
            {soSemCusto ? 'Mostrar todos' : 'Ver só esses'}
            {!soSemCusto && <ChevronRight className="h-3.5 w-3.5 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />}
          </span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard size="compact" icon={TrendingUp} label="Lucro" infoKey="Lucro::vendas-sku"
          tom={kpis.lucro == null ? 'info' : kpis.lucro < 0 ? 'danger' : 'success'}
          valueClassName={kpis.lucro == null ? undefined : kpis.lucro < 0 ? 'text-destructive' : 'text-success'}
          value={kpis.lucro == null ? NADA : fmtBRLSinal(kpis.lucro)}
          hint={nPrejuizo > 0 ? `${nPrejuizo} ${nPrejuizo === 1 ? 'SKU' : 'SKUs'} no prejuízo: ${fmtBRLSinal(kpis.prejuizo)}` : undefined}
          {...comDelta(deltaValor(kpis.lucro, ka.lucro, fmtBRL), rot)} />
        <KpiCard size="compact" icon={DollarSign} label="Faturamento" tom="success" value={fmtBRL(kpis.bruto)}
          {...comDelta(deltaValor(kpis.bruto, ka.bruto, fmtBRL), rot)} />
        <KpiCard size="compact" icon={Percent} label="Markup" infoKey="Markup::vendas-sku" tom="info" value={fmtMarkup(kpis.markup)}
          {...comDelta(deltaPp(kpis.markup, ka.markup), rot)} />
        <KpiCard size="compact" icon={Scale} label="Margem s/ venda" infoKey="Margem s/ venda::vendas-sku" tom="info" value={pct(kpis.margemSVenda)}
          {...comDelta(deltaPp(kpis.margemSVenda, ka.margemSVenda), rot)} />
        {/* infoKey sem entrada de propósito: a descrição de "Unidades" é a da aba Vendas (por pedido) e
            o botão "O que é Unidades" disputaria o nome com o cabeçalho que ordena a tabela. */}
        <KpiCard size="compact" icon={Package} label="Unidades" infoKey="Unidades::vendas-sku" tom="info" value={fmtInt(kpis.unidades)}
          {...comDelta(deltaValor(kpis.unidades, ka.unidades, fmtInt), rot)} />
        <KpiCard size="compact" icon={Boxes} label="SKUs com venda" tom="info" value={fmtInt(kpis.skusComVenda)}
          hint={`${fmtInt(kpis.skusVendaUnica)} ${kpis.skusVendaUnica === 1 ? 'vendeu' : 'venderam'} 1 vez`} />
        <KpiCard size="compact" icon={PieChart} label="Concentração top 5" tom="info" value={pct(kpis.concentracaoTop5)} hint="do lucro positivo" />
        <KpiCard size="compact" icon={ReceiptText} label="Faturamento com custo real" infoKey="Faturamento com custo real::vendas-sku"
          // ponytail: abaixo de 80% com custo real o lucro depende muito do custo estimado; recalibrar com uso.
          tom={kpis.pctBrutoCustoReal != null && kpis.pctBrutoCustoReal < 0.8 ? 'warning' : 'info'} value={pct(kpis.pctBrutoCustoReal)} />
      </div>

      {(dados.insights.length > 0 || dados.variacoes.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {dados.insights.length > 0 && (
            <Painel icone={Lightbulb} titulo="Leituras do período">
              <ul className="space-y-1.5 text-sm">
                {dados.insights.map((ins) => (
                  <li key={ins.texto} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden />
                    {!ins.skus?.length ? ins.texto : (
                      <details className="group min-w-0 flex-1">
                        <summary className="cursor-pointer list-none rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                          {ins.texto}{' '}
                          <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
                            <span className="group-open:hidden">ver quais</span><span className="hidden group-open:inline">ocultar</span>
                            <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" aria-hidden />
                          </span>
                        </summary>
                        <ul className="mt-1.5 max-h-48 space-y-0.5 overflow-y-auto pr-1 text-xs">
                          {ins.skus.map((s) => (
                            <li key={s.codigo} className="flex items-baseline gap-2">
                              <LinkDossie to={`/faturamento/sku/${encodeURIComponent(s.codigo)}`} className="min-w-0 truncate">
                                <span title={s.nome}>{s.nome}</span>
                              </LinkDossie>
                              <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{s.detalhe}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </Painel>
          )}
          {dados.variacoes.length > 0 && (
            <Painel icone={TrendingUp} titulo={`Quem explica a variação do lucro (${rot})`}>
              <ul className="space-y-1 text-sm">
                {dados.variacoes.map((v) => (
                  <li key={v.codigo} className="flex items-baseline gap-1.5">
                    <span className="min-w-0 truncate" title={v.titulo ?? v.codigo}>{v.titulo ?? v.codigo}</span>
                    {v.situacao !== 'mudou' && (
                      <span className="shrink-0 text-xs text-muted-foreground">{v.situacao === 'entrou' ? 'entrou' : 'deixou de vender'}</span>
                    )}
                    <span className={cn('ml-auto shrink-0 pl-2 font-medium tabular-nums', v.delta < 0 ? 'text-destructive' : 'text-success')}>
                      {v.delta > 0 ? '+' : '−'}{fmtBRL(Math.abs(v.delta))}
                    </span>
                  </li>
                ))}
              </ul>
            </Painel>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-7 w-full text-xs sm:w-56" placeholder="Buscar SKU ou produto…" aria-label="Buscar SKU"
          value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select className={SELECT} value={familia} onChange={(e) => setFamilia(e.target.value)} aria-label="Família">
          <option value="">Todas as famílias</option>
          {opcoes.familias.map((f) => <option key={f} value={f}>{formatarNomeProduto(f)}</option>)}
        </select>
        <select className={SELECT} value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} aria-label="Fornecedor">
          <option value="">Todos os fornecedores</option>
          {opcoes.fornecedores.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className={SELECT} value={origem} onChange={(e) => setOrigem(e.target.value as typeof origem)} aria-label="Origem">
          <option value="">Nacional e importado</option>
          <option value="nacional">Nacional</option>
          <option value="importado">Importado</option>
        </select>
        <Button size="sm" className={BOTAO} variant={soSemCusto ? 'default' : 'outline'} aria-pressed={soSemCusto}
          onClick={() => setSoSemCusto((v) => !v)}>Só sem custo</Button>
        <Button size="sm" className={BOTAO} variant={porFamilia ? 'default' : 'outline'} aria-pressed={porFamilia}
          onClick={() => setPorFamilia((v) => !v)}>Agrupar por família</Button>
        {/* Trocar a base também ordena por ela: a curva lê A→B→C de cima para baixo. Só o selo mudando parecia não fazer nada. */}
        <div className="flex items-center gap-1" role="group" aria-label="Base da curva ABC">
          <span className="text-xs text-muted-foreground">Curva ABC por</span>
          {(['lucro', 'bruto'] as const).map((b) => (
            <Button key={b} size="sm" className={BOTAO} variant={baseAbc === b ? 'secondary' : 'outline'} aria-pressed={baseAbc === b}
              onClick={() => { setBaseAbc(b); setOrdem(b); }}>{b === 'lucro' ? 'lucro' : 'faturamento'}</Button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {fmtInt(totalLinhas)} {familias ? (totalLinhas === 1 ? 'família' : 'famílias') : (totalLinhas === 1 ? 'SKU' : 'SKUs')}
          {filtrosAtivos && ` de ${fmtInt(dados.linhas.length)}`}
        </span>
      </div>

      <RankingSku linhas={filtradas} familias={familias} tendencias={dados.tendencias} coberturas={dados.coberturas}
        alertas={dados.alertas} abc={abc} ordem={ordem} onOrdem={setOrdem}
        vazio={(
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhum SKU com esses filtros.
            <Button variant="link" size="sm" className="ml-1 h-auto p-0 text-sm" onClick={limparFiltros}>Limpar filtros</Button>
          </div>
        )} />

      <div className="space-y-1 text-xs text-muted-foreground">
        {dados.devolucoesNaoAtribuidas > 0 && (
          <p>
            {fmtInt(dados.devolucoesNaoAtribuidas)} {dados.devolucoesNaoAtribuidas === 1 ? 'devolução do período não chega' : 'devoluções do período não chegam'} a um SKU (carrinho ou envio sem pedido).
          </p>
        )}
        <p>
          {dados.historicoDesde
            ? `Histórico desde ${new Date(dados.historicoDesde).toLocaleDateString('pt-BR')}, quando a organização começou a vender pelo PubliAI.`
            : 'Histórico desde a entrada da organização no PubliAI.'}
        </p>
      </div>
    </div>
  );
}
