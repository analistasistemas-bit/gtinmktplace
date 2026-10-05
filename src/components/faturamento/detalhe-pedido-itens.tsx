import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtBRL, fmtBRLSinal, fmtMarkup } from '@/lib/formato';
import { fmtDataCurta, labelLogisticaEnvio, labelStatusEnvio, urlVendaML } from '@/lib/ml-status';
import { cascataDoPedido } from '@/lib/cascata-pedido';
import { labelStatusLiberacao, statusLiberacao } from '@/lib/status-liberacao';
import { nomeExibicaoComprador, type ItemPedido, type Pedido } from '@/lib/pedidos-faturamento';
import { formatarNomeProduto } from '@/lib/texto';
import { useDetalheMLPedido } from '@/hooks/useDetalheMLPedido';
import { BotaoCopiar } from '@/components/ui/botao-copiar';
import { Skeleton } from '@/components/ui/skeleton';
import { ThumbProduto } from './pilha-thumbs';

/** Alíquota em pt-BR: inteira no caso normal ("8"), com 1 decimal só quando o pedido mistura origens. */
const PCT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

const TITULO_ZONA = 'mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground';

/** dd/mm/aaaa HH:mm. '—' se nulo/inválido. */
function fmtDataHora(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Conteúdo expansível de um pedido (linha aberta), em 3 zonas: PEDIDO (comprador, envio, pagamento),
 * ITENS (um bloco por item com custo/líquido/markup) e DINHEIRO (cascata venda → margem de
 * contribuição). Compartilhado entre o menu Faturamento, o Detalhe do líquido (Financeiro) e o dossiê
 * do SKU — as zonas se organizam pela largura do próprio container, não da tela (o dossiê abre num
 * Sheet estreito).
 *
 * `liquidoBruto`: no Financeiro (Detalhe do líquido) o "Líquido" do item tem que bater com o dinheiro
 * que efetivamente cai no Mercado Pago — nunca pode descontar o imposto estimado (ADR-0055). O
 * Faturamento continua mostrando o líquido já líquido de imposto (default). O Markup não muda: nos
 * dois casos usa `it.markup`, que continua calculado líquido de imposto.
 */
export function DetalhePedidoItens({ pedido: p, liquidoBruto = false, destaque, linkSku = false }: {
  pedido: Pedido; liquidoBruto?: boolean;
  /** Faturamento › Vendas: o código do item abre o dossiê do SKU. */
  linkSku?: boolean;
  /** Dossiê do SKU: marca os itens destes códigos num pedido que também tem outros produtos. */
  destaque?: { codigos: ReadonlySet<string>; rotulo: string };
}) {
  const ml = useDetalheMLPedido(p.vendaIds);
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-y-4 px-4 py-3 @3xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,17rem)] @3xl:px-10">
        <ZonaPedido p={p} ml={ml} />
        <ZonaItens p={p} liquidoBruto={liquidoBruto} destaque={destaque} linkSku={linkSku} />
        <ZonaDinheiro p={p} tipoAnuncio={ml.data?.tiposAnuncio.length === 1 ? ml.data.tiposAnuncio[0] : null} />
      </div>
    </div>
  );
}

function ZonaPedido({ p, ml }: { p: Pedido; ml: ReturnType<typeof useDetalheMLPedido> }) {
  // `chave` já é `pack_id ?? order_id`, e a rota aceita os dois (ver `urlVendaML`). A rota antiga
  // `/vendas/pacote/…` foi descontinuada pelo ML e devolvia 301 para a lista de vendas.
  const urlVenda = urlVendaML(p.chave);
  const numero = p.isPack ? p.chave : String(p.orderIds[0]);
  const local = [p.cidade, p.uf].filter(Boolean).join('/');
  const envio = [labelLogisticaEnvio(p.shipping_logistic), p.shipping_status ? labelStatusEnvio(p.shipping_status, p.shipping_substatus).label : null]
    .filter(Boolean).join(' · ');
  const nome = nomeExibicaoComprador(p);
  const d = ml.data;
  return (
    <section aria-label="Pedido" className="min-w-0 @3xl:pr-5">
      <h3 className={TITULO_ZONA}>Pedido</h3>
      <div className="space-y-1 text-xs text-muted-foreground">
        <div>
          <div className="truncate text-sm font-medium text-foreground" title={nome}>{nome}</div>
          {p.comprador_nome && p.comprador_nick && <div>@{p.comprador_nick}</div>}
        </div>
        <div className="flex items-center gap-1">
          <span>{p.isPack ? 'Pack' : 'Pedido'}</span>
          <span className="font-medium text-foreground tabular-nums">{numero}</span>
          <BotaoCopiar texto={numero} rotulo={p.isPack ? 'Copiar número do pack' : 'Copiar número do pedido'} />
          {p.isPack && <span className="ml-1 rounded bg-muted px-1.5 py-px text-[11px]">{p.orderIds.length} pedidos</span>}
        </div>
        <div className="tabular-nums">{fmtDataHora(p.data)}</div>
        {local && <div>{local}</div>}
        {envio && <div>Envio <span className="font-medium text-foreground">{envio}</span></div>}
        {ml.isError && <div>Pagamento indisponível</div>}
        {ml.isPending && <Skeleton data-testid="pagamento-carregando" className="h-4 w-40" />}
        {d && d.pagamentos.length > 0 && (
          <div className="break-words" title={d.aprovadoEm ? `Aprovado em ${fmtDataHora(d.aprovadoEm)}` : undefined}>
            Pagamento <span className="font-medium text-foreground">{d.pagamentos.join(' + ')}</span>
          </div>
        )}
        {d && d.freteComprador > 0 && (
          <div>Frete pago pelo comprador <span className="font-medium text-foreground tabular-nums">{fmtBRL(d.freteComprador)}</span></div>
        )}
        {/* ADR-0180: `raw.coupon` não diz quem pagou. Com cupom do vendedor gravado (coupon_fee do MP),
            ele já aparece no Dinheiro; sem ele, o cupom do pedido foi bancado pelo ML. */}
        {d && d.cupom > 0 && cupomDoVendedor(p) < 0.01 && (
          <div>Cupom pago pelo ML <span className="font-medium text-foreground tabular-nums">{fmtBRL(d.cupom)}</span></div>
        )}
        <a href={urlVenda} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 pt-1 text-info hover:underline">
          Ver no Mercado Livre <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </section>
  );
}

function ZonaItens({ p, liquidoBruto, destaque, linkSku }: {
  p: Pedido; liquidoBruto: boolean; linkSku: boolean;
  destaque?: { codigos: ReadonlySet<string>; rotulo: string };
}) {
  return (
    <section aria-label="Itens" className="min-w-0 border-t pt-4 @3xl:border-l @3xl:border-t-0 @3xl:px-5 @3xl:pt-0">
      <h3 className={TITULO_ZONA}>{p.itens.length > 1 ? `${p.itens.length} itens` : 'Itens'}</h3>
      <ul className="divide-y">
        {p.itens.map((it) => (
          <ItemBloco key={it.id} it={it} liquidoBruto={liquidoBruto} linkSku={linkSku}
            destacado={!!destaque && destaque.codigos.has(it.codigo?.trim() ?? '')} rotulo={destaque?.rotulo} />
        ))}
      </ul>
    </section>
  );
}

function ItemBloco({ it, liquidoBruto, linkSku, destacado, rotulo }: {
  it: ItemPedido; liquidoBruto: boolean; linkSku: boolean; destacado: boolean; rotulo?: string;
}) {
  const mCor = it.markup == null ? undefined : it.markup >= 0 ? 'text-success' : 'text-destructive';
  // O "estornado" do pedido não dizia de qual item vinha (pack 2000014844302469).
  const marca = [!it.faturavel && 'cancelado', it.estorno > 0 && `estornado ${fmtBRL(it.estorno)}`]
    .filter(Boolean).join(' · ');
  const nomeItem = formatarNomeProduto(it.titulo);
  const codigo = it.codigo?.trim();
  return (
    <li className={cn('flex gap-3 py-2 text-xs first:pt-0 last:pb-0', destacado && 'rounded-md bg-primary/5 px-2')}>
      <ThumbProduto path={it.imagem_path} titulo={it.titulo} size={40} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="truncate text-sm font-medium" title={nomeItem}>{nomeItem || '—'}</div>
        {destacado && rotulo && <div className="text-[11px] font-medium text-primary">{rotulo}</div>}
        {marca && <div className="text-destructive">{marca}</div>}
        <div className="flex flex-wrap gap-x-2 text-muted-foreground">
          {codigo && (
            <span className="tabular-nums">
              Cód{' '}
              {linkSku
                ? <Link to={`/faturamento/sku/${encodeURIComponent(codigo)}`} className="underline-offset-2 hover:underline">{it.codigo}</Link>
                : it.codigo}
            </span>
          )}
          {it.ean && <span className="tabular-nums">EAN {it.ean}</span>}
          {it.cor && <span>Cor {it.cor}</span>}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 tabular-nums">
          <span>{it.quantity} × {fmtBRL(it.unit_price)}</span>
          <span className="text-muted-foreground">Custo {it.custo != null ? fmtBRL(it.custo) : '—'}</span>
          <span className="text-success">Líq {fmtBRL(liquidoBruto ? it.liquido + it.imposto : it.liquido)}</span>
          <span className={mCor ?? 'text-muted-foreground'}>Markup {it.markup != null ? fmtMarkup(it.markup) : '—'}</span>
        </div>
      </div>
    </li>
  );
}

function Linha({ op, rotulo, valor, subtotal, forte, cor }: {
  /** Sinal da conta (−, =) — decorativo, fora do texto do rótulo. */
  op?: string; rotulo: ReactNode; valor: ReactNode; subtotal?: boolean; forte?: boolean; cor?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-0.5', subtotal && 'border-t pt-1', forte && 'font-semibold')}>
      <dt className="flex min-w-0 items-baseline gap-1.5 text-muted-foreground">
        <span aria-hidden className="w-2.5 shrink-0 text-center">{op}</span>
        {op && <span className="sr-only">{op === '−' ? 'menos ' : 'igual a '}</span>}
        {rotulo}
      </dt>
      <dd className={cn('shrink-0 tabular-nums', forte ? 'text-sm' : 'text-foreground', cor)}>{valor}</dd>
    </div>
  );
}

/** Cupom bancado pelo vendedor nos itens faturáveis (ADR-0180) — já descontado da Venda. */
function cupomDoVendedor(p: Pedido): number {
  return p.itens.reduce((s, it) => s + (it.faturavel ? it.cupom_vendedor : 0), 0);
}

function ZonaDinheiro({ p, tipoAnuncio }: { p: Pedido; tipoAnuncio: string | null }) {
  const c = cascataDoPedido(p);
  const semCusto = c.custo == null;
  const parcial = !semCusto && !c.custoCompleto;
  const liberacao = statusLiberacao({
    money_release_date: p.money_release_date, sacado_em: p.sacado_em,
    temMembrosSemDataLiberacao: p.temMembrosSemDataLiberacao, faturavel: p.faturavel,
  });
  const dataLiberacao = liberacao === 'sacado' ? p.sacado_em : p.money_release_date;
  const textoLiberacao = liberacao === 'sacado' ? 'Sacado em'
    : liberacao === 'liberado' ? 'Liberado em'
      : liberacao === 'aliberar' ? 'Libera em' : null;
  const foraDaConta = p.bruto - p.brutoFaturavel;
  const cupomVendedor = cupomDoVendedor(p);
  const corMargem = c.margem != null ? (c.margem >= 0 ? 'text-success' : 'text-destructive') : undefined;
  return (
    <section aria-label="Dinheiro" className="min-w-0 border-t pt-4 @3xl:border-l @3xl:border-t-0 @3xl:pl-5 @3xl:pt-0">
      <h3 className={TITULO_ZONA}>Dinheiro</h3>
      <dl className="text-xs">
        <Linha rotulo="Venda" valor={fmtBRL(c.venda)} />
        {cupomVendedor >= 0.01 && (
          <div className="pl-4 text-[11px] text-muted-foreground">
            <dt className="sr-only">Cupom do vendedor</dt>
            <dd>já sem {fmtBRL(cupomVendedor)} de cupom do vendedor</dd>
          </div>
        )}
        {foraDaConta >= 0.01 && (
          <div className="pl-4 text-[11px] text-muted-foreground">
            <dt className="sr-only">Fora do faturamento</dt>
            <dd>{fmtBRL(foraDaConta)} fora do faturamento (cancelado/devolvido)</dd>
          </div>
        )}
        <Linha op="−" rotulo={tipoAnuncio ? `Comissão ${tipoAnuncio}` : 'Comissão ML'} valor={fmtBRL(c.comissao)} />
        <Linha op="−" rotulo="Frete vendedor" valor={p.frete != null && p.faturavel ? fmtBRL(c.frete) : '—'} />
        {Math.abs(c.ajustes) >= 0.01 && (
          // `ajustes` é o que ainda sai da venda até o líquido: positivo = desconto (−), negativo = crédito (+).
          <Linha rotulo="Outros ajustes" valor={c.ajustes > 0 ? `−${fmtBRL(c.ajustes)}` : `+${fmtBRL(-c.ajustes)}`} />
        )}
        <Linha op="=" subtotal rotulo="Líquido após ML" valor={fmtBRL(c.recebido)} />
        <Linha op="−" rotulo={c.aliquotaPct != null ? `Imposto ${PCT.format(c.aliquotaPct)}%` : 'Imposto'} valor={fmtBRL(c.imposto)} />
        <Linha op="−" rotulo="Custo" valor={c.custo != null ? `${fmtBRL(c.custo)}${parcial ? ' (parcial)' : ''}` : '—'} />
        <Linha op="=" subtotal forte cor={corMargem} rotulo="Lucro"
          valor={c.margem != null ? fmtBRLSinal(c.margem) : '—'} />
      </dl>
      <div className="mt-1 space-y-0.5 pl-4 text-[11px] text-muted-foreground tabular-nums">
        {/* Mesmo rótulo e base de Vendas SKU (ADR-0150): lucro ÷ preço de venda. */}
        {c.margemPct != null && <div>Margem s/ venda {PCT.format(Math.round(c.margemPct * 10) / 10)}%</div>}
        {c.markup != null && <div>Markup {fmtMarkup(c.markup)}</div>}
        {/* Pedido cancelado zera o custo do total: aí não falta cadastro, só não há venda. */}
        {semCusto && p.faturavel && <div>Cadastre o custo para ver a margem</div>}
        {parcial && <div>Custo incompleto</div>}
        {p.estorno >= 0.01 && <div>Estornado ao comprador {fmtBRL(p.estorno)} (fora da conta)</div>}
      </div>
      {textoLiberacao && dataLiberacao && (
        <div className={cn(
          'mt-2 border-t pt-2 text-xs tabular-nums',
          liberacao === 'sacado' ? 'text-primary' : liberacao === 'liberado' ? 'text-success' : 'text-warning',
        )} title={labelStatusLiberacao(liberacao)}>
          {textoLiberacao} {fmtDataCurta(dataLiberacao)}
        </div>
      )}
    </section>
  );
}
