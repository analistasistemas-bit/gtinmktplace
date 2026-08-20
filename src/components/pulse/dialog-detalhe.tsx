// Pulse (ADR-0119): detalhe do produto. A decisão ("meu preço x mercado, e sobra quanto?") fica no
// topo; a lista de ofertas é a evidência abaixo dela — antes o operador precisava rolar 20 linhas
// para descobrir que estava vendendo no prejuízo.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Truck, Store, ExternalLink } from 'lucide-react';
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
  estadoAtualOfertas, menorPrecoPorDia, vendasEstimadasVendedor, margemEstimada, margemEhEstimativa,
} from '@/lib/pulse-margem';
import {
  classeTom, motivoSemPrecoProprio, posicaoVsMercado, reputacao, tipoAnuncio,
} from '@/lib/pulse-formato';
import { fmtBRL, fmtInt, parseNumeroPtBr } from '@/lib/formato';
import { buildPulseSearchUrl } from '@/lib/pulse-url';
import { DialogReprecificar } from '@/components/pulse/dialog-reprecificar';
import { cn } from '@/lib/utils';

/**
 * A comissão TEM que vir de `comissao_pct` (lida no preço praticado). Cair em
 * `ptw_custos.comissao` seria voltar ao defeito da Errata 6: aquele valor é calculado sobre o
 * preço sugerido pelo ML e superestima a sobra em todo anúncio acima da sugestão.
 */
function insumoFaltante(
  contexto: { custo: number | null; aliquotaPct: number | null } | undefined,
  produto: { comissao_pct: number | null; ptw_custos: { frete: number | null } | null } | null,
): string | null {
  if (!contexto || contexto.custo == null) return 'custo do produto';
  if (contexto.aliquotaPct == null) return 'alíquota de imposto';
  if (produto?.comissao_pct == null) return 'comissão do Mercado Livre';
  if (produto.ptw_custos?.frete == null) return 'custo de frete do Mercado Livre';
  return null;
}

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

export function DialogDetalhe({ produto, onFechar }: { produto: PulseProduto | null; onFechar: () => void }) {
  const aberto = produto != null;
  const [precoEditado, setPrecoEditado] = useState<string | null>(null);
  const [reprecificarAberto, setReprecificarAberto] = useState(false);
  useEffect(() => setPrecoEditado(null), [produto?.id]);
  useEffect(() => setReprecificarAberto(false), [produto?.id]);

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
  const historico = menorPrecoPorDia(ofertas).slice(-14);

  const vendedoresPorSeller = new Map<number, PulseVendedor[]>();
  for (const v of data?.vendedores ?? []) {
    const lista = vendedoresPorSeller.get(v.seller_id) ?? [];
    lista.push(v);
    vendedoresPorSeller.set(v.seller_id, lista);
  }

  const menorConcorrente = atuais[0]?.preco ?? null;
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

  const vendasDe = (o: PulseOferta) => {
    const hist = vendedoresPorSeller.get(o.seller_id) ?? [];
    return hist[hist.length - 1]?.transactions_total ?? null;
  };
  const nomeDe = (o: PulseOferta) => {
    const hist = vendedoresPorSeller.get(o.seller_id) ?? [];
    return hist[hist.length - 1]?.nickname ?? `Vendedor ${o.seller_id}`;
  };
  const ufDe = (o: PulseOferta) => {
    const hist = vendedoresPorSeller.get(o.seller_id) ?? [];
    return hist[hist.length - 1]?.uf ?? null;
  };

  const colunasConcorrentes: Column<PulseOferta>[] = [
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
      header: 'Vendedor',
      className: 'w-64',
      sortValue: (o) => nomeDe(o).toLowerCase(),
      cell: (o) => {
        const hist = vendedoresPorSeller.get(o.seller_id) ?? [];
        const selo = reputacao(hist[hist.length - 1]?.power_seller ?? null);
        return (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="max-w-52 truncate font-medium" title={nomeDe(o)}>{nomeDe(o)}</span>
            {selo && (
              <Badge variant="outline" className="border-info/30 bg-info/10 text-[10px] font-normal text-info">
                {selo}
              </Badge>
            )}
            {o.loja_oficial && (
              <Badge variant="outline" className="text-[10px] font-normal">
                <Store className="mr-1 h-3 w-3" />
                Loja oficial
              </Badge>
            )}
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
      key: 'vendas',
      // "na conta" fica no cabeçalho de propósito: é o total do vendedor no ML inteiro, não deste
      // produto. Uma coluna ordenável chamada só "Vendas" convidaria a ler como vendas do anúncio.
      header: 'Vendas na conta',
      className: 'w-32 text-right',
      sortValue: (o) => vendasDe(o),
      cell: (o) => {
        const total = vendasDe(o);
        const delta = vendasEstimadasVendedor(vendedoresPorSeller.get(o.seller_id) ?? []);
        if (total == null) return <span className="text-xs text-muted-foreground">não coletado</span>;
        return (
          <div className="tabular-nums">
            {fmtInt(total)}
            {delta != null && delta > 0 && (
              <div className="text-xs text-muted-foreground" title="Desde que este vendedor entrou no radar">
                ≈{fmtInt(delta)} no período
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'visitas',
      // Demanda do anúncio do concorrente: a única medida por anúncio que a API oficial dá
      // (Errata 9 do ADR-0119). Medida uma vez por dia, no baseline — o painel não a atualiza.
      header: 'Visitas 30d',
      className: 'w-28 text-right',
      // Sem coalescer para 0: o DataTable já joga nulo para o fim nas duas direções, e "não
      // medido" ordenado como zero visitas afirmaria justamente o que não sabemos.
      sortValue: (o) => o.visitas_30d,
      cell: (o) => (
        o.visitas_30d == null
          ? <span className="text-xs text-muted-foreground" title="Ainda não medido">—</span>
          : <span className="tabular-nums" title="Visitas no anúncio nos últimos 30 dias">{fmtInt(o.visitas_30d)}</span>
      ),
    },
    {
      key: 'anuncio',
      header: 'Anúncio',
      className: 'w-28',
      sortValue: (o) => tipoAnuncio(o.tier),
      cell: (o) => (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {tipoAnuncio(o.tier)}
          {o.frete_gratis && (
            <span className="inline-flex items-center gap-1 text-success" title="Frete grátis">
              <Truck className="h-3 w-3" />
              grátis
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
            <div className="flex flex-col gap-3">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-40 w-full rounded-lg" />
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {/* Bloco de decisão: o que o operador veio saber, antes da evidência. */}
              {produto?.codigo_pai && (
                <section className="rounded-lg border bg-muted/30 p-4">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
                      <p className="text-xs text-muted-foreground">Menor concorrente</p>
                      <p className="text-lg font-semibold tabular-nums">
                        {menorConcorrente != null ? fmtBRL(menorConcorrente) : '—'}
                      </p>
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
                    <div>
                      {/* Duas referências convivem nesta linha e podem apontar para lados opostos:
                          o menor concorrente é o piso real da ficha; a referência do ML é um preço
                          calculado por ele a partir de concorrentes internos e externos. Sem dizer
                          isso, o bloco parece se contradizer. */}
                      <p
                        className="text-xs text-muted-foreground"
                        title="Preço de referência calculado pelo Mercado Livre. Não é o menor preço da ficha — por isso pode ficar acima do menor concorrente."
                      >
                        Referência do ML
                      </p>
                      {/* Referência que o ML marcou como não aplicável não é exibida como número:
                          um valor grande e em destaque é lido como alvo de preço, e seria alvo que
                          a própria fonte não sustenta. O selo da lista diz a mesma coisa. */}
                      {produto.ptw_aplicavel === false ? (
                        <p
                          className="text-sm text-muted-foreground"
                          title="O Mercado Livre calculou uma referência para este anúncio, mas marcou que ela não se aplica agora."
                        >
                          não aplicável
                        </p>
                      ) : (
                        <p className="text-lg font-semibold tabular-nums">
                          {produto.ptw_preco_sugerido != null ? fmtBRL(produto.ptw_preco_sugerido) : '—'}
                        </p>
                      )}
                    </div>
                  </div>

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
                      <span className="text-xs text-muted-foreground">
                        Sobra para você
                        {/* A conta fica à vista: foi uma comissão errada, silenciosa, que
                            superestimou a sobra deste produto em R$ 0,97 (Errata 6). */}
                        {margem && (
                          <span
                            className="ml-1 cursor-help opacity-70"
                            title={[
                              `Comissão do ML: ${fmtBRL(margem.comissao)}`,
                              `Frete: ${fmtBRL(produto.ptw_custos?.frete ?? 0)}`,
                              `Imposto: ${contexto?.aliquotaPct ?? 0}%`,
                              `Custo do produto: ${fmtBRL(contexto?.custo ?? 0)}`,
                            ].join(' · ')}
                          >
                            (comissão {fmtBRL(margem.comissao)})
                          </span>
                        )}
                      </span>
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
                          <span className="ml-1 text-sm font-normal opacity-80">
                            ({margem.margemPct.toFixed(1)}%)
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
                </section>
              )}

              {historico.length >= 2 && (
                <section>
                  <h3 className="mb-1 text-sm font-medium">Menor preço do mercado</h3>
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
                  <span className="font-normal text-muted-foreground">({atuais.length} ofertas ativas)</span>
                </h3>
                {atuais.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    Nenhuma oferta coletada ainda. Use “Atualizar agora” na lista para forçar uma coleta.
                  </p>
                ) : (
                  // DataTable em vez da tabela manual: traz a ordenação por coluna de graça, a
                  // mesma da lista do radar. "Vendas na conta" virou coluna própria justamente
                  // para poder ordenar por volume — o nome do vendedor ordena alfabeticamente.
                  <DataTable
                    columns={colunasConcorrentes}
                    rows={atuais}
                    rowKey={(o) => o.item_id}
                    defaultSort={{ key: 'preco', dir: 'asc' }}
                  />
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
