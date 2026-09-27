import { useMemo, useState } from 'react';
import { Bar, Cell, ComposedChart, Area, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChevronDown, ChevronRight, Layers, Package, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DetalhePedidoItens } from '@/components/faturamento/detalhe-pedido-itens';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { fmtDataCurta, labelStatusPedido } from '@/lib/ml-status';
import { nomeCurtoComprador, nomeExibicaoComprador, type Pedido } from '@/lib/pedidos-faturamento';
import type { Passo } from '@/lib/calendario-brt';
import type { Evento, PontoSerie, TipoEvento } from '@/lib/sku-dossie';
import { TIPO_EVENTO } from './tipos-evento';

// Larguras dos eixos: a régua de intervalos embaixo do gráfico usa as mesmas medidas para cair
// exatamente sob cada barra (eixo X categórico = faixas iguais na área de plotagem).
const MARGEM = 4;
const EIXO_UNID = 32;
const EIXO_LUCRO = 40;
// ponytail: largura mínima por intervalo; acima disso (1 ano em semanas) rola dentro do cartão.
const MIN_POR_INTERVALO = 14;

const TOOLTIP = {
  contentStyle: { backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--popover-foreground)', fontSize: 12 },
  labelStyle: { color: 'var(--popover-foreground)', fontWeight: 500, marginBottom: 2 },
  itemStyle: { color: 'var(--popover-foreground)', padding: 0 },
  cursor: { fill: 'var(--muted)', fillOpacity: 0.5 },
};
const EIXO = { fontSize: 11, fill: 'var(--muted-foreground)' };
const kReais = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) >= 10_000 ? 0 : 1).replace('.', ',')}k` : String(Math.round(v)));
// Ordem do tooltip: a mesma leitura da legenda (unidades, lucro, preço).
const ORDEM_TOOLTIP = ['Unidades', 'Fora de kit', 'Dentro de kit', 'Lucro', 'Preço médio', 'Faixa de preço'];
const tom = (t: 'success' | 'warning' | 'danger' | 'muted'): StatusTone => (t === 'muted' ? 'neutral' : t);

const nomeIntervalo = (p: PontoSerie, passo: Passo) => (passo === 'semana' ? `Semana de ${p.intervalo.rotulo}` : p.intervalo.rotulo);

interface Props {
  serie: PontoSerie[];
  perguntas: number[];
  eventos: Evento[];
  codigos: string[];
  familia: boolean;
  temKit: boolean;
  passo: Passo;
  onPasso: (p: Passo) => void;
}

/** Série do período: unidades (barras), lucro (linha, eixo à direita), preço médio (linha fina com
 *  faixa mín./máx.). Embaixo, uma régua de intervalos alinhada às barras: eventos, rótulo, perguntas
 *  e o botão que abre os pedidos daquele intervalo (o caminho por teclado do gráfico). */
export function SerieDossie({ serie, perguntas, eventos, codigos, familia, temKit, passo, onPasso }: Props) {
  const [aberto, setAberto] = useState<number | null>(null);
  const n = serie.length;

  const dados = useMemo(() => serie.map((p, i) => ({
    i, rotulo: p.intervalo.rotulo, parcial: p.intervalo.incompleto,
    diretas: p.unidades - p.unidadesKit, kit: p.unidadesKit, lucro: p.lucro, precoMedio: p.precoMedio,
    faixa: p.precoMin != null && p.precoMax != null ? [p.precoMin, p.precoMax] : null,
  })), [serie]);
  const eventosPorIv = useMemo(() => serie.map((p) => {
    const ini = Date.parse(p.intervalo.inicio); const fim = Date.parse(p.intervalo.fim);
    return eventos.filter((e) => { const t = Date.parse(e.em); return t >= ini && t < fim; });
  }), [serie, eventos]);

  const total = serie.reduce((s, p) => s + p.unidades, 0);
  const totalKit = serie.reduce((s, p) => s + p.unidadesKit, 0);
  const maxPerg = Math.max(0, ...perguntas);
  const lucroNeg = serie.some((p) => (p.lucro ?? 0) < 0);
  // Rótulos da régua: contados do fim (o intervalo corrente sempre aparece); menos no celular.
  const passoSm = Math.max(1, Math.ceil(n / 6));
  const passoLg = Math.max(1, Math.ceil(n / 16));

  const resumo = useMemo(() => {
    if (!n) return 'Sem intervalos no período.';
    const pico = serie.reduce((a, b) => (b.unidades > a.unidades ? b : a));
    const lucros = serie.flatMap((p) => (p.lucro != null ? [p.lucro] : []));
    const ultimo = serie[n - 1].intervalo;
    return [
      `Evolução ${passo === 'semana' ? 'semanal' : 'mensal'}: ${n} ${n === 1 ? 'intervalo' : 'intervalos'}, de ${serie[0].intervalo.rotulo} a ${ultimo.rotulo}${ultimo.incompleto ? ' (parcial)' : ''}.`,
      `${fmtInt(total)} ${total === 1 ? 'unidade' : 'unidades'} nos intervalos mostrados${totalKit ? `, ${fmtInt(totalKit)} dentro de kit` : ''}.`,
      total ? `Pico de ${fmtInt(pico.unidades)} un. em ${pico.intervalo.rotulo}.` : '',
      lucros.length ? `Lucro por intervalo de ${fmtBRL(Math.min(...lucros))} a ${fmtBRL(Math.max(...lucros))}.` : '',
      `${fmtInt(perguntas.reduce((s, q) => s + q, 0))} perguntas no anúncio.`,
      'Os botões de cada intervalo abrem a lista de pedidos.',
    ].filter(Boolean).join(' ');
  }, [serie, n, passo, total, totalKit, perguntas]);

  return (
    <section aria-labelledby="dossie-serie" className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id="dossie-serie" className="text-sm font-medium">{passo === 'semana' ? 'Evolução semanal' : 'Evolução mensal'}</h3>
        <div role="group" aria-label="Agrupar por" className="flex gap-1">
          {(['semana', 'mes'] as const).map((p) => (
            <Button key={p} size="sm" variant={passo === p ? 'default' : 'outline'} className="h-7 px-2.5 text-xs"
              aria-pressed={passo === p} onClick={() => onPasso(p)}>
              {p === 'semana' ? 'Semana' : 'Mês'}
            </Button>
          ))}
        </div>
      </div>
      <p className="sr-only">{resumo}</p>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-chart-1" />Unidades</li>
        {temKit && <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-chart-3" />Dentro de kit</li>}
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded-full bg-success" />Lucro em R$ (eixo à direita)</li>
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-[2px] border-y border-dashed border-muted-foreground/60 bg-muted-foreground/10" />Preço médio, faixa mín. a máx.</li>
      </ul>

      <div className="-mx-1 overflow-x-auto px-1">
        <div style={{ minWidth: n * MIN_POR_INTERVALO + EIXO_UNID + EIXO_LUCRO + 2 * MARGEM }}>
          <div className="relative h-60 sm:h-64" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dados} margin={{ top: 8, right: MARGEM, left: MARGEM, bottom: 0 }}>
                <CartesianGrid yAxisId="un" strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="rotulo" hide />
                <YAxis yAxisId="un" width={EIXO_UNID} tick={EIXO} stroke="var(--border)" allowDecimals={false} tickFormatter={(v) => fmtInt(Number(v))} />
                <YAxis yAxisId="lucro" orientation="right" width={EIXO_LUCRO} tick={EIXO} stroke="var(--border)" tickFormatter={(v) => kReais(Number(v))} />
                <YAxis yAxisId="preco" hide width={0} domain={['dataMin - 1', 'dataMax + 1']} />
                {lucroNeg && <ReferenceLine yAxisId="lucro" y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />}
                <Tooltip {...TOOLTIP} itemSorter={(it) => ORDEM_TOOLTIP.indexOf(String(it.name))}
                  labelFormatter={(_, payload) => {
                    const d = payload?.[0]?.payload as (typeof dados)[number] | undefined;
                    return d ? `${passo === 'semana' ? 'Semana de ' : ''}${d.rotulo}${d.parcial ? ' (parcial)' : ''}` : '';
                  }}
                  formatter={(v, nome) => {
                    if (Array.isArray(v)) return [v[0] === v[1] ? fmtBRL(Number(v[0])) : `${fmtBRL(Number(v[0]))} a ${fmtBRL(Number(v[1]))}`, nome];
                    return [nome === 'Lucro' || nome === 'Preço médio' ? fmtBRL(Number(v)) : `${fmtInt(Number(v))} un.`, nome];
                  }} />
                <Area yAxisId="preco" dataKey="faixa" name="Faixa de preço" stroke="none" fill="var(--muted-foreground)" fillOpacity={0.1} isAnimationActive={false} activeDot={false} />
                <Bar yAxisId="un" dataKey="diretas" name={temKit ? 'Fora de kit' : 'Unidades'} stackId="u" fill="var(--chart-1)"
                  radius={temKit ? 0 : [3, 3, 0, 0]} maxBarSize={36} cursor="pointer" onClick={(_, i) => setAberto(i)}>
                  {dados.map((d) => <Cell key={d.i} fillOpacity={d.parcial ? 0.4 : 1} />)}
                </Bar>
                {temKit && (
                  <Bar yAxisId="un" dataKey="kit" name="Dentro de kit" stackId="u" fill="var(--chart-3)" radius={[3, 3, 0, 0]}
                    maxBarSize={36} cursor="pointer" onClick={(_, i) => setAberto(i)}>
                    {dados.map((d) => <Cell key={d.i} fillOpacity={d.parcial ? 0.4 : 1} />)}
                  </Bar>
                )}
                <Line yAxisId="preco" dataKey="precoMedio" name="Preço médio" stroke="var(--muted-foreground)" strokeWidth={1.25}
                  strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
                <Line yAxisId="lucro" dataKey="lucro" name="Lucro" stroke="var(--success)" strokeWidth={2}
                  dot={{ r: 2.5, fill: 'var(--success)', strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            {total === 0 && (
              <p className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted-foreground">Nenhuma venda nos intervalos deste período.</p>
            )}
          </div>

          {/* Régua de intervalos: mesma faixa horizontal da área de plotagem. */}
          <ol className="grid border-t" aria-label="Intervalos"
            style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, paddingLeft: MARGEM + EIXO_UNID, paddingRight: MARGEM + EIXO_LUCRO }}>
            {serie.map((p, i) => {
              const evs = eventosPorIv[i];
              const tipos = [...new Set(evs.map((e) => e.tipo))] as TipoEvento[];
              const q = perguntas[i] ?? 0;
              const doFim = n - 1 - i;
              const rotuloVisivel = doFim % passoSm === 0 ? '' : doFim % passoLg === 0 ? 'hidden sm:block' : 'hidden';
              const rotulo = `${nomeIntervalo(p, passo)}${p.intervalo.incompleto ? ' (parcial)' : ''}: ${fmtInt(p.unidades)} un.`
                + `${p.unidadesKit ? `, ${fmtInt(p.unidadesKit)} dentro de kit` : ''}`
                + `, lucro ${p.lucro != null ? fmtBRL(p.lucro) : 'sem custo'}, ${q} ${q === 1 ? 'pergunta' : 'perguntas'}`
                + `${evs.length ? `, ${evs.length} ${evs.length === 1 ? 'evento' : 'eventos'}` : ''}. Ver pedidos`;
              return (
                <li key={p.intervalo.inicio} className="min-w-0">
                  <button type="button" aria-label={rotulo} title={rotulo} onClick={() => setAberto(i)}
                    className="flex w-full flex-col items-center gap-1 rounded-sm px-px pb-1 pt-1.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex h-3.5 items-center justify-center" aria-hidden>
                      {/* No celular a coluna é estreita: 1 ícone; a lista completa está em Eventos. */}
                      {tipos.slice(0, 2).map((t, k) => { const { Icone, cor } = TIPO_EVENTO[t]; return <Icone key={t} className={cn('size-3 shrink-0', cor, k > 0 && 'hidden sm:block')} />; })}
                    </span>
                    <span className={cn('whitespace-nowrap text-[11px] leading-none tabular-nums text-muted-foreground', rotuloVisivel)} aria-hidden>
                      {p.intervalo.rotulo}
                    </span>
                    {p.intervalo.incompleto && <span className={cn('whitespace-nowrap text-[10px] leading-none text-muted-foreground', rotuloVisivel)} aria-hidden>(parcial)</span>}
                    <span className="flex h-3 items-end" aria-hidden>
                      <span className={cn('w-1 rounded-full', q ? 'bg-info/70' : 'bg-border')}
                        style={{ height: q ? Math.max(3, Math.round((q / maxPerg) * 12)) : 1 }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>Embaixo de cada barra: eventos do intervalo (lista abaixo) e perguntas recebidas no anúncio. Toque num intervalo para ver os pedidos.</p>
        {familia && <p>Na família, o preço médio também muda pelo mix de variações vendidas.</p>}
        {temKit && <p>Dentro de kit: cobertura parcial (sem histórico antes de set/2026).</p>}
      </div>

      <SheetPedidos ponto={aberto != null ? serie[aberto] ?? null : null} passo={passo} codigos={codigos} familia={familia} onClose={() => setAberto(null)} />
    </section>
  );
}

function SheetPedidos({ ponto, passo, codigos, familia, onClose }: {
  ponto: PontoSerie | null; passo: Passo; codigos: string[]; familia: boolean; onClose: () => void;
}) {
  const destaque = useMemo(() => ({ codigos: new Set(codigos), rotulo: familia ? 'desta família' : 'este SKU' }), [codigos, familia]);
  const pedidos = ponto ? [...ponto.pedidos].sort((a, b) => Date.parse(b.data ?? '') - Date.parse(a.data ?? '')) : [];
  return (
    <Sheet open={ponto != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {ponto && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-8">
                {nomeIntervalo(ponto, passo)}
                {ponto.intervalo.incompleto && <span className="font-normal text-muted-foreground"> (parcial)</span>}
              </SheetTitle>
              <SheetDescription className="tabular-nums">
                {`${fmtInt(pedidos.length)} ${pedidos.length === 1 ? 'pedido' : 'pedidos'} com ${familia ? 'a família' : 'este código'} · ${fmtInt(ponto.unidades)} un. faturadas · ${fmtBRL(ponto.bruto)}`}
              </SheetDescription>
            </SheetHeader>
            {pedidos.length === 0 ? (
              <p className="px-4 text-sm text-muted-foreground">Nenhum pedido {familia ? 'da família' : 'deste código'} neste intervalo.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border px-4 pb-4">
                {pedidos.map((p) => <LinhaPedidoSheet key={p.chave} p={p} destaque={destaque} familia={familia} />)}
              </ul>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Linha compacta do pedido (as mesmas peças da aba Vendas), aberta no detalhe dos itens. */
function LinhaPedidoSheet({ p, destaque, familia }: { p: Pedido; destaque: { codigos: ReadonlySet<string>; rotulo: string }; familia: boolean }) {
  const [aberto, setAberto] = useState(false);
  const pgto = labelStatusPedido(p.status);
  const un = p.itens.reduce((s, it) => s + (destaque.codigos.has(it.codigo?.trim() ?? '') ? it.quantity : 0), 0);
  const Chevron = aberto ? ChevronDown : ChevronRight;
  return (
    <li className="py-1">
      <button type="button" aria-expanded={aberto} onClick={() => setAberto(!aberto)}
        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-md px-1 py-2 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Chevron className="size-4 text-muted-foreground" aria-hidden />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 truncate font-medium">
            {p.isPack && <Layers className="size-3 shrink-0 text-muted-foreground" aria-label="Pack" />}
            {nomeCurtoComprador(p.comprador_nome) ?? nomeExibicaoComprador(p)}
          </span>
          <span className="block text-xs tabular-nums text-muted-foreground">
            {`${fmtDataCurta(p.data)} · ${fmtInt(un)} un. ${familia ? 'da família' : 'deste código'}`}
          </span>
        </span>
        <span className="text-right tabular-nums">{fmtBRL(p.bruto)}</span>
        <span className="col-start-2 col-end-4 flex flex-wrap gap-1">
          <StatusPill tone={tom(pgto.tom)}>{pgto.label}</StatusPill>
          {p.ehKit && <StatusPill tone="info"><Package className="size-3" aria-hidden />Kit</StatusPill>}
          {p.tem_devolucao && <StatusPill tone="danger"><RotateCcw className="size-3" aria-hidden />Devolução</StatusPill>}
        </span>
      </button>
      {aberto && (
        <div className="-mx-4 overflow-x-auto bg-muted/20 [&>div]:px-4">
          <DetalhePedidoItens pedido={p} destaque={destaque} />
        </div>
      )}
    </li>
  );
}
