import { useId, useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ATIVO_ESCURO } from '@/components/ads/tela-ads';
import { fmtBRL, fmtInt } from '@/lib/formato';
import { MOTIVOS_METRICA_ADS } from '@/lib/ads-metricas';
import { EIXO, TOOLTIP, kCompacto } from '@/components/sku-dossie/serie-pontos';
import type { DiaAdsMetricas, JanelaAdsMetricas, MetricaBrutaAds, MotivoMetricaAds } from '../../../supabase/functions/_shared/ads/metricas';

type Visao = 'vendas' | 'valores';
type ChaveValor = 'cost' | 'receita';

export interface PontoDiario {
  dia: string;
  rotulo: string;
  atribuidas: number | null;
  outras: number | null;
  cost: number | null;
  receita: number | null;
  roas: number | null;
  provisorio: boolean;
  /** Por que um valor é `null`: motivo do ML, ou `dia_ausente` quando o dia nem veio na série. */
  motivos: Partial<Record<CampoTabela, MotivoDia>>;
}
type CampoTabela = 'atribuidas' | 'outras' | 'cost' | 'receita' | 'roas';
type MotivoDia = MotivoMetricaAds | 'dia_ausente';

// Textos de formato-ads; ROAS do dia e dia ausente têm texto próprio do gráfico.
const MOTIVOS: Record<MotivoDia, string> = {
  ...MOTIVOS_METRICA_ADS,
  sem_denominador: 'Sem investimento no dia: ROAS indefinido.',
  dia_ausente: 'Sem retorno do ML neste dia.',
};

const DIA_MS = 86_400_000;
const rotuloDia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtRoas = (v: number) => `${v.toFixed(1).replace('.', ',')}×`;

/** Um ponto por dia da janela. Dia ou métrica ausente é `null` (lacuna), nunca zero; o ROAS do dia
 *  é receita ÷ investimento do mesmo dia, e investimento 0 também é lacuna. */
export function pontosDiarios(serie: DiaAdsMetricas[], janela: JanelaAdsMetricas, provisorioDesde?: string): PontoDiario[] {
  const porDia = new Map(serie.map((d) => [d.dia, d.metricas]));
  const out: PontoDiario[] = [];
  for (let t = Date.parse(`${janela.desde}T00:00:00Z`); t <= Date.parse(`${janela.ate}T00:00:00Z`); t += DIA_MS) {
    const dia = new Date(t).toISOString().slice(0, 10);
    const m = porDia.get(dia);
    const v = (k: MetricaBrutaAds) => m?.[k]?.valor ?? null;
    const mot = (k: MetricaBrutaAds): MotivoDia | undefined => (v(k) !== null ? undefined : !m ? 'dia_ausente' : (m[k]?.motivo ?? 'nao_retornada'));
    const cost = v('cost');
    const receita = v('total_amount');
    const semRoas = !(cost !== null && cost > 0 && receita !== null);
    const motivoRoas: MotivoDia | undefined = !semRoas ? undefined : mot('cost') ?? mot('total_amount') ?? 'sem_denominador';
    out.push({
      dia, rotulo: rotuloDia(dia),
      atribuidas: v('advertising_items_quantity'), outras: v('organic_items_quantity'), cost, receita,
      roas: cost !== null && cost > 0 && receita !== null ? receita / cost : null,
      provisorio: provisorioDesde !== undefined && dia >= provisorioDesde,
      motivos: { atribuidas: mot('advertising_items_quantity'), outras: mot('organic_items_quantity'), cost: mot('cost'), receita: mot('total_amount'), roas: motivoRoas },
    });
  }
  return out;
}

const SERIES_VALORES: { chave: ChaveValor; nome: string }[] = [
  { chave: 'cost', nome: 'Investimento' },
  { chave: 'receita', nome: 'Receita Ads' },
];
const INK = 'var(--foreground)';
// "Outras vendas": o --chart-3 do tema claro dá 2,4:1 sobre o card (mínimo 3:1 para elemento gráfico, QA 2026-10-31).
// Misturar 25% do texto principal leva a >= 3:1 no claro e mantém o escuro (o foreground claro só clareia).
const COR_OUTRAS = 'color-mix(in oklch, var(--chart-3), var(--foreground) 25%)';

interface Props {
  serie: DiaAdsMetricas[];
  janela: JanelaAdsMetricas;
  /** Primeiro dia com atribuição ainda em aberto (os últimos dias da janela). */
  provisorioDesde?: string;
  visaoInicial?: Visao;
  /** `completo` do bloco; `false` mostra o aviso de dados incompletos. */
  completo?: boolean;
}

/** Texto do valor no tooltip: quantidades aqui são vendas (itens), não unidades. */
export function textoValor(visao: Visao, nome: string, v: number): string {
  if (nome === 'ROAS') return fmtRoas(v);
  if (visao === 'valores') return fmtBRL(v);
  return `${fmtInt(v)} ${v === 1 ? 'venda' : 'vendas'}`;
}

function Celula({ texto, motivo }: { texto: string | null; motivo?: MotivoDia }) {
  if (texto !== null) return <td className="px-2 py-1 text-right">{texto}</td>;
  return (
    <td className="px-2 py-1 text-right" title={motivo ? MOTIVOS[motivo] : undefined}>
      <span aria-hidden>—</span><span className="sr-only">{motivo ? MOTIVOS[motivo] : 'Sem valor'}</span>
    </td>
  );
}

/** Evolução diária do Mercado Ads. Padrão: barras empilhadas de vendas atribuídas e outras vendas, e
 *  ROAS do dia em linha no eixo da direita (×). Alternativa: Investimento × Receita Ads em R$, mesmo eixo. */
export function SerieDiaria({ serie, janela, provisorioDesde, visaoInicial = 'vendas', completo }: Props) {
  const [visao, setVisao] = useState<Visao>(visaoInicial);
  // No celular a visão em R$ começa com uma série; a segunda é opcional. Limite: de 1 a 2 séries.
  const [ligadas, setLigadas] = useState<ChaveValor[]>(() => (
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches ? ['cost'] : ['cost', 'receita']
  ));
  const [tabela, setTabela] = useState(false);
  const idPadrao = `hachura-${useId().replace(/:/g, '')}`;

  const dados = useMemo(() => pontosDiarios(serie, janela, provisorioDesde), [serie, janela, provisorioDesde]);
  const temDado = serie.length > 0;
  // Motivos distintos do que falta (sem repetir por dia), para o aviso do bloco incompleto.
  const motivosFaltantes = useMemo(() => [...new Set(dados.flatMap((d) => Object.values(d.motivos)).filter((m): m is MotivoDia => !!m && m !== 'sem_denominador'))], [dados]);
  const prov = dados.filter((d) => d.provisorio);
  const alternar = (c: ChaveValor) => setLigadas((l) => (l.includes(c) ? (l.length > 1 ? l.filter((x) => x !== c) : l) : [...l, c].slice(-2)));
  const nomeValor = (c: ChaveValor) => SERIES_VALORES.find((s) => s.chave === c)!.nome;

  return (
    <section aria-labelledby={`${idPadrao}-t`} className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id={`${idPadrao}-t`} className="text-sm font-medium">Evolução diária</h3>
        <div role="group" aria-label="Visão do gráfico" className="flex flex-wrap gap-1">
          {([['vendas', 'Vendas atribuídas × Outras vendas + ROAS'], ['valores', 'Investimento × Receita Ads']] as const).map(([v, nome]) => (
            <Button key={v} size="sm" variant={visao === v ? 'default' : 'outline'} className={cn('h-auto min-h-7 whitespace-normal px-2.5 py-1 text-left text-xs max-sm:min-h-11 pointer-coarse:min-h-11', visao === v && ATIVO_ESCURO)}
              aria-pressed={visao === v} onClick={() => setVisao(v)}>{nome}</Button>
          ))}
        </div>
      </div>

      {visao === 'valores' && (
        <div role="group" aria-label="Séries visíveis" className="flex gap-1">
          {SERIES_VALORES.map((s) => (
            <Button key={s.chave} size="sm" variant={ligadas.includes(s.chave) ? 'secondary' : 'outline'} className="h-7 px-2.5 text-xs max-sm:min-h-11 pointer-coarse:min-h-11"
              aria-pressed={ligadas.includes(s.chave)} onClick={() => alternar(s.chave)}>{s.nome}</Button>
          ))}
        </div>
      )}

      {completo === false && (
        <div role="status" className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Dados incompletos: o período não veio inteiro do Mercado Livre.</p>
          <ul className="list-disc pl-4">{motivosFaltantes.map((m) => <li key={m}>{MOTIVOS[m]}</li>)}</ul>
        </div>
      )}

      <ul aria-label="Legenda" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {visao === 'vendas' ? (
          <>
            <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-chart-1" />Vendas atribuídas</li>
            <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ backgroundColor: COR_OUTRAS }} />Outras vendas</li>
            <li className="flex items-center gap-1.5"><LinhaLegenda />ROAS (eixo à direita, em ×)</li>
          </>
        ) : (
          <>
            {ligadas.includes('cost') && <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-chart-1" />Investimento</li>}
            {ligadas.includes('receita') && <li className="flex items-center gap-1.5"><LinhaLegenda />Receita Ads</li>}
          </>
        )}
        {prov.length > 0 && (
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] border border-muted-foreground" style={{ backgroundImage: 'repeating-linear-gradient(45deg, var(--muted-foreground) 0 1px, transparent 1px 4px)' }} />
            Atribuição em aberto
          </li>
        )}
      </ul>

      {/* Altura reservada: o cartão não muda de tamanho entre carregando, vazio e com dados. */}
      <div className="relative h-60 sm:h-64">
        {temDado ? (
          <div aria-hidden className="h-full">
            <svg width="0" height="0" className="absolute">
              <defs>
                <pattern id={idPadrao} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="var(--muted-foreground)" strokeWidth="1.5" strokeOpacity="0.55" />
                </pattern>
              </defs>
            </svg>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dados} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid yAxisId="esq" strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="rotulo" tick={EIXO} stroke="var(--border)" tickLine={false} minTickGap={16} />
                {visao === 'vendas' ? (
                  <>
                    <YAxis yAxisId="esq" width={36} tick={EIXO} stroke="var(--border)" allowDecimals={false} tickFormatter={(v) => fmtInt(Number(v))} />
                    <YAxis yAxisId="dir" orientation="right" width={40} tick={EIXO} stroke="var(--border)" domain={[0, 'auto']} tickFormatter={(v) => fmtRoas(Number(v))} />
                  </>
                ) : (
                  <YAxis yAxisId="esq" width={44} tick={EIXO} stroke="var(--border)" tickFormatter={(v) => `R$ ${kCompacto(Number(v))}`} />
                )}
                {prov.length > 0 && (
                  <ReferenceArea yAxisId="esq" x1={prov[0].rotulo} x2={prov[prov.length - 1].rotulo} fill={`url(#${idPadrao})`} stroke="none" ifOverflow="extendDomain" />
                )}
                <Tooltip {...TOOLTIP}
                  labelFormatter={(_, p) => {
                    const d = p?.[0]?.payload as PontoDiario | undefined;
                    return d ? `${d.rotulo}${d.provisorio ? ' (atribuição em aberto)' : ''}` : '';
                  }}
                  formatter={(v, nome) => [textoValor(visao, String(nome), Number(v)), nome]} />
                {visao === 'vendas' ? (
                  <>
                    {/* Segmentos separados por 2px da cor do cartão; só o topo da pilha tem cantos arredondados. */}
                    <Bar yAxisId="esq" dataKey="atribuidas" name="Vendas atribuídas" stackId="v" fill="var(--chart-1)" stroke="var(--card)" strokeWidth={1} maxBarSize={28} isAnimationActive={false} />
                    <Bar yAxisId="esq" dataKey="outras" name="Outras vendas" stackId="v" fill={COR_OUTRAS} stroke="var(--card)" strokeWidth={1} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                    {/* Linear, sem suavização; dia sem ROAS é lacuna (connectNulls=false). */}
                    <Line yAxisId="dir" dataKey="roas" name="ROAS" type="linear" stroke={INK} strokeWidth={2}
                      dot={{ r: 3, fill: INK, stroke: 'var(--card)', strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
                  </>
                ) : (
                  <>
                    {ligadas.includes('cost') && <Bar yAxisId="esq" dataKey="cost" name="Investimento" fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />}
                    {ligadas.includes('receita') && (
                      <Line yAxisId="esq" dataKey="receita" name="Receita Ads" type="linear" stroke={INK} strokeWidth={2}
                        dot={{ r: 3, fill: INK, stroke: 'var(--card)', strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
                    )}
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="grid h-full place-items-center text-xs text-muted-foreground">Nenhum dia com dados de Ads neste período.</p>
        )}
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {visao === 'vendas' && (
          <p>
            “Outras vendas” é o universo dos anúncios promovidos segundo o Mercado Livre (vendas deles sem atribuição a Ads),
            não as vendas orgânicas da conta inteira. ROAS do dia = receita de Ads ÷ investimento do dia; sem investimento, sem ponto.
          </p>
        )}
        {prov.length > 0 && (
          <p>Faixa hachurada: atribuição ainda em aberto ({prov.length} {prov.length === 1 ? 'dia' : 'dias'}). Os valores desses dias podem mudar.</p>
        )}
        <p>Dia sem retorno do Mercado Livre aparece como lacuna, nunca como zero.</p>
      </div>

      {temDado && (
        <>
          <Button size="sm" variant="outline" className="h-7 self-start px-2.5 text-xs max-sm:min-h-11 pointer-coarse:min-h-11" aria-expanded={tabela} onClick={() => setTabela(!tabela)}>
            {tabela ? 'Ocultar tabela' : 'Ver dados em tabela'}
          </Button>
          {tabela && (
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-xs tabular-nums">
                <caption className="sr-only">Evolução diária do Mercado Ads, um dia por linha.</caption>
                <thead className="sticky top-0 bg-card text-left text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 font-medium">Dia</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">Vendas atribuídas</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">Outras vendas</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">{nomeValor('cost')}</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">{nomeValor('receita')}</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.map((d) => (
                    <tr key={d.dia} className="border-t">
                      <th scope="row" className="px-2 py-1 text-left font-normal">{d.rotulo}{d.provisorio ? ' (em aberto)' : ''}</th>
                      <Celula texto={d.atribuidas === null ? null : fmtInt(d.atribuidas)} motivo={d.motivos.atribuidas} />
                      <Celula texto={d.outras === null ? null : fmtInt(d.outras)} motivo={d.motivos.outras} />
                      <Celula texto={d.cost === null ? null : fmtBRL(d.cost)} motivo={d.motivos.cost} />
                      <Celula texto={d.receita === null ? null : fmtBRL(d.receita)} motivo={d.motivos.receita} />
                      <Celula texto={d.roas === null ? null : fmtRoas(d.roas)} motivo={d.motivos.roas} />
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

function LinhaLegenda() {
  return (
    <svg width="18" height="10" aria-hidden>
      <line x1="0" y1="5" x2="18" y2="5" stroke={INK} strokeWidth="2" /><circle cx="9" cy="5" r="3" fill={INK} stroke="var(--card)" strokeWidth="1.5" />
    </svg>
  );
}
