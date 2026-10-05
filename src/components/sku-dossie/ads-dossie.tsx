import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, Rectangle, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CircleSlash, Clock, CloudOff, Hourglass, KeyRound, Megaphone, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { diaBRT, type Passo } from '@/lib/calendario-brt';
import type { AdsDossie as DadosAds, GrupoAdsDossie, PontoAds } from '@/lib/sku-ads';
import { Fato } from './cabecalho-dossie';
import { Aviso } from './trafego-dossie';
import { EIXO, EIXO_LUCRO, MARGEM, MIN_POR_INTERVALO, TOOLTIP, escalaRedonda, kCompacto, marcaParcial, passosRotulo } from './serie-pontos';
import { HINT_CUSTO, asHoraDeBRT, dataBRT, diaMesLiteral, pctBR } from './formato-dossie';

const TIPO: Record<GrupoAdsDossie['tipo'], string> = { ITEM: 'Anúncio', FAMILY: 'Família (UP)', CATALOG: 'Catálogo' };
const STATUS: Record<string, string> = { active: 'ativo', paused: 'pausado', idle: 'parado', hold: 'retido', empty: 'vazio', desconhecido: 'status desconhecido' };
const fmtRoas = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×`;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
// Despesa = saída (tom quente); vendas atribuídas = a linha de sempre (chart-1, como a razão do tráfego).
const COR_DESPESA = 'var(--chart-5)';
const COR_VENDAS = 'var(--chart-1)';
// Dia: coluna de 24 px, o alvo de toque mínimo (WCAG 2.5.8); Semana/Mês seguem a largura do dossiê.
const MIN_POR_DIA = 24;
const ALTURA = 'h-60 sm:h-64';
const MARGEM_GRAFICO = { top: 16, bottom: 0 };
/** Marca do lucro com custo incompleto: "parcial" / "estimado" (real não leva marca). */
const marcaLucro = (f: DadosAds['fonteLucro']) => (f === 'parcial' || f === 'estimado' ? `custo ${f}` : null);

type Vista = 'carregando' | 'sem_mlb' | 'erro' | 'sem_coleta' | 'sem_permissao' | 'sem_advertiser' | 'sem_acesso' | 'parcial' | 'dados';
/** Alcance antes do estado: alvo sem MLB chega como `ok` + `indisponivel` + totais null e não é "sem Ads". */
function vistaAds(a: DadosAds | null): Vista {
  if (!a || a.estado === 'carregando') return 'carregando';
  if (a.alcance === 'indisponivel' && a.estado === 'ok') return 'sem_mlb';
  if (a.estado === 'erro' || a.estado === 'sem_coleta' || a.estado === 'sem_permissao' || a.estado === 'sem_advertiser' || a.estado === 'sem_acesso') return a.estado;
  // Carga inicial em curso: nenhum número de despesa (totais null por contrato).
  if (a.estado === 'parcial' || !a.totais) return 'parcial';
  return 'dados';
}

/** "ontem", ou dd/mm quando o período termina antes (coleta do dia ainda não rodou). */
const ateRotulo = (a: DadosAds) =>
  a.fimDia && a.fimDia !== diaBRT(Date.now() - 86_400_000) ? diaMesLiteral(a.fimDia) : 'ontem';

function textoAlcance(a: DadosAds, familia: boolean): string {
  if (a.alcance === 'sku') return 'Gasto dos grupos exclusivos deste SKU';
  if (a.alcance === 'familia') return 'Gasto dos grupos exclusivos da família (cada grupo contado uma vez)';
  if (a.alcance === 'anuncio') return `Gasto dos grupos compartilhados: não é só ${familia ? 'desta família' : 'deste SKU'}`;
  return '';
}

function textoSemLucro(a: DadosAds): string {
  if (a.motivoSemLucro === 'compartilhado') {
    const { codigos, semVinculo } = a.compartilhadoCom;
    const partes = [
      codigos.length ? plural(codigos.length, 'código de fora', 'códigos de fora') : '',
      semVinculo ? plural(semVinculo, 'anúncio sem vínculo', 'anúncios sem vínculo') : '',
    ].filter(Boolean);
    return `indisponível: gasto compartilhado com ${partes.join(' e ')}`;
  }
  if (a.motivoSemLucro === 'historico') {
    return `indisponível: período antes do histórico de vendas${a.historicoDesde ? ` (desde ${dataBRT(a.historicoDesde)})` : ''}`;
  }
  if (a.motivoSemLucro === 'sem_lucro') return 'indisponível: lucro do período sem custo cadastrado';
  if (a.motivoSemLucro === 'cobertura') return 'indisponível: a coleta de Ads não cobre o período inteiro';
  return '';
}

const SEM_NAO_IDENTIFICADO: Record<Exclude<DadosAds['naoIdentificadoMotivo'], null>, string> = {
  periodo_longo: 'aviso indisponível para períodos acima de 1 ano',
  incompleto: 'aviso indisponível: a série da conta não cobre o período inteiro',
  divergente: 'aviso indisponível: os grupos somam mais que a conta no período',
  erro: 'aviso indisponível: falha ao ler o resumo da conta',
};
/** Aviso sob o Lucro após Ads: % do gasto da conta sem família identificada (acima de 0,5%) ou por que não há %. */
function textoNaoIdentificado(a: DadosAds): string | null {
  if (a.naoIdentificadoPct != null) {
    return a.naoIdentificadoPct > 0.005
      ? `${pctBR(a.naoIdentificadoPct)} do gasto de Ads da conta neste período não tem família identificada.`
      : null;
  }
  return a.naoIdentificadoMotivo ? `Gasto de Ads sem família identificada: ${SEM_NAO_IDENTIFICADO[a.naoIdentificadoMotivo]}.` : null;
}

/** As mesmas linhas no tooltip, no detalhe e no rótulo do botão da régua. Zero medido ≠ sem dado. */
function linhas(p: PontoAds): Array<[string, string]> {
  if (p.custo == null) {
    return [['Despesa de Ads', 'sem dado'], ['Vendas atribuídas', 'sem dado'], ['ROAS', 'não medido'], ['Atribuição', 'sem dado']];
  }
  const vendas = p.vendas ?? 0;
  return [
    ['Despesa de Ads', fmtBRL(p.custo)],
    ['Vendas atribuídas', fmtBRL(vendas)],
    ['ROAS', p.custo > 0 ? fmtRoas(vendas / p.custo) : 'sem gasto'],
    ['Atribuição', p.aberto ? 'em aberto (provisória)' : 'fechada'],
  ];
}

type Situacao = 'ok' | 'aberto' | 'sem_dado';
const situacao = (p: PontoAds): Situacao => (p.custo == null ? 'sem_dado' : p.aberto ? 'aberto' : 'ok');

/** Barra da despesa: sólida, hachurada se a atribuição está em aberto; zero medido vira um traço na base
 *  (lê como "medido, nada gasto"), diferente da faixa tracejada de "sem dado". */
function BarraDespesa(props: { x?: number; y?: number; width?: number; height?: number; payload?: { custo: number | null; aberto: boolean; parcial: boolean }; hachura: string }) {
  const { x = 0, y = 0, width = 0, height = 0, payload, hachura } = props;
  if (!payload || payload.custo == null) return <g />;
  if (payload.custo === 0) return <rect x={x} y={y - 1} width={width} height={2} rx={1} fill={COR_DESPESA} fillOpacity={0.7} />;
  return (
    <Rectangle x={x} y={y} width={width} height={height} radius={[3, 3, 0, 0]}
      fill={payload.aberto ? `url(#${hachura})` : COR_DESPESA} fillOpacity={payload.parcial ? 0.55 : 1}
      stroke={payload.aberto ? COR_DESPESA : undefined} strokeWidth={payload.aberto ? 1 : 0} />
  );
}

/** Ponto das vendas: 0 medido é um anel na base, lacuna fica sem ponto (mesmo idioma do tráfego). */
function PontoVendas({ cx, cy, value, index }: { cx?: number; cy?: number; value?: number | null; index?: number }) {
  if (cx == null || cy == null || value == null) return <g key={index} />;
  return value === 0
    ? <circle key={index} cx={cx} cy={cy} r={2.75} fill="var(--card)" stroke={COR_VENDAS} strokeWidth={1.5} />
    : <circle key={index} cx={cx} cy={cy} r={2.5} fill={COR_VENDAS} />;
}

interface Props {
  ads: DadosAds | null;
  familia: boolean;
  passo: Passo;
  onPasso: (p: Passo) => void;
  onTentar: () => void;
}

/** Ads do período (Fatia 2c): gasto e vendas atribuídas por grupo de anúncios, no alcance comprovado.
 *  Só lê: nada daqui muda o lucro do ranking, do Financeiro ou da aba Vendas. Hoje nunca entra (até ontem). */
export function PainelAds({ ads: a, familia, passo, onPasso, onTentar }: Props) {
  const hachura = `ads-aberto-${useId().replace(/:/g, '')}`;
  const vista = vistaAds(a);
  const temDados = vista === 'dados';
  // sem_ads: sem série a mostrar (aviso, KPIs zerados e grupos bastam).
  const comSerie = temDados && a!.estado !== 'sem_ads';
  // "Dia" é local da aba (o Passo do dossiê só tem Semana/Mês); Semana/Mês seguem o seletor do dossiê.
  const [diario, setDiario] = useState(false);
  const serie = useMemo(() => (comSerie ? (diario ? a!.serieDiaria : a!.serie) : []), [comSerie, diario, a]);
  const n = serie.length;
  // Entrada no último intervalo completo; a escolha vale para a série em que foi feita (Dia/Semana/Mês, período).
  const inicial = n > 1 && serie[n - 1].intervalo.incompleto ? n - 2 : n - 1;
  const [escolha, setEscolha] = useState<{ serie: PontoAds[]; i: number } | null>(null);
  const setFoco = (i: number) => setEscolha({ serie, i });
  const focoAtual = Math.min(Math.max(escolha?.serie === serie ? escolha.i : inicial, 0), n - 1);
  const botoes = useRef<(HTMLButtonElement | null)[]>([]);
  // Série mais larga que o cartão (Dia no celular): abre rolada até o fim, onde estão o foco e os dias recentes.
  const rolagem = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = rolagem.current; if (el) el.scrollLeft = el.scrollWidth; }, [serie]);

  const dados = useMemo(() => serie.map((p, i) => ({
    i, rotulo: p.intervalo.rotulo, custo: p.custo, vendas: p.vendas, aberto: p.aberto, parcial: p.intervalo.incompleto,
  })), [serie]);
  const situacoes = useMemo(() => serie.map(situacao), [serie]);
  const tem = (s: Situacao) => situacoes.includes(s);
  const temZero = serie.some((p) => p.custo === 0);
  const { passoSm, passoLg } = passosRotulo(n);
  // Mesmo domínio e ticks redondos nos dois gráficos: o do eixo (fixo) e o que rola.
  const escala = useMemo(() => escalaRedonda(Math.max(0, ...serie.flatMap((p) => [p.custo ?? 0, p.vendas ?? 0]))), [serie]);
  const minCol = diario ? MIN_POR_DIA : MIN_POR_INTERVALO;
  const nomeIntervalo = (p: PontoAds) => `${!diario && passo === 'semana' ? 'Semana de ' : ''}${p.intervalo.rotulo}`;

  const moverFoco = (e: KeyboardEvent<HTMLButtonElement>) => {
    const alvo = { ArrowLeft: focoAtual - 1, ArrowRight: focoAtual + 1, Home: 0, End: n - 1 }[e.key];
    if (alvo == null) return;
    e.preventDefault();
    const i = Math.min(Math.max(alvo, 0), n - 1);
    setFoco(i);
    botoes.current[i]?.focus();
  };

  let corpo: ReactNode = null;
  if (vista === 'carregando') {
    corpo = (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">Carregando os Ads</span>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="space-y-1.5 bg-card px-3 py-2.5"><Skeleton className="h-3 w-24 bg-foreground/10" /><Skeleton className="h-4 w-20 bg-foreground/10" /></div>
          ))}
        </div>
        <Skeleton className="h-60 w-full bg-foreground/10 sm:h-64" />
      </div>
    );
  } else if (vista === 'sem_mlb') {
    corpo = (
      <Aviso icone={Unlink} tom="muted">
        {`Nenhum anúncio do Mercado Livre vinculado a ${familia ? 'esta família' : 'este código'} no mapa atual: não há gasto de Ads para atribuir.`}
      </Aviso>
    );
  } else if (vista === 'erro') {
    corpo = (
      <Aviso icone={CloudOff} tom="warning">
        <p><span className="font-medium">Não foi possível ler os Ads.</span>{' '}
          <span className="text-muted-foreground">O resto do dossiê não depende deles.</span></p>
        <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={onTentar}>Tentar de novo</Button>
      </Aviso>
    );
  } else if (vista === 'sem_coleta') {
    corpo = <Aviso icone={Clock} tom="muted">A coleta de Ads começa após a ativação. Os valores aparecem aqui a partir do dia seguinte.</Aviso>;
  } else if (vista === 'sem_permissao') {
    corpo = (
      <Aviso icone={KeyRound} tom="warning">
        <p className="font-medium">O Mercado Livre recusou a leitura de Publicidade: sem permissão de Publicidade ou conexão recusada.</p>
        <p className="text-muted-foreground">Reconecte a conta em Canais; se continuar, confira a permissão &ldquo;Publicidade&rdquo; do aplicativo.</p>
      </Aviso>
    );
  } else if (vista === 'sem_advertiser') {
    corpo = (
      <Aviso icone={Megaphone} tom="muted">
        Esta conta não tem anunciante de Product Ads no Mercado Livre. Quem ativa é o vendedor, em Meu perfil → Publicidade.
      </Aviso>
    );
  } else if (vista === 'sem_acesso') {
    corpo = <Aviso icone={CloudOff} tom="warning">A conexão com o Mercado Livre foi recusada. Reconecte a conta em Canais.</Aviso>;
  } else if (vista === 'parcial') {
    corpo = (
      <>
        <Aviso icone={Clock} tom="muted">
          Carga inicial dos últimos 90 dias em curso. A despesa e as vendas atribuídas aparecem quando ela fechar; até lá, nenhum número parcial.
        </Aviso>
        <Grupos grupos={a!.grupos} fora={a!.compartilhadoCom.codigos} />
      </>
    );
  } else if (a && a.totais) {
    const t = a.totais;
    const resumo = [
      `${textoAlcance(a, familia)}.`,
      `Despesa de Ads do período ${fmtBRL(t.custo)}, vendas atribuídas ${fmtBRL(t.vendasTotais)}.`,
      t.roas != null ? `ROAS ${fmtRoas(t.roas)}.` : '',
      a.lucroAposAds != null
        ? `Lucro após Ads ${fmtBRL(a.lucroAposAds)}${marcaLucro(a.fonteLucro) ? `, ${marcaLucro(a.fonteLucro)}` : ''}.`
        : `Lucro após Ads ${textoSemLucro(a)}.`,
      a.lucroAposAds != null ? textoNaoIdentificado(a) ?? '' : '',
      a.diasAbertos && a.estado !== 'sem_ads' ? `${plural(a.diasAbertos, 'dia', 'dias')} com atribuição em aberto.` : '',
      n ? `Série ${diario ? 'diária' : passo === 'semana' ? 'semanal' : 'mensal'} de ${serie[0].intervalo.rotulo} a ${serie[n - 1].intervalo.rotulo}.` : '',
      n ? 'Os botões de cada intervalo mostram o detalhe; as setas andam entre eles.' : '',
    ].filter(Boolean).join(' ');
    corpo = (
      <>
        {a.estado === 'desatualizado' && a.ultimoOkEm && (
          <Aviso icone={Clock} tom="warning">{`Última coleta ok ${asHoraDeBRT(a.ultimoOkEm)}: os dias depois disso estão sem dado.`}</Aviso>
        )}
        {a.estado === 'sem_ads' && (
          <Aviso icone={Megaphone} tom="muted">
            {`Nenhum gasto de Ads nos anúncios vinculados a ${familia ? 'esta família' : 'este SKU'} no período (vínculo atual${a.coberturaDesde ? `, coleta desde ${diaMesLiteral(a.coberturaDesde)}` : ''}).`}
          </Aviso>
        )}

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
          <Fato rotulo="Despesa de Ads do período">{fmtBRL(t.custo)}</Fato>
          <Fato rotulo={`Vendas atribuídas${a.diasAbertos && a.estado !== 'sem_ads' ? ` · ${plural(a.diasAbertos, 'dia', 'dias')} com atribuição em aberto` : ''}`}>
            {fmtBRL(t.vendasTotais)} <span className="font-normal text-muted-foreground">{`${fmtInt(t.unidades)} un.`}</span>
          </Fato>
          <Fato rotulo="Lucro após Ads" fraco={a.lucroAposAds == null}>
            {a.lucroAposAds != null
              ? <>
                <span className={cn(a.lucroAposAds < 0 && 'text-danger')}>{fmtBRL(a.lucroAposAds)}</span>
                {/* Linha própria: o Fato trunca, e a marca não pode sumir no celular. */}
                {marcaLucro(a.fonteLucro) && <span className="block text-xs font-normal text-muted-foreground">{`· ${marcaLucro(a.fonteLucro)}`}</span>}
              </>
              : 'indisponível'}
          </Fato>
          <Fato rotulo="ROAS" fraco={t.roas == null}>{t.roas != null ? fmtRoas(t.roas) : 'sem gasto'}</Fato>
          <Fato rotulo="ACOS" fraco={t.acos == null}>{t.acos != null ? pctBR(t.acos) : 'sem venda atribuída'}</Fato>
          <Fato rotulo="CPC" fraco={t.cpc == null}>
            {t.cpc != null ? <>{fmtBRL(t.cpc)} <span className="font-normal text-muted-foreground">{`${fmtInt(t.cliques)} cliques`}</span></> : 'sem clique'}
          </Fato>
        </dl>
        <p className="text-xs text-muted-foreground">
          {a.lucroAposAds != null
            ? `Lucro após Ads = lucro do período até ${ateRotulo(a)}${a.fonteLucro === 'parcial' || a.fonteLucro === 'estimado'
              ? ` (${HINT_CUSTO[a.fonteLucro].charAt(0).toLowerCase()}${HINT_CUSTO[a.fonteLucro].slice(1)})` : ''} − despesa de Ads até ${ateRotulo(a)}. O lucro atual não muda.`
            : `Lucro após Ads ${textoSemLucro(a)}.`}
        </p>
        {a.lucroAposAds != null && textoNaoIdentificado(a) && (
          <p className="text-xs text-muted-foreground">{textoNaoIdentificado(a)}</p>
        )}

        <p className="sr-only">{resumo}</p>
        {comSerie && (
          <>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
              <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-chart-5" />Despesa de Ads</li>
              <li className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded-full bg-chart-1" />Vendas atribuídas</li>
              {tem('aberto') && (
                <li className="flex items-center gap-1.5">
                  <svg width="10" height="10" className="text-chart-5" aria-hidden>
                    <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" fill="currentColor" fillOpacity={0.22} stroke="currentColor" />
                    <path d="M0 7 L7 0 M3 10 L10 3" stroke="currentColor" strokeWidth={1.5} />
                  </svg>
                  Atribuição em aberto
                </li>
              )}
              {temZero && <li className="flex items-center gap-1.5"><span className="h-0.5 w-2.5 rounded-full bg-chart-5/70" />Zero medido</li>}
              {tem('sem_dado') && <li className="flex items-center gap-1.5"><CircleSlash className="size-3" />Sem dado</li>}
            </ul>

            {/* O eixo Y fica fora da rolagem (a série diária rola no celular e o valor não pode sumir). */}
            <div className="flex items-start">
              <div className={cn('shrink-0 [&_*]:outline-none', ALTURA)} style={{ width: EIXO_LUCRO + MARGEM }} aria-hidden>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dados} margin={{ ...MARGEM_GRAFICO, left: MARGEM, right: 0 }} accessibilityLayer={false}>
                    <XAxis dataKey="rotulo" hide />
                    <YAxis width={EIXO_LUCRO} tick={EIXO} stroke="var(--border)" domain={[0, escala.topo]} ticks={escala.ticks}
                      tickFormatter={(v) => kCompacto(Number(v))} />
                    <Line dataKey="vendas" stroke="none" dot={false} activeDot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div ref={rolagem} className="min-w-0 flex-1 overflow-x-auto pr-0.5">
                <div data-testid="ads-plot" style={{ minWidth: n * minCol + MARGEM }}>
                  {/* Toque/clique em qualquer coluna leva o detalhe para ela (faixas iguais na área de plotagem). */}
                  <div className={cn('relative cursor-pointer [&_*]:outline-none', ALTURA)} aria-hidden onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - r.left;
                    const largura = r.width - MARGEM;
                    if (n > 0 && x >= 0 && x < largura) setFoco(Math.floor((x / largura) * n));
                  }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={dados} margin={{ ...MARGEM_GRAFICO, left: 0, right: MARGEM }} accessibilityLayer={false}>
                        <defs>
                          <pattern id={hachura} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                            <rect width="5" height="5" fill={COR_DESPESA} fillOpacity={0.22} />
                            <line x1="0" y1="0" x2="0" y2="5" stroke={COR_DESPESA} strokeWidth={2} />
                          </pattern>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="rotulo" hide />
                        <YAxis hide width={0} domain={[0, escala.topo]} ticks={escala.ticks} />
                        {/* Sem dado: faixa apagada no lugar da barra, nunca uma barra zero. */}
                        {dados.filter((d) => d.custo == null).map((d) => (
                          <ReferenceArea key={d.i} x1={d.rotulo} x2={d.rotulo} fill="var(--muted-foreground)" fillOpacity={0.08}
                            stroke="var(--muted-foreground)" strokeOpacity={0.35} strokeDasharray="3 3" ifOverflow="hidden" />
                        ))}
                        <Tooltip cursor={TOOLTIP.cursor} filterNull={false} content={({ active, payload }) => {
                          const i = (payload?.[0]?.payload as { i?: number } | undefined)?.i;
                          if (!active || i == null) return null;
                          const p = serie[i];
                          // No celular o tooltip não cabe: o toque leva o card de detalhe abaixo do gráfico.
                          return (
                            <div className="hidden min-w-48 rounded-lg border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md sm:block">
                              <p className="mb-1 font-medium">{nomeIntervalo(p)}{marcaParcial(p.intervalo) ? ` ${marcaParcial(p.intervalo)}` : ''}</p>
                              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                                {linhas(p).map(([k, v]) => (
                                  <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular-nums">{v}</dd></div>
                                ))}
                              </dl>
                            </div>
                          );
                        }} />
                        <Bar dataKey="custo" name="Despesa de Ads" maxBarSize={36} isAnimationActive={false}
                          shape={(p: unknown) => <BarraDespesa {...(p as object)} hachura={hachura} />} />
                        <Line dataKey="vendas" name="Vendas atribuídas" stroke={COR_VENDAS} strokeWidth={2}
                          dot={(p) => <PontoVendas key={p.index} cx={p.cx} cy={p.cy} value={p.value as number | null} index={p.index} />}
                          activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Régua: mesma faixa da área de plotagem; o caminho do teclado e do leitor de tela. */}
                  <ol className="grid border-t" aria-label="Intervalos dos Ads"
                    style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, paddingRight: MARGEM }}>
                    {serie.map((p, i) => {
                      const s = situacoes[i];
                      const doFim = n - 1 - i;
                      const visivel = doFim % passoSm === 0 ? '' : doFim % passoLg === 0 ? 'invisible sm:visible' : 'invisible';
                      const marca = marcaParcial(p.intervalo);
                      const rotulo = `${nomeIntervalo(p)}${marca ? ` ${marca}` : ''}: ${linhas(p).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(', ')}`;
                      const Icone = s === 'aberto' ? Hourglass : s === 'sem_dado' ? CircleSlash : null;
                      return (
                        <li key={p.intervalo.inicio} className="min-w-0">
                          <button type="button" aria-label={rotulo} title={rotulo} tabIndex={i === focoAtual ? 0 : -1} aria-pressed={i === focoAtual}
                            ref={(el) => { botoes.current[i] = el; }} onFocus={() => setFoco(i)} onKeyDown={moverFoco} onClick={() => setFoco(i)}
                            className={cn('flex w-full flex-col items-center gap-1 rounded-sm px-px pb-1 pt-1.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              i === focoAtual && 'bg-muted/40')}>
                            <span className="flex h-3.5 items-center justify-center" aria-hidden>
                              {Icone && <Icone className="size-3 shrink-0 text-muted-foreground" />}
                            </span>
                            <span className={cn('h-3 whitespace-nowrap text-[11px] leading-3 tabular-nums text-muted-foreground', visivel)} aria-hidden>{p.intervalo.rotulo}</span>
                            {/* Sem eixo à esquerda da rolagem: no celular a marca das pontas encosta na borda, senão é cortada. */}
                            <span className={cn('h-2.5 whitespace-nowrap text-[10px] leading-[10px] text-muted-foreground', marca ? visivel : 'invisible',
                              i === 0 && 'max-sm:self-start', i === n - 1 && n > 1 && 'max-sm:self-end')} aria-hidden>{marca ?? ' '}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            </div>

            {n > 0 && <Detalhe p={serie[focoAtual]} nome={nomeIntervalo(serie[focoAtual])} />}

            <p className="text-xs text-muted-foreground tabular-nums">
              {`Até ${ateRotulo(a)}, no calendário de São Paulo (o dia de hoje não entra${ateRotulo(a) === 'ontem' ? '' : '; ontem entra depois da coleta diária'}). Vendas atribuídas pelo Mercado Livre em até 14 dias depois do clique: dia com menos de 15 dias é provisório.${a.coberturaDesde ? ` Coleta de Ads desde ${diaMesLiteral(a.coberturaDesde)}.` : ''}`}
            </p>
          </>
        )}

        <Grupos grupos={a.grupos} fora={a.compartilhadoCom.codigos} />
      </>
    );
  }

  return (
    <section aria-labelledby="dossie-ads" className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id="dossie-ads" className="text-sm font-medium">{!comSerie ? 'Ads' : diario ? 'Ads por dia' : passo === 'semana' ? 'Ads por semana' : 'Ads por mês'}</h3>
          {(temDados || vista === 'parcial') && a && <p className="text-xs text-muted-foreground">{textoAlcance(a, familia)}</p>}
        </div>
        {comSerie && (
          <div role="group" aria-label="Agrupar por" className="flex gap-1">
            <Button size="sm" variant={diario ? 'default' : 'outline'} className="h-7 px-2.5 text-xs"
              aria-pressed={diario} onClick={() => setDiario(true)}>Dia</Button>
            {(['semana', 'mes'] as const).map((p) => (
              <Button key={p} size="sm" variant={!diario && passo === p ? 'default' : 'outline'} className="h-7 px-2.5 text-xs"
                aria-pressed={!diario && passo === p} onClick={() => { setDiario(false); onPasso(p); }}>
                {p === 'semana' ? 'Semana' : 'Mês'}
              </Button>
            ))}
          </div>
        )}
      </div>
      {corpo}
    </section>
  );
}

/** Detalhe do intervalo em foco: o caminho do teclado e do toque (o tooltip é só do mouse, em sm+). */
function Detalhe({ p, nome }: { p: PontoAds; nome: string }) {
  const marca = marcaParcial(p.intervalo);
  return (
    <div data-testid="detalhe-ads" aria-live="polite" className="rounded-md bg-muted/40 px-3 py-2 text-xs">
      <p className="font-medium">{nome}{marca ? <span className="font-normal text-muted-foreground"> {marca}</span> : null}</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
        {linhas(p).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={cn('tabular-nums', (v === 'sem dado' || v === 'não medido') && 'text-muted-foreground')}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const MAX_GRUPOS = 8;
/** Mesma conta do motivo do Lucro após Ads: quantos códigos de fora (e anúncios sem vínculo) dividem o grupo. */
function textoCompartilhado(deFora: number, semVinculo: number): string {
  const partes = [
    deFora ? `+${plural(deFora, 'código de fora', 'códigos de fora')}` : '',
    semVinculo ? `${deFora ? '+ ' : '+'}${plural(semVinculo, 'sem vínculo', 'sem vínculo')}` : '',
  ].filter(Boolean);
  return `compartilhado · ${partes.join(' ')}`;
}
/** Grupos do alcance, pelo vínculo atual. Na carga parcial a despesa do grupo não aparece. */
function Grupos({ grupos, fora }: { grupos: GrupoAdsDossie[]; fora: string[] }) {
  const deFora = new Set(fora);
  if (!grupos.length) return null;
  return (
    <div className="border-t pt-3">
      <h4 id="dossie-ads-grupos" className="mb-1.5 text-xs font-medium text-muted-foreground">Grupos de anúncios · vínculo atual</h4>
      <ul aria-labelledby="dossie-ads-grupos" className="flex flex-col divide-y divide-border text-xs">
        {grupos.slice(0, MAX_GRUPOS).map((g) => (
          <li key={g.id} className="flex items-start gap-3 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{TIPO[g.tipo]}</span>
                <span className="text-muted-foreground">{`${STATUS[g.status.toLowerCase()] ?? g.status.toLowerCase()}${g.campanhaId === 0 ? ' · fora de campanha' : ''}`}</span>
                <StatusPill tone={g.exclusivo ? 'neutral' : 'info'}>
                  {g.exclusivo ? 'exclusivo' : textoCompartilhado(g.codigos.filter((c) => deFora.has(c)).length, g.semVinculo)}
                </StatusPill>
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground tabular-nums" title={g.mlbs.join(', ')}>{`grupo ${g.id} · ${g.mlbs.join(', ')}`}</p>
            </div>
            <span className={cn('shrink-0 pt-px text-right tabular-nums', g.custo == null ? 'text-muted-foreground' : 'font-medium')}>
              {g.custo == null ? 'em carga' : fmtBRL(g.custo)}
            </span>
          </li>
        ))}
      </ul>
      {grupos.length > MAX_GRUPOS && <p className="mt-1 text-xs text-muted-foreground">{`e mais ${plural(grupos.length - MAX_GRUPOS, 'grupo', 'grupos')}`}</p>}
    </div>
  );
}
