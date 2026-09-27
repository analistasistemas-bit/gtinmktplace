import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, ErrorBar, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CircleDashed, CircleSlash, Clock, CloudOff, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import type { Passo } from '@/lib/calendario-brt';
import type { PontoTrafego, TrafegoDossie } from '@/lib/sku-trafego';
import { Fato } from './cabecalho-dossie';
import { EIXO, EIXO_LUCRO, EIXO_UNID, MARGEM, MIN_POR_INTERVALO, TOOLTIP, kCompacto, marcaParcial } from './serie-pontos';
import { asHoraDeBRT, diaMesLiteral } from './formato-dossie';

/** Razão, nunca "%": 1 venda em 14 visitas = "0,071 un./visita"; pode passar de 1. Dois dígitos
 *  significativos: 1 venda em 500 visitas não vira "0,00". */
const fmtUnPorVisita = (v: number) => `${v.toLocaleString('pt-BR', { maximumSignificantDigits: 2 })} un./visita`;
const razaoEixo = (v: number) => v.toLocaleString('pt-BR', { maximumSignificantDigits: 2 });
const H48 = '48 h';

type Situacao = { tipo: 'ok' } | { tipo: 'aguardando' } | { tipo: 'nao_coletado' } | { tipo: 'sem_dado'; n: number };
/** Visitas null: algum MLB × dia não é `ok`. Falha/ausente pesa mais que "ainda não coletado"
 *  (carga parcial), que pesa mais que "ainda nas 48 h". */
function situacao(p: PontoTrafego): Situacao {
  if (p.visitas != null) return { tipo: 'ok' };
  const n = p.estados.falha + p.estados.ausente;
  if (n > 0) return { tipo: 'sem_dado', n };
  return p.estados.nao_coletado > 0 ? { tipo: 'nao_coletado' } : { tipo: 'aguardando' };
}
/** A contagem é MLB × dia: com mais de um anúncio, "dia" sozinho mentiria. */
function textoSituacao(s: Situacao, nMlbs: number): string {
  if (s.tipo === 'aguardando') return `em curso · aguardando ${H48}`;
  if (s.tipo === 'nao_coletado') return 'ainda não coletado';
  if (s.tipo === 'sem_dado') return `sem dado em ${s.n} ${nMlbs > 1 ? (s.n === 1 ? 'dia de anúncio' : 'dias de anúncio') : (s.n === 1 ? 'dia' : 'dias')}`;
  return '';
}
const ICONE = { aguardando: Clock, nao_coletado: CircleDashed, sem_dado: CircleSlash } as const;

const nomeIntervalo = (p: PontoTrafego, passo: Passo) => `${passo === 'semana' ? 'Semana de ' : ''}${p.intervalo.rotulo}`;
const faixaPreco = (f: PontoTrafego['precoObservado']) => (!f ? 'sem observação' : f.min === f.max ? fmtBRL(f.min) : `${fmtBRL(f.min)} a ${fmtBRL(f.max)}`);

/** As mesmas linhas no tooltip, no detalhe do intervalo e no rótulo do botão da régua. */
function linhas(p: PontoTrafego, nMlbs: number, anuncio: boolean): Array<[string, string]> {
  const s = situacao(p);
  return [
    ['Visitas', p.visitas != null ? fmtInt(p.visitas) : textoSituacao(s, nMlbs)],
    [anuncio ? 'Unidades do anúncio' : 'Unidades', `${fmtInt(p.unidades)} un.`],
    ['Unidades por visita', p.unidadesPorVisita != null ? fmtUnPorVisita(p.unidadesPorVisita)
      : p.visitas === 0 ? 'sem visitas' : 'não medida'],
    ['Preço observado', faixaPreco(p.precoObservado)],
  ];
}

/** Rótulo curto do alcance: de quem são as visitas. */
function alcanceTexto(t: TrafegoDossie): string {
  const cons = t.porMlb.filter((m) => m.considerado);
  if (t.alcance === 'sku') return 'deste SKU';
  if (t.alcance === 'familia') return 'da família';
  if (t.alcance === 'anuncio') {
    if (cons.length === 1) {
      const outras = cons[0].codigos.length - 1;
      return `do anúncio inteiro (compartilhado com ${outras} ${outras === 1 ? 'variação' : 'variações'})`;
    }
    return `de ${cons.length} anúncios inteiros (compartilhados com outras variações)`;
  }
  return '';
}

function Aviso({ icone: Icone, tom, children }: { icone: typeof AlertTriangle; tom: 'warning' | 'muted'; children: ReactNode }) {
  return (
    <div role="note" className={cn('flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm',
      tom === 'warning' ? 'border-warning/30 bg-warning/10' : 'border-dashed text-muted-foreground')}>
      <Icone className={cn('mt-0.5 size-4 shrink-0', tom === 'warning' ? 'text-warning' : 'text-muted-foreground')} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Ponto da razão: 0 medido é um anel (lê como ponto na base), lacuna fica sem ponto. */
function PontoRazao({ cx, cy, value, index }: { cx?: number; cy?: number; value?: number | null; index?: number }) {
  if (cx == null || cy == null || value == null) return <g key={index} />;
  return value === 0
    ? <circle key={index} cx={cx} cy={cy} r={2.75} fill="var(--card)" stroke="var(--chart-1)" strokeWidth={1.5} />
    : <circle key={index} cx={cx} cy={cy} r={2.5} fill="var(--chart-1)" />;
}

interface Props {
  trafego: TrafegoDossie;
  familia: boolean;
  passo: Passo;
  onPasso: (p: Passo) => void;
  onTentar: () => void;
}

/** Tráfego e oferta do período: visitas (barras), unidades por visita (linha, eixo à direita) e o
 *  preço de oferta observado (faixa mín./máx. por intervalo, como o bigode da série de vendas).
 *  Intervalo incompleto não vira zero: a barra dá lugar a uma faixa apagada e a régua diz por quê. */
export function TrafegoDossie({ trafego: t, familia, passo, onPasso, onTentar }: Props) {
  const serie = t.serie;
  const n = serie.length;
  const nMlbs = t.porMlb.filter((m) => m.considerado).length;
  const anuncio = t.alcance === 'anuncio';
  // Entrada no último intervalo completo: o corrente quase sempre ainda espera as 48 h.
  // O foco vale para a série em que foi escolhido: série nova (Semana/Mês, período, carga) volta ao inicial.
  const inicial = n > 1 && serie[n - 1].intervalo.incompleto ? n - 2 : n - 1;
  const [escolha, setEscolha] = useState<{ serie: PontoTrafego[]; i: number } | null>(null);
  const setFoco = (i: number) => setEscolha({ serie, i });
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);
  const focoAtual = Math.min(Math.max(escolha?.serie === serie ? escolha.i : inicial, 0), n - 1);

  const dados = useMemo(() => serie.map((p, i) => ({
    i, rotulo: p.intervalo.rotulo, marca: marcaParcial(p.intervalo), parcial: p.intervalo.incompleto,
    visitas: p.visitas, upv: p.unidadesPorVisita,
    // Preço: ponto no meio da faixa com bigode simétrico até o mín. e o máx.
    preco: p.precoObservado ? (p.precoObservado.min + p.precoObservado.max) / 2 : null,
    bigode: p.precoObservado ? (p.precoObservado.max - p.precoObservado.min) / 2 : null,
  })), [serie]);
  const maxPreco = Math.max(0, ...serie.map((p) => p.precoObservado?.max ?? 0));
  const maxUpv = Math.max(0, ...serie.map((p) => p.unidadesPorVisita ?? 0));
  // Piso levemente negativo: a linha no 0 fica acima da base e não some no eixo.
  const topoUpv = maxUpv > 0 ? maxUpv * 1.1 : 0.1;
  const passoSm = Math.max(1, Math.ceil(n / 6));
  const passoLg = Math.max(1, Math.ceil(n / 16));
  const situacoes = useMemo(() => serie.map(situacao), [serie]);
  const tem = (tipo: Situacao['tipo']) => situacoes.some((s) => s.tipo === tipo);

  // Período: só os intervalos com todos os dias `ok` (mesmos MLBs e dias no numerador e no denominador).
  const completos = serie.filter((p) => p.visitas != null);
  const somaVisitas = completos.reduce((s, p) => s + (p.visitas ?? 0), 0);
  const somaUnidades = completos.reduce((s, p) => s + p.unidades, 0);
  const upvPeriodo = somaVisitas > 0 ? somaUnidades / somaVisitas : null;

  const alcance = alcanceTexto(t);
  const compartilhados = t.porMlb.filter((m) => m.considerado && m.vinculo === 'compartilhado');
  const comSelo = new Set(compartilhados.map((m) => m.mlb));
  const temGrafico = t.alcance !== 'indisponivel' && (t.estadoColeta === 'ok' || t.estadoColeta === 'parcial') && n > 0;

  const resumo = useMemo(() => {
    if (!n) return '';
    const conta = (tipo: Situacao['tipo']) => situacoes.filter((s) => s.tipo === tipo).length;
    return [
      `Tráfego ${passo === 'semana' ? 'semanal' : 'mensal'} ${alcance}: ${n} ${n === 1 ? 'intervalo' : 'intervalos'}, de ${serie[0].intervalo.rotulo} a ${serie[n - 1].intervalo.rotulo}.`,
      `${fmtInt(somaVisitas)} visitas em ${completos.length} ${completos.length === 1 ? 'intervalo completo' : 'intervalos completos'}${upvPeriodo != null ? `, ${fmtUnPorVisita(upvPeriodo)}` : ''}.`,
      conta('aguardando') ? `${conta('aguardando')} em curso, aguardando ${H48}.` : '',
      conta('nao_coletado') ? `${conta('nao_coletado')} ainda não coletado.` : '',
      conta('sem_dado') ? `${conta('sem_dado')} sem dado.` : '',
      t.precoAtual ? `Preço de oferta ${fmtBRL(t.precoAtual.preco)} ${asHoraDeBRT(t.precoAtual.observadoEm)}.` : '',
      'Os botões de cada intervalo mostram o detalhe; as setas andam entre eles.',
    ].filter(Boolean).join(' ');
  }, [serie, situacoes, n, passo, alcance, somaVisitas, completos.length, upvPeriodo, t.precoAtual]);

  const moverFoco = (e: KeyboardEvent<HTMLButtonElement>) => {
    const alvo = { ArrowLeft: focoAtual - 1, ArrowRight: focoAtual + 1, Home: 0, End: n - 1 }[e.key];
    if (alvo == null) return;
    e.preventDefault();
    const i = Math.min(Math.max(alvo, 0), n - 1);
    setFoco(i);
    botoes.current[i]?.focus();
  };

  // Precedência: sem anúncio que sirva > leitura > motivo da parada > coleta não começou > parcial.
  let corpo: ReactNode = null;
  if (t.alcance === 'indisponivel') {
    corpo = (
      <Aviso icone={Unlink} tom="muted">
        {t.porMlb.length === 0
          ? `Nenhum anúncio do Mercado Livre vinculado a ${familia ? 'esta família' : 'este código'} no mapa atual: não há visitas para medir.`
          : familia
            ? 'Os anúncios desta família também vendem códigos de fora dela, e as visitas de um anúncio não se separam por código.'
            : 'Nenhum anúncio do mapa atual serve para medir as visitas deste código.'}
      </Aviso>
    );
  } else if (t.estadoColeta === 'carregando') {
    corpo = (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">Carregando o tráfego</span>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-1.5 bg-card px-3 py-2.5"><Skeleton className="h-3 w-24 bg-foreground/10" /><Skeleton className="h-4 w-20 bg-foreground/10" /></div>
          ))}
        </div>
        <Skeleton className="h-60 w-full bg-foreground/10 sm:h-64" />
      </div>
    );
  } else if (t.estadoColeta === 'erro') {
    corpo = (
      <Aviso icone={CloudOff} tom="warning">
        <p><span className="font-medium">Não foi possível ler o tráfego.</span>{' '}
          <span className="text-muted-foreground">O resto do dossiê não depende dele.</span></p>
        <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={onTentar}>Tentar de novo</Button>
      </Aviso>
    );
  } else if (t.estadoColeta === 'sem_coleta' && !t.motivo) {
    corpo = (
      <Aviso icone={Clock} tom="muted">
        A coleta de tráfego começa após a ativação. As visitas aparecem aqui a partir do dia seguinte.
      </Aviso>
    );
  } else if (temGrafico) {
    corpo = (
      <>
        <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
          <Fato rotulo={`Visitas · ${completos.length} de ${n} ${n === 1 ? 'intervalo completo' : 'intervalos completos'}`} fraco={!completos.length}>
            {completos.length ? fmtInt(somaVisitas) : 'nenhum intervalo completo'}
          </Fato>
          <Fato rotulo="Unidades por visita" fraco={upvPeriodo == null}>
            {upvPeriodo != null ? fmtUnPorVisita(upvPeriodo) : 'não medida'}
          </Fato>
          <Fato rotulo="Preço de oferta observado" fraco={!t.precoAtual}>
            {t.precoAtual ? <>{fmtBRL(t.precoAtual.preco)} <span className="font-normal text-muted-foreground">{asHoraDeBRT(t.precoAtual.observadoEm)}</span></> : 'sem observação'}
          </Fato>
        </dl>

        <p className="sr-only">{resumo}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
          <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-chart-3" />Visitas</li>
          <li className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded-full bg-chart-1" />Unidades por visita (eixo à direita)</li>
          <li className="flex items-center gap-1.5">
            <svg width="14" height="12" className="text-muted-foreground" aria-hidden>
              <line x1="7" y1="1" x2="7" y2="11" stroke="currentColor" /><line x1="4.5" y1="1" x2="9.5" y2="1" stroke="currentColor" />
              <line x1="4.5" y1="11" x2="9.5" y2="11" stroke="currentColor" /><circle cx="7" cy="6" r="2" fill="currentColor" />
            </svg>
            Preço de oferta, mín. a máx.
          </li>
          {tem('aguardando') && <li className="flex items-center gap-1.5"><Clock className="size-3" />{`Aguardando ${H48}`}</li>}
          {tem('nao_coletado') && <li className="flex items-center gap-1.5"><CircleDashed className="size-3" />Ainda não coletado</li>}
          {tem('sem_dado') && <li className="flex items-center gap-1.5"><CircleSlash className="size-3 text-warning" />Sem dado</li>}
        </ul>

        <div className="-mx-1 overflow-x-auto px-1">
          <div style={{ minWidth: n * MIN_POR_INTERVALO + EIXO_UNID + EIXO_LUCRO + 2 * MARGEM }}>
            {/* Toque/clique em qualquer coluna (inclusive as sem barra) leva o detalhe para ela; a coluna sai
                da posição (faixas iguais na área de plotagem), sem depender do estado do tooltip. O caminho
                acessível é a régua abaixo. */}
            <div className="relative h-60 cursor-pointer sm:h-64 [&_*]:outline-none" aria-hidden onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - r.left - MARGEM - EIXO_UNID;
              const largura = r.width - 2 * MARGEM - EIXO_UNID - EIXO_LUCRO;
              if (n > 0 && x >= 0 && x < largura) setFoco(Math.floor((x / largura) * n));
            }}>
              <ResponsiveContainer width="100%" height="100%">
                {/* Sem camada de acessibilidade: o gráfico é aria-hidden (resumo e régua fazem esse papel). */}
                <ComposedChart data={dados} margin={{ top: 16, right: MARGEM, left: MARGEM, bottom: 0 }} accessibilityLayer={false}>
                  <CartesianGrid yAxisId="vis" strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="rotulo" hide />
                  <YAxis yAxisId="vis" width={EIXO_UNID} tick={EIXO} stroke="var(--border)" allowDecimals={false} tickFormatter={(v) => kCompacto(Number(v))} />
                  <YAxis yAxisId="upv" orientation="right" width={EIXO_LUCRO} tick={EIXO} stroke="var(--border)" tickFormatter={(v) => razaoEixo(Number(v))}
                    domain={[-topoUpv * 0.04, topoUpv]} ticks={[0, 0.25, 0.5, 0.75, 1].map((k) => k * topoUpv)} />
                  <YAxis yAxisId="preco" hide width={0} allowDataOverflow domain={[0, maxPreco > 0 ? maxPreco * 1.15 : 1]} />
                  {/* Intervalo sem visitas completas: faixa apagada no lugar da barra, nunca uma barra zero. */}
                  {dados.filter((d) => d.visitas == null).map((d) => (
                    <ReferenceArea key={d.i} yAxisId="vis" x1={d.rotulo} x2={d.rotulo} fill="var(--muted-foreground)" fillOpacity={0.08}
                      stroke="var(--muted-foreground)" strokeOpacity={0.35} strokeDasharray="3 3" ifOverflow="hidden" />
                  ))}
                  <Tooltip cursor={TOOLTIP.cursor} filterNull={false} content={({ active, payload }) => {
                    const i = (payload?.[0]?.payload as { i?: number } | undefined)?.i;
                    if (!active || i == null) return null;
                    const p = serie[i];
                    // No celular o tooltip não cabe: o toque leva o card de detalhe abaixo do gráfico.
                    return (
                      <div className="hidden min-w-44 rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md sm:block">
                        <p className="mb-1 font-medium">{nomeIntervalo(p, passo)}{marcaParcial(p.intervalo) ? ` ${marcaParcial(p.intervalo)}` : ''}</p>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                          {linhas(p, nMlbs, anuncio).map(([k, v]) => (
                            <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular-nums">{v}</dd></div>
                          ))}
                        </dl>
                      </div>
                    );
                  }} />
                  <Bar yAxisId="vis" dataKey="visitas" name="Visitas" fill="var(--chart-3)" radius={[3, 3, 0, 0]} maxBarSize={36} cursor="pointer">
                    {dados.map((d) => <Cell key={d.i} fillOpacity={d.parcial ? 0.4 : 1} />)}
                  </Bar>
                  <Line yAxisId="preco" dataKey="preco" name="Preço de oferta" stroke="var(--muted-foreground)" strokeWidth={1.25} strokeOpacity={0.6}
                    dot={{ r: 2, fill: 'var(--muted-foreground)', strokeWidth: 0 }} activeDot={{ r: 3.5 }} connectNulls={false} isAnimationActive={false}>
                    <ErrorBar dataKey="bigode" direction="y" width={5} stroke="var(--muted-foreground)" strokeWidth={1} />
                  </Line>
                  <Line yAxisId="upv" dataKey="upv" name="Unidades por visita" stroke="var(--chart-1)" strokeWidth={2}
                    dot={(p) => <PontoRazao key={p.index} cx={p.cx} cy={p.cy} value={p.value as number | null} index={p.index} />}
                    activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              {completos.length === 0 && (
                <p className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-xs text-muted-foreground">
                  Nenhum intervalo com todos os dias coletados: as barras aparecem quando os dias estabilizam.
                </p>
              )}
            </div>

            {/* Régua: mesma faixa da área de plotagem (mesmas larguras de eixo da série de vendas). */}
            <ol className="grid border-t" aria-label="Intervalos do tráfego"
              style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, paddingLeft: MARGEM + EIXO_UNID, paddingRight: MARGEM + EIXO_LUCRO }}>
              {serie.map((p, i) => {
                const s = situacoes[i];
                const doFim = n - 1 - i;
                const visivel = doFim % passoSm === 0 ? '' : doFim % passoLg === 0 ? 'invisible sm:visible' : 'invisible';
                const marca = marcaParcial(p.intervalo);
                const rotulo = `${nomeIntervalo(p, passo)}${marca ? ` ${marca}` : ''}: ${linhas(p, nMlbs, anuncio).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(', ')}`;
                const Icone = s.tipo === 'ok' ? null : ICONE[s.tipo];
                return (
                  <li key={p.intervalo.inicio} className="min-w-0">
                    <button type="button" aria-label={rotulo} title={rotulo} tabIndex={i === focoAtual ? 0 : -1} aria-pressed={i === focoAtual}
                      ref={(el) => { botoes.current[i] = el; }} onFocus={() => setFoco(i)} onKeyDown={moverFoco} onClick={() => setFoco(i)}
                      className={cn('flex w-full flex-col items-center gap-1 rounded-sm px-px pb-1 pt-1.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        i === focoAtual && 'bg-muted/40')}>
                      <span className="flex h-3.5 items-center justify-center" aria-hidden>
                        {Icone && <Icone className={cn('size-3 shrink-0', s.tipo === 'sem_dado' ? 'text-warning' : 'text-muted-foreground')} />}
                      </span>
                      <span className={cn('h-3 whitespace-nowrap text-[11px] leading-3 tabular-nums text-muted-foreground', visivel)} aria-hidden>{p.intervalo.rotulo}</span>
                      <span className={cn('h-2.5 whitespace-nowrap text-[10px] leading-[10px] text-muted-foreground', marca ? visivel : 'invisible')} aria-hidden>{marca ?? ' '}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <DetalheIntervalo p={serie[focoAtual]} passo={passo} nMlbs={nMlbs} anuncio={anuncio} />
      </>
    );
  }

  const cobertura = temGrafico && t.coberturaDesde;

  return (
    <section aria-labelledby="dossie-trafego" className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id="dossie-trafego" className="text-sm font-medium">
            {/* Sem série não há agrupamento a declarar. */}
            {!temGrafico ? 'Tráfego' : passo === 'semana' ? 'Tráfego semanal' : 'Tráfego mensal'}{t.calendario === 'utc' ? ' (dias em UTC)' : ''}
          </h3>
          {alcance && <p className="text-xs text-muted-foreground">{`Visitas e unidades por visita ${alcance}`}</p>}
        </div>
        {temGrafico && (
          <div role="group" aria-label="Agrupar por" className="flex gap-1">
            {(['semana', 'mes'] as const).map((p) => (
              <Button key={p} size="sm" variant={passo === p ? 'default' : 'outline'} className="h-7 px-2.5 text-xs"
                aria-pressed={passo === p} onClick={() => onPasso(p)}>
                {p === 'semana' ? 'Semana' : 'Mês'}
              </Button>
            ))}
          </div>
        )}
      </div>

      {compartilhados.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {compartilhados.map((m) => (
            <StatusPill key={m.mlb} tone="info" title="As visitas são do anúncio inteiro: todas as variações dele entram na métrica.">
              {`anúncio compartilhado · ${m.mlb}`}
            </StatusPill>
          ))}
        </div>
      )}

      {t.motivo && t.alcance !== 'indisponivel' && t.estadoColeta !== 'erro' && t.estadoColeta !== 'carregando' && (
        <Aviso icone={AlertTriangle} tom="warning">
          <p className="font-medium">
            {t.motivo === 'sem_acesso' ? 'Coleta interrompida: sem acesso à conta do Mercado Livre.' : 'Coleta interrompida: falhou na última execução.'}
          </p>
          <p className="text-muted-foreground">
            {t.motivo === 'sem_acesso' ? 'Reconecte a conta do Mercado Livre para a coleta voltar.' : 'A próxima execução tenta de novo.'}
            {temGrafico ? ' Os dados abaixo vão até a última coleta.' : ''}
          </p>
        </Aviso>
      )}
      {t.estadoColeta === 'parcial' && t.alcance !== 'indisponivel' && (
        <Aviso icone={Clock} tom="muted">
          Coleta parcial: a carga inicial de até 150 dias ainda está em andamento, ou algum anúncio ainda não tem dia coletado.
        </Aviso>
      )}

      {corpo}

      {cobertura && (
        <p className="text-xs text-muted-foreground tabular-nums">
          {`Visitas no período desde ${diaMesLiteral(t.coberturaDesde!)}. Dia estável ${H48} depois de encerrado (calendário ${t.calendario === 'utc' ? 'UTC' : 'de São Paulo'}).`}
        </p>
      )}

      {t.porMlb.length > 0 && (
        <div className="border-t pt-3">
          <h4 id="dossie-trafego-mlbs" className="mb-1.5 text-xs font-medium text-muted-foreground">Anúncios · vínculo atual</h4>
          <ul aria-labelledby="dossie-trafego-mlbs" className="flex flex-col divide-y divide-border text-xs">
            {t.porMlb.map((m) => (
              <li key={m.mlb} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
                <span className="font-mono tabular-nums">{m.mlb}</span>
                {m.vinculo === 'exato' && <StatusPill tone="neutral">exclusivo</StatusPill>}
                {/* O compartilhado que entra na métrica já tem o selo no topo: um só lugar para o fato. */}
                {m.vinculo === 'compartilhado' && !comSelo.has(m.mlb) && <StatusPill tone="info">compartilhado</StatusPill>}
                {m.vinculo === 'nao_resolvido' && <StatusPill tone="warning">vínculo não resolvido</StatusPill>}
                <span className={cn('ml-auto', m.considerado ? 'text-foreground' : 'text-muted-foreground')}>
                  {m.considerado ? 'entra na métrica' : 'fora da métrica'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Detalhe do intervalo em foco: o caminho do teclado e do toque (o tooltip é só do mouse, em sm+). */
function DetalheIntervalo({ p, passo, nMlbs, anuncio }: { p: PontoTrafego; passo: Passo; nMlbs: number; anuncio: boolean }) {
  const marca = marcaParcial(p.intervalo);
  return (
    <div data-testid="detalhe-trafego" aria-live="polite" className="rounded-md bg-muted/40 px-3 py-2 text-xs">
      <p className="font-medium">{nomeIntervalo(p, passo)}{marca ? <span className="font-normal text-muted-foreground"> {marca}</span> : null}</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
        {linhas(p, nMlbs, anuncio).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
