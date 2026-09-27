import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Bar, Cell, ComposedChart, ErrorBar, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChevronDown, ChevronRight, Layers, Package, RotateCcw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DetalhePedidoItens } from '@/components/faturamento/detalhe-pedido-itens';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { fmtDataCurta, labelStatusPedido } from '@/lib/ml-status';
import { nomeCurtoComprador, nomeExibicaoComprador, type Pedido } from '@/lib/pedidos-faturamento';
import type { Intervalo, Passo } from '@/lib/calendario-brt';
import type { Evento, PontoSerie, TipoEvento } from '@/lib/sku-dossie';
import { TIPO_EVENTO } from './tipos-evento';
import { dataBR } from './formato-dossie';

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
  separator: ': ',
};
const EIXO = { fontSize: 11, fill: 'var(--muted-foreground)' };
const kReais = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) >= 10_000 ? 0 : 1).replace('.', ',')}k` : String(Math.round(v)));
// Ordem do tooltip: a mesma leitura da legenda.
const ORDEM_TOOLTIP = ['Unidades', 'Fora de kit', 'Dentro de kit', 'Lucro', 'Preço médio', 'Perguntas'];
const tom = (t: 'success' | 'warning' | 'danger' | 'muted'): StatusTone => (t === 'muted' ? 'neutral' : t);

const nomeIntervalo = (p: PontoSerie, passo: Passo) => (passo === 'semana' ? `Semana de ${p.intervalo.rotulo}` : p.intervalo.rotulo);
/** "(parcial)" no intervalo em andamento; "(início parcial)" no 1º, que começa antes do período. */
const marcaParcial = (iv: Intervalo) => (iv.incompleto ? '(parcial)' : iv.inicioParcial ? '(início parcial)' : null);

interface Props {
  serie: PontoSerie[];
  perguntas: number[];
  eventos: Evento[];
  codigos: string[];
  familia: boolean;
  temKit: boolean;
  historicoDesde: string | null;
  passo: Passo;
  onPasso: (p: Passo) => void;
}

/** Série do período: unidades (barras), lucro (linha, eixo à direita), preço médio (linha fina com
 *  bigode mín./máx. por intervalo). Embaixo, uma régua de intervalos alinhada às barras: eventos,
 *  rótulo, perguntas e o botão que abre os pedidos daquele intervalo (o caminho por teclado). */
export function SerieDossie({ serie, perguntas, eventos, codigos, familia, temKit, historicoDesde, passo, onPasso }: Props) {
  const [aberto, setAberto] = useState<number | null>(null);
  const n = serie.length;
  // Roving tabindex: um só tab stop na régua, começando no intervalo corrente.
  const [foco, setFoco] = useState(n - 1);
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);
  const focoAtual = Math.min(Math.max(foco, 0), n - 1);

  const dados = useMemo(() => {
    // O intervalo em andamento é sempre o último.
    const ultimoCompleto = serie[serie.length - 1]?.intervalo.incompleto ? serie.length - 2 : serie.length - 1;
    return serie.map((p, i) => ({
      i, rotulo: p.intervalo.rotulo, marca: marcaParcial(p.intervalo), parcial: p.intervalo.incompleto,
      diretas: p.unidades - p.unidadesKit, kit: p.unidadesKit,
      // O trecho que chega ao intervalo em andamento é tracejado: a queda ainda não é real.
      lucro: p.intervalo.incompleto ? null : p.lucro,
      lucroParcial: p.intervalo.incompleto || i === ultimoCompleto ? p.lucro : null,
      precoMedio: p.precoMedio, precoMin: p.precoMin, precoMax: p.precoMax,
      bigode: p.precoMedio != null && p.precoMin != null && p.precoMax != null ? [p.precoMedio - p.precoMin, p.precoMax - p.precoMedio] : null,
      perguntas: perguntas[i] ?? 0,
    }));
  }, [serie, perguntas]);
  const eventosPorIv = useMemo(() => serie.map((p) => {
    const ini = Date.parse(p.intervalo.inicio); const fim = Date.parse(p.intervalo.fim);
    return eventos.filter((e) => { const t = Date.parse(e.em); return t >= ini && t < fim; });
  }), [serie, eventos]);

  const total = serie.reduce((s, p) => s + p.unidades, 0);
  const totalKit = serie.reduce((s, p) => s + p.unidadesKit, 0);
  const maxPerg = Math.max(0, ...perguntas);
  const maxPreco = Math.max(0, ...serie.map((p) => p.precoMax ?? 0));
  const lucroNeg = serie.some((p) => (p.lucro ?? 0) < 0);
  // Marcador "Histórico desde": só quando a 1ª venda cai depois do início do 1º intervalo.
  const ivHistorico = historicoDesde ? serie.findIndex((p) => {
    const t = Date.parse(historicoDesde); return t > Date.parse(serie[0].intervalo.inicio) && t >= Date.parse(p.intervalo.inicio) && t < Date.parse(p.intervalo.fim);
  }) : -1;
  // Rótulos da régua: contados do fim (o intervalo corrente sempre aparece); menos no celular.
  const passoSm = Math.max(1, Math.ceil(n / 6));
  const passoLg = Math.max(1, Math.ceil(n / 16));

  const resumo = useMemo(() => {
    if (!n) return 'Sem intervalos no período.';
    const pico = serie.reduce((a, b) => (b.unidades > a.unidades ? b : a));
    const lucros = serie.flatMap((p) => (p.lucro != null ? [p.lucro] : []));
    const primeiro = serie[0].intervalo;
    const ultimo = serie[n - 1].intervalo;
    return [
      `Evolução ${passo === 'semana' ? 'semanal' : 'mensal'}: ${n} ${n === 1 ? 'intervalo' : 'intervalos'}, de ${primeiro.rotulo}${primeiro.inicioParcial ? ' (início parcial)' : ''} a ${ultimo.rotulo}${ultimo.incompleto ? ' (parcial)' : ''}.`,
      `${fmtInt(total)} ${total === 1 ? 'unidade' : 'unidades'} nos intervalos mostrados${totalKit ? `, ${fmtInt(totalKit)} dentro de kit` : ''}.`,
      total ? `Pico de ${fmtInt(pico.unidades)} un. em ${pico.intervalo.rotulo}.` : '',
      lucros.length ? `Lucro por intervalo de ${fmtBRL(Math.min(...lucros))} a ${fmtBRL(Math.max(...lucros))}.` : '',
      `${fmtInt(perguntas.reduce((s, q) => s + q, 0))} perguntas no anúncio.`,
      'Os botões de cada intervalo abrem a lista de pedidos; as setas andam entre eles.',
    ].filter(Boolean).join(' ');
  }, [serie, n, passo, total, totalKit, perguntas]);

  const moverFoco = (e: KeyboardEvent<HTMLButtonElement>) => {
    const alvo = { ArrowLeft: focoAtual - 1, ArrowRight: focoAtual + 1, Home: 0, End: n - 1 }[e.key];
    if (alvo == null) return;
    e.preventDefault();
    const i = Math.min(Math.max(alvo, 0), n - 1);
    setFoco(i);
    botoes.current[i]?.focus();
  };

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
        <li className="flex items-center gap-1.5">
          <svg width="14" height="12" className="text-muted-foreground" aria-hidden>
            <line x1="7" y1="1" x2="7" y2="11" stroke="currentColor" /><line x1="4.5" y1="1" x2="9.5" y2="1" stroke="currentColor" />
            <line x1="4.5" y1="11" x2="9.5" y2="11" stroke="currentColor" /><circle cx="7" cy="6" r="2" fill="currentColor" />
          </svg>
          Preço médio, mín. a máx.
        </li>
        <li className="flex items-center gap-1.5"><ShieldAlert className="size-3" />Eventos</li>
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-1 rounded-full bg-info/70" />Perguntas</li>
      </ul>

      <div className="-mx-1 overflow-x-auto px-1">
        <div style={{ minWidth: n * MIN_POR_INTERVALO + EIXO_UNID + EIXO_LUCRO + 2 * MARGEM }}>
          <div className="relative h-60 sm:h-64" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dados} margin={{ top: 16, right: MARGEM, left: MARGEM, bottom: 0 }}>
                <CartesianGrid yAxisId="un" strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="rotulo" hide />
                <YAxis yAxisId="un" width={EIXO_UNID} tick={EIXO} stroke="var(--border)" allowDecimals={false} tickFormatter={(v) => fmtInt(Number(v))} />
                <YAxis yAxisId="lucro" orientation="right" width={EIXO_LUCRO} tick={EIXO} stroke="var(--border)" tickFormatter={(v) => kReais(Number(v))} />
                {/* Preço a partir de zero: a variação aparece no tamanho real, não esticada. */}
                <YAxis yAxisId="preco" hide width={0} domain={[0, maxPreco > 0 ? maxPreco * 1.15 : 1]} />
                {lucroNeg && <ReferenceLine yAxisId="lucro" y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />}
                {ivHistorico > 0 && historicoDesde && (
                  <ReferenceLine yAxisId="un" x={dados[ivHistorico].rotulo} stroke="var(--muted-foreground)" strokeDasharray="2 3" strokeOpacity={0.6}
                    label={{ value: `Histórico desde ${dataBR(historicoDesde).slice(0, 5)}`, position: 'insideTopLeft', fontSize: 10, fill: 'var(--muted-foreground)', dy: -14 }} />
                )}
                <Tooltip {...TOOLTIP} itemSorter={(it) => ORDEM_TOOLTIP.indexOf(String(it.name))}
                  labelFormatter={(_, payload) => {
                    const d = payload?.[0]?.payload as (typeof dados)[number] | undefined;
                    return d ? `${passo === 'semana' ? 'Semana de ' : ''}${d.rotulo}${d.marca ? ` ${d.marca}` : ''}` : '';
                  }}
                  formatter={(v, nome, item) => {
                    const d = item.payload as (typeof dados)[number];
                    if (nome === 'Preço médio') {
                      const faixa = d.precoMin != null && d.precoMax != null && d.precoMin !== d.precoMax ? ` (mín. ${fmtBRL(d.precoMin)}, máx. ${fmtBRL(d.precoMax)})` : '';
                      return [`${fmtBRL(Number(v))}${faixa}`, nome];
                    }
                    if (nome === 'Lucro') return [fmtBRL(Number(v)), nome];
                    if (nome === 'Perguntas') return [fmtInt(Number(v)), nome];
                    return [`${fmtInt(Number(v))} un.`, nome];
                  }} />
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
                  dot={{ r: 2, fill: 'var(--muted-foreground)', strokeWidth: 0 }} activeDot={{ r: 3.5 }} connectNulls={false} isAnimationActive={false}>
                  <ErrorBar dataKey="bigode" direction="y" width={5} stroke="var(--muted-foreground)" strokeWidth={1} />
                </Line>
                <Line yAxisId="lucro" dataKey="lucro" name="Lucro" stroke="var(--success)" strokeWidth={2}
                  dot={{ r: 2.5, fill: 'var(--success)', strokeWidth: 0 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                <Line yAxisId="lucro" dataKey="lucroParcial" name="Lucro" tooltipType="none" stroke="var(--success)" strokeWidth={2} strokeDasharray="4 3"
                  dot={{ r: 2.5, fill: 'var(--success)', strokeWidth: 0 }} activeDot={false} connectNulls={false} isAnimationActive={false} />
                {/* Só para o tooltip: perguntas no eixo do preço (domínio fixo), sem traço. */}
                <Line yAxisId="preco" dataKey="perguntas" name="Perguntas" stroke="none" dot={false} activeDot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            {total === 0 && (
              <p className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted-foreground">Nenhuma venda nos intervalos deste período.</p>
            )}
          </div>

          {/* Régua de intervalos: mesma faixa horizontal da área de plotagem; linhas de altura fixa
              (rótulo e marca de parcial ficam `invisible`, nunca somem) para as colunas alinharem. */}
          <ol className="grid border-t" aria-label="Intervalos"
            style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, paddingLeft: MARGEM + EIXO_UNID, paddingRight: MARGEM + EIXO_LUCRO }}>
            {serie.map((p, i) => {
              const evs = eventosPorIv[i];
              const tipos = [...new Set(evs.map((e) => e.tipo))] as TipoEvento[];
              const q = perguntas[i] ?? 0;
              const doFim = n - 1 - i;
              const visivel = doFim % passoSm === 0 ? '' : doFim % passoLg === 0 ? 'invisible sm:visible' : 'invisible';
              const marca = marcaParcial(p.intervalo);
              const rotulo = `${nomeIntervalo(p, passo)}${marca ? ` ${marca}` : ''}: ${fmtInt(p.unidades)} un.`
                + `${p.unidadesKit ? `, ${fmtInt(p.unidadesKit)} dentro de kit` : ''}`
                + `, lucro ${p.lucro != null ? fmtBRL(p.lucro) : 'sem custo'}, ${q} ${q === 1 ? 'pergunta' : 'perguntas'}`
                + `${evs.length ? `, ${evs.length} ${evs.length === 1 ? 'evento' : 'eventos'}` : ''}. Ver pedidos`;
              return (
                <li key={p.intervalo.inicio} className="min-w-0">
                  <button type="button" aria-label={rotulo} title={rotulo} tabIndex={i === focoAtual ? 0 : -1}
                    ref={(el) => { botoes.current[i] = el; }} onFocus={() => setFoco(i)} onKeyDown={moverFoco} onClick={() => setAberto(i)}
                    className="flex w-full flex-col items-center gap-1 rounded-sm px-px pb-1 pt-1.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex h-3.5 items-center justify-center" aria-hidden>
                      {/* No celular a coluna é estreita: 1 ícone; a lista completa está em Eventos. */}
                      {tipos.slice(0, 2).map((t, k) => { const { Icone, cor } = TIPO_EVENTO[t]; return <Icone key={t} className={cn('size-3 shrink-0', cor, k > 0 && 'hidden sm:block')} />; })}
                    </span>
                    <span className={cn('h-3 whitespace-nowrap text-[11px] leading-3 tabular-nums text-muted-foreground', visivel)} aria-hidden>
                      {p.intervalo.rotulo}
                    </span>
                    <span className={cn('h-2.5 whitespace-nowrap text-[10px] leading-[10px] text-muted-foreground', marca ? visivel : 'invisible')} aria-hidden>
                      {marca ?? ' '}
                    </span>
                    <span className="flex h-3 items-end" aria-hidden>
                      {q > 0 && <span className="w-1 rounded-full bg-info/70" style={{ height: Math.max(3, Math.round((q / maxPerg) * 12)) }} />}
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
        {serie[0]?.intervalo.inicioParcial && <p>O 1º intervalo começa antes do período escolhido e conta as vendas desde o início dele.</p>}
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
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl lg:max-w-4xl">
        {ponto && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-8">
                {nomeIntervalo(ponto, passo)}
                {marcaParcial(ponto.intervalo) && <span className="font-normal text-muted-foreground"> {marcaParcial(ponto.intervalo)}</span>}
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
        <span className="text-right tabular-nums">
          {fmtBRL(p.bruto)}
          {/* Num pack com outros produtos o valor não é só deste SKU. */}
          <span className="block text-[11px] text-muted-foreground">total do pedido</span>
        </span>
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
