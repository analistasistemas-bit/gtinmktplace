// Pulse (ADR-0119): detalhe do produto. A decisão ("meu preço x mercado, e sobra quanto?") fica no
// topo; a lista de ofertas é a evidência abaixo dela — antes o operador precisava rolar 20 linhas
// para descobrir que estava vendendo no prejuízo.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Truck, Store, ExternalLink, Zap } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, type Column } from '@/components/ui/data-table';
import { QK } from '@/lib/queries';
import {
  fetchPulseDetalhe, fetchContextoMargem,
  type PulseProduto, type PulseVendedor, type PulseOferta,
} from '@/lib/pulse';
import {
  estadoAtualOfertas, mercadoPulse, menorPrecoPorDia, ofertasAbaixoDaReferencia,
  porteDoVendedor, shareDeVisitas, margemEstimada, margemEhEstimativa, insumoFaltante,
} from '@/lib/pulse-margem';
import {
  classeTom, motivoSemPrecoProprio, posicaoVsMercado, reputacao, rotuloMotivoQualificacao,
  rotuloReputacao, rotuloStatusQualificacao, tipoAnuncio,
} from '@/lib/pulse-formato';
import { fmtBRL, fmtInt, parseNumeroPtBr } from '@/lib/formato';
import { buildPulseSearchUrl } from '@/lib/pulse-url';
import { DialogReprecificar } from '@/components/pulse/dialog-reprecificar';
import { cn } from '@/lib/utils';
import type { QualificacaoOferta } from '../../../supabase/functions/_shared/concorrencia/qualificacao';

/** Minigráfico do menor preço no tempo. Sem lib: 40 linhas de SVG contra 40 KB de dependência. */
function Sparkline({ pontos }: { pontos: { dia: string; preco: number }[] }) {
  if (pontos.length < 2) return null;
  const precos = pontos.map((p) => p.preco);
  const min = Math.min(...precos);
  const max = Math.max(...precos);
  const amplitude = max - min || 1;
  const w = 260;
  const h = 44;
  const passo = w / (pontos.length - 1);
  const y = (v: number) => h - 4 - ((v - min) / amplitude) * (h - 8);
  const d = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * passo).toFixed(1)},${y(p.preco).toFixed(1)}`).join(' ');
  const ultimo = pontos[pontos.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-11 w-full max-w-[260px]" role="img"
      aria-label={`Menor preço variou de ${fmtBRL(min)} a ${fmtBRL(max)} no período`}>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill="currentColor" className="text-primary/10" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary" />
      {/* cx = w - 2.5 para o ponto final não sair pela metade na borda do viewBox. */}
      <circle cx={w - 2.5} cy={y(ultimo.preco)} r="2.5" fill="currentColor" className="text-primary" />
    </svg>
  );
}

type OfertaClassificada = PulseOferta & { qualificacao: QualificacaoOferta };

/** Tendência do porte: sinal do delta contra o mesmo período de 12 meses atrás (ADR-0146 D-3). */
const ROTULO_TENDENCIA = {
  crescendo: 'vende mais que há 1 ano',
  estavel: 'mesmo ritmo de 1 ano atrás',
  encolhendo: 'vende menos que há 1 ano',
} as const;

function registro(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor != null && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : null;
}

function DetalhesConta({ vendedor, rotulo, nome }: { vendedor: PulseVendedor | undefined; rotulo: string; nome: string }) {
  const detalhe = vendedor?.reputacao_detalhe;
  const transacoes = registro(detalhe?.transactions);
  if (!transacoes) return <span className="text-xs">{rotulo}</span>;
  const avaliacoes = registro(transacoes.ratings);
  const metricas = registro(detalhe?.metrics);
  const metricasDisponiveis = [
    ['claims', 'Reclamações'], ['delayed_handling_time', 'Atrasos'], ['cancellations', 'Cancelamentos'],
  ].flatMap(([chave, nome]) => {
    const metrica = registro(metricas?.[chave]);
    return metrica ? [{ nome, metrica }] : [];
  });

  return (
    <details className="text-xs">
      <summary
        className="cursor-pointer text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.currentTarget.click();
          }
        }}
      >
        {rotulo}<span className="sr-only">. Vendedor: {nome}. Ver detalhes da conta</span>
      </summary>
      <dl className="mt-2 space-y-2 border-l pl-2 text-muted-foreground">
        {typeof transacoes.period === 'string' && <div><dt className="font-medium text-foreground">Período</dt><dd>{transacoes.period}</dd></div>}
        {typeof transacoes.total === 'number' && <div><dt className="font-medium text-foreground">Transações na conta</dt><dd>{fmtInt(transacoes.total)}</dd></div>}
        {typeof avaliacoes?.positive === 'number' && <div><dt className="font-medium text-foreground">Avaliações positivas</dt><dd>{Math.round(avaliacoes.positive * 100)}%</dd></div>}
        {metricasDisponiveis.map(({ nome, metrica }) => (
          <div key={nome}>
            <dt className="font-medium text-foreground">{nome}</dt>
            <dd className="grid grid-cols-3 gap-2">
              <span>Período<br />{typeof metrica.period === 'string' ? metrica.period : '—'}</span>
              <span>Taxa<br />{typeof metrica.rate === 'number' ? `${(metrica.rate * 100).toFixed(1)}%` : '—'}</span>
              <span>Quantidade<br />{typeof metrica.value === 'number' ? fmtInt(metrica.value) : '—'}</span>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function DialogDetalhe({ produto, onFechar }: { produto: PulseProduto | null; onFechar: () => void }) {
  const aberto = produto != null;
  const [precoEditado, setPrecoEditado] = useState<string | null>(null);
  const [reprecificarAberto, setReprecificarAberto] = useState(false);
  const [filtroOfertas, setFiltroOfertas] = useState<'relevantes' | 'todas'>('relevantes');
  useEffect(() => setPrecoEditado(null), [produto?.id]);
  useEffect(() => setReprecificarAberto(false), [produto?.id]);
  useEffect(() => setFiltroOfertas('relevantes'), [produto?.id]);

  const { data, isLoading } = useQuery({
    queryKey: produto ? QK.pulseDetalhe(produto.id) : QK.pulseDetalhe('_'),
    queryFn: () => fetchPulseDetalhe(produto!.id),
    enabled: aberto,
  });
  const { data: contexto, isLoading: contextoCarregando } = useQuery({
    queryKey: ['pulse', 'contexto-margem', produto?.codigo_pai],
    queryFn: () => fetchContextoMargem(produto!.codigo_pai!),
    enabled: aberto && !!produto?.codigo_pai,
  });

  const ofertas = data?.ofertas ?? [];
  const atuais = estadoAtualOfertas(data?.ofertasAtuais ?? []);
  const mercado = mercadoPulse(atuais, data?.vendedores ?? []);
  const qualificacaoPorItem = new Map(mercado.ofertas.map((oferta) => [oferta.item_id, oferta.qualificacao]));
  const ofertasClassificadas: OfertaClassificada[] = atuais.map((oferta) => ({
    ...oferta,
    qualificacao: qualificacaoPorItem.get(oferta.item_id)!,
  }));
  const ofertasExibidas = filtroOfertas === 'relevantes'
    ? ofertasClassificadas.filter((oferta) => oferta.qualificacao.status === 'relevante')
    : ofertasClassificadas;
  // `atuais` entra para o último ponto do gráfico bater com o "Menor oferta observada" logo acima:
  // o histórico é limitado a 400 linhas e a view é a verdade do presente.
  const historico = menorPrecoPorDia(ofertas, atuais).slice(-14);
  const abaixoDaReferencia = ofertasAbaixoDaReferencia(mercado);

  const vendedoresPorSeller = new Map<number, PulseVendedor[]>();
  for (const v of data?.vendedores ?? []) {
    const lista = vendedoresPorSeller.get(v.seller_id) ?? [];
    lista.push(v);
    vendedoresPorSeller.set(v.seller_id, lista);
  }

  const menorConcorrente = mercado.menor_relevante;
  // Uma fonte só: a nossa oferta viva na ficha. Antes o preço local vinha primeiro e vencia o
  // vivo, então o detalhe mostrava um valor defasado e a margem simulada herdava o erro.
  const meuPreco = produto?.meu_preco ?? null;
  const posicao = posicaoVsMercado(meuPreco, menorConcorrente);
  const precoInput = precoEditado ?? (meuPreco != null ? String(meuPreco) : '');
  const precoSimulado = parseNumeroPtBr(precoInput);
  const faltando = produto?.codigo_pai && !contextoCarregando ? insumoFaltante(contexto, produto) : null;
  const margem = precoSimulado && precoSimulado > 0 && !faltando
    ? margemEstimada({
        preco: precoSimulado, custoProduto: contexto?.custo ?? null,
        comissao: produto ? { pct: produto.comissao_pct, fixa: produto.comissao_fixa } : null,
        frete: produto?.ptw_custos?.frete ?? null, aliquotaPct: contexto?.aliquotaPct ?? null,
      })
    : null;
  const margemRuim = margem != null && margem.liquido < 0;
  const margemEstimativa = margem != null
    && margemEhEstimativa(precoSimulado, produto?.comissao_preco ?? null);
  const buscaMercadoLivre = buildPulseSearchUrl({
    gtin: produto?.gtin ?? null,
    titulo: produto?.titulo ?? null,
  });

  const porteDe = (o: PulseOferta) => porteDoVendedor(vendedoresPorSeller.get(o.seller_id) ?? []);
  const nomeDe = (o: PulseOferta) => {
    const hist = vendedoresPorSeller.get(o.seller_id) ?? [];
    return hist[hist.length - 1]?.nickname ?? `Vendedor ${o.seller_id}`;
  };
  const ufDe = (o: PulseOferta) => {
    const hist = vendedoresPorSeller.get(o.seller_id) ?? [];
    return hist[hist.length - 1]?.uf ?? null;
  };

  const vendedorAtualDe = (o: PulseOferta) => {
    const hist = vendedoresPorSeller.get(o.seller_id) ?? [];
    return hist[hist.length - 1];
  };

  const colunasConcorrentes: Column<OfertaClassificada>[] = [
    {
      key: 'preco',
      header: 'Preço',
      className: 'text-right',
      sortValue: (o) => o.preco,
      cell: (o) => (
        <span className={cn(
          'tabular-nums',
          menorConcorrente != null && o.preco === menorConcorrente && 'font-semibold text-foreground',
        )}>
          {fmtBRL(o.preco)}
        </span>
      ),
    },
    {
      key: 'vendedor',
      // Três colunas para o mesmo sujeito viraram uma: cor da reputação, selo de MercadoLíder e o
      // veredito da régua (ADR-0130) descrevem o MESMO vendedor. Nada sai da tela — muda o
      // agrupamento, para o dialog caber sem duplo scroll.
      header: 'Vendedor',
      className: 'w-72',
      sortValue: (o) => nomeDe(o).toLowerCase(),
      cell: (o) => {
        const vendedor = vendedorAtualDe(o);
        const q = o.qualificacao;
        const tom = q.status === 'relevante' ? 'ok' as const
          : q.status === 'observacao' ? 'atencao' as const : 'risco' as const;
        const selo = reputacao(vendedor?.power_seller ?? null);
        return (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="max-w-52 truncate font-medium" title={nomeDe(o)}>{nomeDe(o)}</span>
              {o.loja_oficial && (
                <Badge variant="outline" className="text-[10px] font-normal">
                  <Store className="mr-1 h-3 w-3" />
                  Loja oficial
                </Badge>
              )}
              <Badge
                variant="outline"
                className={cn('text-[10px] font-normal', classeTom(tom))}
                // Os motivos saem do corpo da célula para o tooltip do badge: eles explicam o
                // veredito, e o veredito é o que decide se a oferta entra na comparação.
                title={q.motivos.map(rotuloMotivoQualificacao).join(' · ')}
              >
                {rotuloStatusQualificacao(q.status)}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {/* O motivo continua no corpo da célula (não só no title do selo, que só o badge
                  carrega): "não sai da tela" vale para o motivo de não ser relevante também. Só
                  para quem não é relevante — a linha relevante fica compacta de propósito. */}
              {q.status !== 'relevante' && (
                <span>{q.motivos.map(rotuloMotivoQualificacao).join(' · ')}</span>
              )}
              <DetalhesConta
                vendedor={vendedor}
                rotulo={rotuloReputacao(vendedor?.nivel ?? null)}
                nome={nomeDe(o)}
              />
              {selo && <span>· {selo}</span>}
            </div>
          </div>
        );
      },
    },
    {
      key: 'uf',
      // "Estado" e não "UF": é a palavra que o operador usa. Ordena com os sem-estado no fim, para
      // a lista não começar com uma coluna de traços.
      header: 'Estado',
      sortValue: (o) => ufDe(o) ?? 'ZZ',
      cell: (o) => {
        const uf = ufDe(o);
        return uf
          ? <span className="tabular-nums" title={`Envia de ${uf}`}>{uf}</span>
          : <span className="text-xs text-muted-foreground" title="O Mercado Livre não expôs o endereço deste vendedor">—</span>;
      },
    },
    {
      key: 'porte',
      // Antes esta coluna somava o total da conta e exibia embaixo o DELTA de `transactions_total`
      // como "≈N no período". O Spike 048 provou que esse campo é janela móvel de 365 dias, então o
      // delta é "venda de agora menos venda de um ano atrás" — não venda. Aqui o Radar passa a usar
      // a MESMA definição do Sonar (ADR-0146): média mensal de 12 meses, e o delta vira tendência.
      // Continua sendo a LOJA INTEIRA: venda por anúncio de terceiro não é obtenível (ADR-0142).
      header: 'Porte do vendedor',
      className: 'w-36 text-right',
      sortValue: (o) => porteDe(o)?.mediaMensal ?? null,
      cell: (o) => {
        const porte = porteDe(o);
        if (porte == null) return <span className="text-xs text-muted-foreground">não coletado</span>;
        return (
          <div
            className="tabular-nums"
            title={`Média mensal dos últimos 12 meses da loja inteira deste vendedor. Não é venda deste anúncio — a API do Mercado Livre não expõe venda por anúncio de terceiro.`}
          >
            {fmtInt(Math.round(porte.mediaMensal))}<span className="text-xs text-muted-foreground">/mês</span>
            {porte.tendencia && (
              <div className={cn('text-xs', porte.tendencia === 'encolhendo' ? 'text-warning' : 'text-muted-foreground')}>
                {ROTULO_TENDENCIA[porte.tendencia]}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'visitas',
      // Demanda do anúncio do concorrente: a única medida por anúncio que a API oficial dá
      // (Errata 9 do ADR-0119) — e por isso o melhor proxy de tração DAQUELE anúncio, bem melhor
      // que o porte da loja. Medida uma vez por dia, no baseline; o painel não a atualiza.
      header: 'Visitas 30d',
      className: 'w-32 text-right',
      // Sem coalescer para 0: o DataTable já joga nulo para o fim nas duas direções, e "não
      // medido" ordenado como zero visitas afirmaria justamente o que não sabemos.
      sortValue: (o) => o.visitas_30d,
      cell: (o) => {
        if (o.visitas_30d == null) {
          return <span className="text-xs text-muted-foreground" title="Ainda não medido">—</span>;
        }
        const share = shareDeVisitas(mercado, o.visitas_30d);
        return (
          <div className="tabular-nums" title="Visitas no anúncio nos últimos 30 dias">
            {fmtInt(o.visitas_30d)}
            {/* Fatia entre os RELEVANTES. Tráfego não é conversão: não é fatia de mercado. */}
            {share != null && o.qualificacao.status === 'relevante' && (
              <div className="text-xs text-muted-foreground" title="Fatia das visitas entre os concorrentes relevantes. Tráfego não é venda.">
                {share.toFixed(share < 10 ? 1 : 0)}% das visitas
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'anuncio',
      header: 'Anúncio',
      className: 'w-28',
      sortValue: (o) => tipoAnuncio(o.tier),
      cell: (o) => (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {tipoAnuncio(o.tier)}
          {o.frete_gratis && (
            <span className="inline-flex items-center gap-1 text-success" title="Frete grátis">
              <Truck className="h-3 w-3" />
              grátis
            </span>
          )}
          {/* `full_ml` já era coletado e entrava na qualificação, mas nunca chegava à tela. FULL
              muda prazo de entrega, que é o que decide a compra quando o preço empata. */}
          {o.full_ml && (
            <span className="inline-flex items-center gap-1 text-info" title="Mercado Envios Full: estoque no centro de distribuição do ML">
              <Zap className="h-3 w-3" />
              FULL
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'oferta',
      header: 'Oferta',
      className: 'w-24 text-right',
      stickyRight: true,
      cell: (o) => (
        o.permalink ? (
            <a
              href={o.permalink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-info hover:underline"
              title={`Abrir o anúncio de ${nomeDe(o)} no Mercado Livre`}
              aria-label={`Abrir oferta de ${nomeDe(o)} no Mercado Livre (nova aba)`}
            >
              <ExternalLink className="h-3 w-3" />
              Abrir
            </a>
        ) : (
          <span className="text-xs text-muted-foreground">Indisponível</span>
        )
      ),
    },
  ];

  return (
    <>
      <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-7xl">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-base leading-snug">
              {produto?.titulo ?? 'Ficha sem nome'}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
              <span>{produto?.gtin ?? `Ficha ${produto?.catalog_product_id ?? ''}`}</span>
              {buscaMercadoLivre && (
                <a
                  href={buscaMercadoLivre}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-normal text-info hover:underline"
                  aria-label="Buscar anúncios no Mercado Livre (nova aba)"
                >
                  <ExternalLink className="h-3 w-3" />
                  Buscar anúncios no Mercado Livre
                </a>
              )}
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex min-w-0 flex-col gap-3">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-40 w-full rounded-lg" />
            </div>
          ) : (
            // `min-w-0`: filho de grid não encolhe abaixo do conteúdo por padrão, e sem isso o
            // `overflow-x-auto` da tabela de concorrentes não tem largura para agir — em 820px o
            // dialog estourava para 1251px e cortava "Sua posição" e "Reprecificar".
            <div className="flex min-w-0 flex-col gap-5">
              {/* Bloco de decisão: o que o operador veio saber, antes da evidência. */}
              {produto?.codigo_pai && (
                <section className="rounded-lg border bg-muted/30 p-4">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Seu preço</p>
                      {meuPreco != null ? (
                        <p className="text-lg font-semibold tabular-nums">{fmtBRL(meuPreco)}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {motivoSemPrecoProprio(produto)}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Menor concorrente relevante</p>
                      <p className="text-lg font-semibold tabular-nums">
                        {menorConcorrente != null ? fmtBRL(menorConcorrente) : 'Sem concorrente relevante'}
                      </p>
                      {mercado.menor_observado != null && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Menor oferta observada: {fmtBRL(mercado.menor_observado)}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Sua posição</p>
                      {posicao ? (
                        <Badge variant="outline" className={cn('mt-1 font-normal', classeTom(posicao.tom))}>
                          {posicao.texto}
                        </Badge>
                      ) : (
                        <p className="text-lg text-muted-foreground">—</p>
                      )}
                    </div>
                  </div>

                  {/* Separado da faixa de propósito: estas ofertas NÃO entram na comparação de
                      preço (régua de relevância, ADR-0020/0050), mas o comprador as vê na mesma
                      página do catálogo. O texto não diz quem leva a venda — não é obtenível
                      (Spike 049), e o mais barato não é o ganhador. */}
                  {abaixoDaReferencia && (
                    <p className="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2.5 text-xs">
                      <Store className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                      <span>
                        <span className="font-medium">
                          {abaixoDaReferencia.contagem === 1
                            ? '1 oferta ativa abaixo da sua referência'
                            : `${abaixoDaReferencia.contagem} ofertas ativas abaixo da sua referência`}
                        </span>
                        , a partir de <span className="tabular-nums">{fmtBRL(abaixoDaReferencia.menorPreco)}</span>{' '}
                        ({Math.round(abaixoDaReferencia.pctAbaixo)}% abaixo de{' '}
                        <span className="tabular-nums">{fmtBRL(abaixoDaReferencia.referencia)}</span>).{' '}
                        São vendedores sem histórico suficiente, então não entram na comparação de
                        preço — mas aparecem na mesma página do catálogo que a sua.
                      </span>
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
                    <div className="flex flex-col gap-1">
                      <label htmlFor="pulse-simulador" className="text-xs text-muted-foreground">
                        Simular preço
                      </label>
                      <Input
                        id="pulse-simulador"
                        inputMode="decimal"
                        className="h-9 w-32 tabular-nums"
                        value={precoInput}
                        onChange={(e) => setPrecoEditado(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Sobra para você</span>
                      {contextoCarregando ? (
                        <span className="text-sm text-muted-foreground">calculando…</span>
                      ) : faltando ? (
                        <Badge variant="outline" className={classeTom('atencao')}>
                          Margem indisponível: falta {faltando}
                        </Badge>
                      ) : margem ? (
                        <span
                          className={cn(
                            'text-lg font-semibold tabular-nums',
                            margemRuim ? 'text-destructive' : 'text-success',
                          )}
                        >
                          {fmtBRL(margem.liquido)}
                          {/* ADR-0150 D-1: o denominador vai no nome. Markup (lucro ÷ custo) e
                              margem s/ venda (lucro ÷ preço) convivem no Pulse e não se misturam. */}
                          <span className="ml-1 text-sm font-normal opacity-80">
                            ({margem.margemPct.toFixed(1)}% s/ venda)
                          </span>
                          {margemEstimativa && (
                            <span
                              className="ml-1 text-xs font-normal text-muted-foreground"
                              title="A comissão do ML muda por faixa de preço, e a que temos foi lida em outro preço. Neste preço, o número é aproximado."
                            >
                              estimativa
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">informe um preço</span>
                      )}
                    </div>
                    <Button
                      className="ml-auto"
                      disabled={!precoSimulado || precoSimulado <= 0}
                      onClick={() => setReprecificarAberto(true)}
                    >
                      Reprecificar
                    </Button>
                  </div>

                  {margemRuim && (
                    <p className="mt-3 text-sm text-destructive">
                      Nesse preço você perde {fmtBRL(Math.abs(margem!.liquido))} por unidade vendida.
                    </p>
                  )}

                  {/* A conta fica à vista, e não num `title`: tooltip não funciona em touch e some
                      em demo projetada. Foi uma comissão errada e silenciosa que superestimou a
                      sobra deste produto em R$ 0,97 (Errata 6 da ADR-0119). Mesmo padrão de tabela
                      que a DRE do Sonar já usa. */}
                  {margem && (
                    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 border-t pt-3 text-xs sm:grid-cols-4">
                      {[
                        ['Comissão do ML', margem.comissao],
                        ['Frete', produto.ptw_custos?.frete ?? 0],
                        [`Imposto (${contexto?.aliquotaPct}%)`, (precoSimulado! * (contexto?.aliquotaPct ?? 0)) / 100],
                        ['Custo do produto', contexto?.custo ?? 0],
                      ].map(([rotulo, valor]) => (
                        <div key={rotulo as string}>
                          <dt className="text-muted-foreground">{rotulo}</dt>
                          <dd className="tabular-nums">−{fmtBRL(valor as number)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </section>
              )}

              {historico.length >= 2 && (
                <section>
                  <h3 className="mb-1 text-sm font-medium">Menor oferta observada no período</h3>
                  <div className="flex items-end gap-4">
                    <Sparkline pontos={historico} />
                    <div className="pb-1 text-xs text-muted-foreground">
                      <div className="tabular-nums">{fmtBRL(historico[historico.length - 1].preco)} hoje</div>
                      <div>{historico.length} dias com coleta</div>
                    </div>
                  </div>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-sm font-medium">
                  Concorrentes{' '}
                  <span className="font-normal text-muted-foreground">
                    ({mercado.total_relevantes} {mercado.total_relevantes === 1 ? 'relevante' : 'relevantes'} de {mercado.total_observadas} {mercado.total_observadas === 1 ? 'observada' : 'observadas'})
                  </span>
                </h3>
                {/* Composição dos relevantes: já era calculada em `resumirMercadoQualificado` e
                    nunca chegava à tela. Diz COMO a disputa é feita — preço empatado com metade
                    dos rivais no FULL é outra decisão. */}
                {mercado.total_relevantes > 0 && (
                  <p className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {mercado.vendedores_relevantes} {mercado.vendedores_relevantes === 1 ? 'vendedor' : 'vendedores'}
                    </span>
                    <span className="tabular-nums">·  {mercado.frete_gratis_relevantes} com frete grátis</span>
                    <span className="tabular-nums">·  {mercado.full_relevantes} no FULL</span>
                    {mercado.maior_relevante != null && mercado.menor_relevante != null && (
                      <span className="tabular-nums">
                        ·  disputa de {fmtBRL(mercado.menor_relevante)} a {fmtBRL(mercado.maior_relevante)}
                      </span>
                    )}
                  </p>
                )}
                {atuais.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Nenhuma oferta coletada ainda. Use “Atualizar agora” na lista para forçar uma coleta.
                  </p>
                ) : (
                  <>
                    <div className="mb-2 flex gap-1" role="group" aria-label="Filtro de concorrentes">
                      <Button size="sm" variant={filtroOfertas === 'relevantes' ? 'secondary' : 'ghost'} aria-pressed={filtroOfertas === 'relevantes'} onClick={() => setFiltroOfertas('relevantes')}>Relevantes</Button>
                      <Button size="sm" variant={filtroOfertas === 'todas' ? 'secondary' : 'ghost'} aria-pressed={filtroOfertas === 'todas'} onClick={() => setFiltroOfertas('todas')}>Todas</Button>
                    </div>
                    <DataTable
                      columns={colunasConcorrentes}
                      rows={ofertasExibidas}
                      rowKey={(o) => o.item_id}
                      defaultSort={{ key: 'preco', dir: 'asc' }}
                    />
                  </>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  O volume é da conta do vendedor no Mercado Livre inteiro, não deste anúncio — a API não
                  expõe vendas por anúncio de terceiros. Use “Abrir” para acessar uma oferta específica ou
                  a busca acima para ver anúncios compatíveis.
                </p>
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <DialogReprecificar
        codigoPai={reprecificarAberto ? produto?.codigo_pai ?? null : null}
        precoInicial={precoSimulado ?? null}
        custos={produto ? {
          comissaoPct: produto.comissao_pct,
          comissaoFixa: produto.comissao_fixa,
          comissaoPreco: produto.comissao_preco,
          frete: produto.ptw_custos?.frete ?? null,
        } : null}
        onFechar={() => setReprecificarAberto(false)}
      />
    </>
  );
}
