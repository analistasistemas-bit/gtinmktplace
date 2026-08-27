// Sonar (ADR-0120): garimpo on-demand de um nicho do Mercado Livre, par do Radar (Pulse.tsx),
// que vigia o que já vendemos. O Sonar varre ANTES de cadastrar o produto.
//
// ADR-0127: a tabela nasce da Apify (por anúncio real da busca), não mais do catálogo do ML —
// fichas de catálogo podiam listar produtos mortos, sem nenhum anúncio ativo vendendo.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BadgeCheck, Check, Circle, CircleDollarSign, Clock, ExternalLink, Filter, Globe, Loader2,
  Package, Receipt, Search, ShoppingCart, Store, Trash2, Trophy, Truck, X, Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { KpiCard } from '@/components/ui/kpi-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Sparkline } from '@/components/ui/sparkline';
import { DialogMargemSonar, type AnuncioSimulavel } from '@/components/pulse/dialog-margem-sonar';
import { VereditoSonar } from '@/components/pulse/veredito-sonar';
import {
  lerBuscasRecentes, limparBuscasRecentes, registrarBusca, tempoRelativo, type BuscaRecente,
} from '@/lib/sonar-buscas-recentes';
import { calcularVereditoAnuncios, contextoNichoAnuncios } from '@/lib/veredito-sonar';
import {
  fetchCruzamentoEan, fetchSonarPorEan, fetchVendasSonar, fetchVisitasSonar, itensDaAmostra,
  linkDoAnuncio, normalizarSerieVisitas, passosProgresso,
  type CruzamentoEan, type EtapaProgresso, type ItemVendasSonar, type OfertaEan,
  type PainelVendasSonar, type RaioXNicho, type ResultadoEanCatalogado, type VisitasAnuncio,
} from '@/lib/sonar';
import {
  aplicarFiltrosAnuncios, temFiltroAnunciosAtivo, FILTROS_ANUNCIOS_VAZIOS, type FiltrosAnuncios,
} from '@/lib/sonar-filtros';
import { BorderTrail } from '@/components/ui/border-trail';
import { Logo } from '@/components/ui/logo';
import { calcularTarifaML } from '@/lib/tarifa';
import { useAliquotas } from '@/hooks/useConfiguracoes';
import { fmtBRL, fmtInt, fmtMilhar } from '@/lib/formato';

// Detecta EAN/GTIN no campo de busca (ADR-0127 Errata 1) — espelho de
// supabase/functions/_shared/pulse/entrada.ts (regex Deno não é importável no bundle Vite).
const EAN_RE = /^\d{8,14}$/;

function SonarProgresso({ passos }: { passos: EtapaProgresso[] }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border p-4">
      {passos.map((p) => (
        <div key={p.label} className="flex items-center gap-2 text-sm">
          {p.status === 'concluida' ? (
            <Check className="h-4 w-4 shrink-0 text-success" />
          ) : p.status === 'ativa' ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          ) : (
            <Circle className="h-4 w-4 shrink-0 text-muted-foreground/30" />
          )}
          <span className={p.status === 'pendente' ? 'text-muted-foreground' : ''}>{p.label}</span>
        </div>
      ))}
    </div>
  );
}

// Raio-X do nicho: contagens da mesma amostra já paga da Apify (custo extra zero) + o total de
// anúncios que o ML imprime na página de busca. Itens com valor null são omitidos, nunca zerados.
function RaioXBarra({ raioX }: { raioX: RaioXNicho }) {
  const itens = [
    { icone: Receipt, label: 'Ticket médio', valor: raioX.ticket_medio != null ? fmtBRL(raioX.ticket_medio) : null, amostra: true },
    { icone: Store, label: 'Lojas oficiais', valor: String(raioX.lojas_oficiais), amostra: true },
    { icone: Zap, label: 'Full', valor: String(raioX.full), amostra: true },
    { icone: Truck, label: 'Frete grátis', valor: String(raioX.frete_gratis), amostra: true },
    { icone: Globe, label: 'Internacionais', valor: String(raioX.internacionais), amostra: true },
    {
      icone: BadgeCheck,
      label: 'Total de anúncios',
      valor: raioX.total_anuncios != null ? fmtMilhar(raioX.total_anuncios, 1) : null,
      amostra: false,
    },
  ].filter((i) => i.valor !== null);
  if (itens.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t pt-2.5">
      {itens.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-xs">
          <i.icone className="h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
          <span className="text-muted-foreground">{i.label}:</span>
          <span className="font-semibold tabular-nums">{i.valor}</span>
        </span>
      ))}
      <span className="text-[11px] text-muted-foreground/70">
        · contagens na amostra; total é do nicho inteiro
      </span>
    </div>
  );
}

// Bloco de vendas estimadas (ADR-0122): renderiza junto com o resto do painel — D16 já resolveu
// "sem token"/erro/carregando antes deste ponto (a página só chega aqui com `vendas.configurado`).
export function SonarVendas({ resp }: { resp: PainelVendasSonar }) {
  const destaque = resp.produto_destaque;
  // D15: mesma regra do link cru vs. canônico da coluna de ações, aplicada ao destaque.
  const hrefDestaque = destaque ? linkDoAnuncio(destaque.link, destaque.item_id ?? '') : null;
  return (
    <Card className="mb-4 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Vendas do nicho</span>
        <Badge variant="outline">estimativa · via Apify</Badge>
        <span className="text-xs text-muted-foreground">
          amostra dos {resp.itens_analisados} anúncios mais relevantes — "+N vendidos" acumulado,
          piso do nicho e não venda mensal
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          size="compact"
          label="Vendas acumuladas"
          // "unidades" explícito: sem a palavra o número passa por valor em reais (dúvida real do
          // Diego em 18/08). Quem é valor é o card ao lado.
          value={`≈ ${fmtMilhar(resp.vendas_totais, 1)} unidades`}
          hint={`${resp.itens_com_vendas} de ${resp.itens_analisados} anúncios com o dado`}
          icon={ShoppingCart}
          tom="info"
        />
        <KpiCard
          size="compact"
          label="Mercado endereçável"
          value={`≈ R$ ${fmtMilhar(resp.valor_mercado, 1)}`}
          hint="Σ preço × vendidos acumulados"
          icon={CircleDollarSign}
          tom="info"
        />
        {destaque && (
          <div className="flex items-center gap-3 rounded-lg border p-3">
            {destaque.imagem && (
              <img src={destaque.imagem} alt="" className="h-12 w-12 shrink-0 rounded bg-white object-contain" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Trophy className="h-3.5 w-3.5 text-warning" /> Produto destaque
              </div>
              {hrefDestaque ? (
                <a
                  href={hrefDestaque}
                  target="_blank"
                  rel="noreferrer"
                  title={destaque.titulo}
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {destaque.titulo}
                </a>
              ) : (
                <div className="truncate text-sm font-medium" title={destaque.titulo}>{destaque.titulo}</div>
              )}
              <div className="text-xs text-muted-foreground">
                {destaque.vendidos != null ? `≈ ${fmtMilhar(destaque.vendidos, 1)} vendidos` : '— vendidos'}
                {destaque.preco != null && ` · ${fmtBRL(destaque.preco)}`}
              </div>
            </div>
          </div>
        )}
      </div>
      {resp.raio_x && <RaioXBarra raioX={resp.raio_x} />}
      {resp.palavras_chave_titulos.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">
            Palavras-chave dos títulos dos anúncios
          </div>
          <div className="flex flex-wrap gap-1.5">
            {resp.palavras_chave_titulos.slice(0, 15).map((p) => (
              <Badge key={p.termo} variant="secondary">{p.termo} ({p.contagem})</Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// Busca por EAN (ADR-0127 Errata 1): produto específico, não nicho. O lookup oficial de catálogo
// é grátis; "vendidos" só entra sob escolha explícita do operador, porque usa Apify (tem custo).
function SonarEanEscolha({ ean, onEscolher }: { ean: string; onEscolher: (comVendas: boolean) => void }) {
  return (
    <Card className="max-w-md p-4">
      <p className="mb-3 text-sm font-medium">Como consultar o EAN {ean}?</p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => onEscolher(false)}
          className="flex items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-accent"
        >
          <div>
            <div className="text-sm font-medium">Consultar grátis</div>
            <div className="text-xs text-muted-foreground">sem número de vendidos</div>
          </div>
          <Badge variant="outline" className="border-success/40 text-success">grátis</Badge>
        </button>
        <button
          type="button"
          onClick={() => onEscolher(true)}
          className="flex items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-accent"
        >
          <div>
            <div className="text-sm font-medium">Consultar com vendidos</div>
            <div className="text-xs text-muted-foreground">usa dados pagos (Apify) — tem custo por consulta</div>
          </div>
          <Badge variant="outline" className="border-warning/40 text-warning">tem custo</Badge>
        </button>
      </div>
    </Card>
  );
}

// Resultado da busca por EAN: view PRÓPRIA e enxuta — NÃO reaproveita SonarVendas/RaioXBarra/
// VereditoSonar (conceitos de NICHO: ticket médio, lojas oficiais, "vencedor do nicho" não fazem
// sentido para 1 produto já identificado pelo EAN).
/**
 * Espera da consulta por EAN. Três skeletons cinzentos não diziam o que estava acontecendo — e a
 * consulta pode passar de um minuto quando o EAN é novo (sem cache). Aqui a marca fica visível
 * pulsando, a trilha corre na borda enquanto durar, e o texto diz a etapa.
 */
export function SonarEanCarregando({ ean, comVendas }: { ean: string; comVendas: boolean }) {
  return (
    <BorderTrail active radius={12}>
      <div
        role="status"
        aria-live="polite"
        className="relative z-[2] flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-12 text-center"
      >
        <Logo className="animate-pulse" symbolClassName="h-9 w-9" wordmarkClassName="text-lg" />
        <p className="text-sm font-medium">Consultando o EAN {ean} no Mercado Livre</p>
        <p className="max-w-md text-xs text-muted-foreground">
          {comVendas
            ? 'Lendo a ficha do catálogo e buscando os vendidos. A busca de vendidos é a parte lenta — pode levar alguns minutos.'
            : 'Lendo a ficha do catálogo e as ofertas ativas. Da segunda vez o mesmo EAN responde na hora.'}
        </p>
      </div>
    </BorderTrail>
  );
}

/**
 * "Se eu vender pelo preço do mercado, quanto sobra?" (ADR-0127 Errata 2) — a pergunta que a
 * consulta por EAN existia sem responder. Uma chamada só, no menor preço ativo: é o piso que o
 * analista teria de bater para entrar. Reusa `calcular-tarifa-ml`, que já é a fonte oficial de
 * comissão/frete do app e já tem cache por (org, categoria, preço).
 * O frete sai das dimensões DEFAULT do ML — o produto não é nosso, não temos as reais.
 */
function SonarEanLiquido({ preco, categoriaMlId }: { preco: number; categoriaMlId: string }) {
  const { data: tarifa, isLoading } = useQuery({
    queryKey: ['pulse', 'sonar-ean-tarifa', categoriaMlId, preco],
    queryFn: () => calcularTarifaML(preco, categoriaMlId),
    staleTime: Infinity,
  });
  if (isLoading) {
    return <Skeleton className="mb-3 h-12 w-full max-w-xl rounded-lg" />;
  }
  // `null` = a edge recusou (sem conexão ML, categoria sem tabela). Silêncio é melhor que um
  // número inventado numa tela de decisão de preço.
  if (!tarifa) return null;
  return (
    <div className="mb-3 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <span className="font-medium">Vendendo a {fmtBRL(preco)}</span>
        <span className="text-muted-foreground">
          comissão <strong className="font-semibold text-foreground">{fmtBRL(tarifa.classico.comissao)}</strong>
        </span>
        <span className="text-muted-foreground">
          frete <strong className="font-semibold text-foreground">{fmtBRL(tarifa.frete)}</strong>
        </span>
        <span className="text-success">
          você recebe <strong className="font-semibold">{fmtBRL(tarifa.classico.recebe)}</strong>
        </span>
        <span className="text-muted-foreground">
          (Premium: {fmtBRL(tarifa.premium.recebe)})
        </span>
      </div>
      <SonarEanImposto preco={preco} recebe={tarifa.classico.recebe} />
    </div>
  );
}

/**
 * Imposto sobre o líquido (ADR-0055). O produto do Sonar não é nosso: não dá para saber a origem,
 * e presumir alíquota é o que a regra LOUD proíbe. Então mostra as DUAS, com os percentuais
 * configurados da org — quem lê escolhe a linha do seu caso. Alíquota não confirmada não vira
 * número: vira o aviso de ir confirmar.
 */
export function SonarEanImposto({ preco, recebe }: { preco: number; recebe: number }) {
  const { data: aliquotas, isLoading, isError } = useAliquotas();
  if (isLoading) return null;
  if (isError || !aliquotas?.confirmada) {
    return (
      <div className="mt-1.5 border-t pt-1.5 text-muted-foreground">
        Imposto fora da conta: confirme as alíquotas da organização em Configurações.
      </div>
    );
  }
  const liquido = (pct: number) => fmtBRL(recebe - preco * (pct / 100));
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 border-t pt-1.5 text-muted-foreground">
      <span>menos imposto —</span>
      <span>
        nacional {aliquotas.nacional}%: <strong className="font-semibold text-foreground">{liquido(aliquotas.nacional)}</strong>
      </span>
      <span>
        importado {aliquotas.importado}%: <strong className="font-semibold text-foreground">{liquido(aliquotas.importado)}</strong>
      </span>
    </div>
  );
}

/**
 * "Eu já vendo isto?" (ADR-0127 Errata 2). A ausência também informa — produto que não está nem no
 * catálogo nem no Radar é oportunidade nova, e o operador precisa ver isso dito, não deduzido de
 * um espaço em branco.
 */
function SonarEanCruzamento({ cruzamento }: { cruzamento: CruzamentoEan }) {
  const { minhas, no_radar } = cruzamento;
  if (minhas.length === 0 && !no_radar) {
    return (
      <p className="mb-3 text-xs text-muted-foreground">
        Produto novo para a operação: não está no seu catálogo nem no Radar.
      </p>
    );
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {minhas.length > 0 && (
        <span className="font-medium text-success">
          Você já vende: {minhas.map((v) => `${v.codigo} (${fmtBRL(v.preco)})`).join(' · ')}
        </span>
      )}
      {no_radar && (
        <span className="text-muted-foreground">
          Já está no seu Radar{no_radar.status !== 'ativo' ? ` (${no_radar.status})` : ''}
        </span>
      )}
    </div>
  );
}

export function SonarEanResultado({ resp, cruzamento, visitas, onNovaConsulta }: {
  resp: ResultadoEanCatalogado;
  cruzamento?: CruzamentoEan;
  /** `undefined` = ainda carregando; `null` no item = falha da chamada; `total: 0` = zero medido. */
  visitas?: Record<string, VisitasAnuncio | null>;
  onNovaConsulta: () => void;
}) {
  // Menor preço ATIVO do produto: é o número contra o qual o analista teria de competir, e é
  // sobre ele que o líquido por venda faz sentido.
  const precos = resp.ofertas.map((o) => o.preco).filter((p): p is number => p != null && p > 0);
  const menorPreco = precos.length ? Math.min(...precos) : null;
  const colunas: Column<OfertaEan>[] = [
    {
      key: 'preco', header: 'Preço', className: 'tabular-nums',
      cell: (o) => (o.preco != null ? fmtBRL(o.preco) : '—'),
      sortValue: (o) => o.preco,
    },
    {
      // Nome resolvido na edge (1 chamada por vendedor distinto). Sem perfil legível, cai no id:
      // um número identifica menos, mas ainda é melhor que campo vazio.
      key: 'vendedor', header: 'Vendedor',
      cell: (o) => o.vendedor_nome ?? (o.seller_id != null ? String(o.seller_id) : '—'),
      sortValue: (o) => o.vendedor_nome ?? o.seller_id,
    },
    {
      key: 'frete', header: 'Frete grátis',
      cell: (o) => (o.frete_gratis ? <Badge variant="outline">Sim</Badge> : '—'),
    },
    {
      key: 'full', header: 'Full',
      cell: (o) => (o.full ? <Badge variant="outline">FULL</Badge> : '—'),
    },
    {
      // Demanda real da oferta, sem passar pela Apify: mesma edge (e mesmo cache por item) que a
      // tabela do nicho usa. `total: 0` é zero MEDIDO e se escreve 0 — só ausência vira "—".
      key: 'visitas', header: 'Visitas 30d', className: 'tabular-nums',
      cell: (o) => {
        if (!o.item_id) return '—';
        if (!visitas) return <span className="text-muted-foreground">…</span>;
        const v = visitas[o.item_id];
        return v ? fmtInt(v.total) : <span title="Não foi possível medir as visitas deste anúncio">—</span>;
      },
      sortValue: (o) => (o.item_id ? visitas?.[o.item_id]?.total ?? null : null),
    },
    {
      key: 'vendidos', header: 'Vendidos', className: 'tabular-nums',
      cell: (o) => (o.vendidos != null
        ? <span title="Acumulado da vida do anúncio, faixa piso do ML">+{fmtInt(o.vendidos)}</span>
        // Tooltip depende de resp.com_vendas: "—" sozinho não distingue "não paguei por isso" de
        // "paguei e a Apify não capturou este anúncio" — a operadora precisa saber qual dos dois.
        : <span title={resp.com_vendas
          ? 'Consultado (Apify), mas este anúncio ficou fora da amostra capturada'
          : 'Consulta grátis: vendidos não foi consultado'}>—</span>),
      sortValue: (o) => o.vendidos,
    },
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{resp.nome_produto ?? `Produto ${resp.product_id}`}</div>
          {/* O badge qualifica a CONSULTA, não o produto: colado no nome, "grátis" era lido como
              se o item fosse de graça. Fica na linha dos metadados, com o rótulo completo. */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>EAN {resp.ean} · {resp.ofertas.length} oferta{resp.ofertas.length === 1 ? '' : 's'}</span>
            {resp.com_vendas ? (
              <Badge variant="outline" className="border-warning/40 text-warning">consulta com vendidos</Badge>
            ) : (
              <Badge variant="outline" className="border-success/40 text-success">consulta grátis</Badge>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onNovaConsulta}>Nova consulta</Button>
      </div>
      {/* Já vinha na resposta (e no cache) desde a Errata 1, só não era renderizada: é o que
          confirma que o EAN bateu na ficha certa, além do nome. */}
      {resp.descricao_catalogo && (
        <p className="mb-3 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          {resp.descricao_catalogo}
        </p>
      )}
      {cruzamento && <SonarEanCruzamento cruzamento={cruzamento} />}
      {resp.categoria_ml_id && menorPreco != null && (
        <SonarEanLiquido preco={menorPreco} categoriaMlId={resp.categoria_ml_id} />
      )}
      {resp.vendas_indisponivel && (
        <p className="mb-2 text-xs text-warning">
          Vendidos indisponível nesta consulta (Apify sem token configurado, ou a busca falhou).
        </p>
      )}
      <DataTable
        columns={colunas}
        rows={resp.ofertas}
        rowKey={(o) => o.item_id ?? `${o.seller_id}-${o.preco}`}
        empty={<EmptyState icon={Package} title="Sem ofertas ativas para este produto." />}
      />
    </div>
  );
}

// Popover de filtros (D13/ADR-0127): a tabela inteira agora nasce da Apify — ou tem tudo, ou não
// tem tabela (D16) — então todos os controles renderizam sempre, sem condicional de grupo.
function SonarFiltrosPopover({ filtros, setFiltros }: {
  filtros: FiltrosAnuncios;
  setFiltros: (f: FiltrosAnuncios) => void;
}) {
  const num = (v: string) => {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Filter className="mr-1.5 h-3.5 w-3.5" />
          Filtros
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <label htmlFor="sonar-filtro-preco-min" className="text-xs">
              Preço mín.
              <Input
                id="sonar-filtro-preco-min"
                type="number"
                inputMode="decimal"
                value={filtros.precoMin ?? ''}
                onChange={(e) => setFiltros({ ...filtros, precoMin: num(e.target.value) })}
                className="mt-1"
              />
            </label>
            <label htmlFor="sonar-filtro-preco-max" className="text-xs">
              Preço máx.
              <Input
                id="sonar-filtro-preco-max"
                type="number"
                inputMode="decimal"
                value={filtros.precoMax ?? ''}
                onChange={(e) => setFiltros({ ...filtros, precoMax: num(e.target.value) })}
                className="mt-1"
              />
            </label>
            <label htmlFor="sonar-filtro-min-visitas" className="text-xs">
              Mín. visitas (30d)
              <Input
                id="sonar-filtro-min-visitas"
                type="number"
                inputMode="numeric"
                value={filtros.minVisitas ?? ''}
                onChange={(e) => setFiltros({ ...filtros, minVisitas: num(e.target.value) })}
                className="mt-1"
              />
            </label>
            <label htmlFor="sonar-filtro-min-vendas" className="text-xs">
              Mín. vendas (acum.)
              <Input
                id="sonar-filtro-min-vendas"
                type="number"
                inputMode="numeric"
                value={filtros.minVendas ?? ''}
                onChange={(e) => setFiltros({ ...filtros, minVendas: num(e.target.value) })}
                className="mt-1"
              />
            </label>
            <label htmlFor="sonar-filtro-min-nota" className="text-xs">
              Nota mín.
              <Input
                id="sonar-filtro-min-nota"
                type="number"
                inputMode="decimal"
                min={0}
                max={5}
                value={filtros.minNota ?? ''}
                onChange={(e) => setFiltros({ ...filtros, minNota: num(e.target.value) })}
                className="mt-1"
              />
            </label>
          </div>
          <div className="flex flex-col gap-2 border-t pt-2.5">
            <label htmlFor="sonar-filtro-so-full" className="flex items-center justify-between text-sm">
              Só FULL
              <Switch
                id="sonar-filtro-so-full"
                checked={filtros.soFull}
                onCheckedChange={(v) => setFiltros({ ...filtros, soFull: v })}
              />
            </label>
            <label htmlFor="sonar-filtro-so-desconto" className="flex items-center justify-between text-sm">
              Só com desconto ativo
              <Switch
                id="sonar-filtro-so-desconto"
                checked={filtros.soComDesconto}
                onCheckedChange={(v) => setFiltros({ ...filtros, soComDesconto: v })}
              />
            </label>
            <label htmlFor="sonar-filtro-esconder-patrocinados" className="flex items-center justify-between text-sm">
              Esconder patrocinados
              <Switch
                id="sonar-filtro-esconder-patrocinados"
                checked={filtros.esconderPatrocinados}
                onCheckedChange={(v) => setFiltros({ ...filtros, esconderPatrocinados: v })}
              />
            </label>
            <label htmlFor="sonar-filtro-esconder-oficial" className="flex items-center justify-between text-sm">
              Esconder loja oficial
              <Switch
                id="sonar-filtro-esconder-oficial"
                checked={filtros.esconderLojaOficial}
                onCheckedChange={(v) => setFiltros({ ...filtros, esconderLojaOficial: v })}
              />
            </label>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function PulseSonar() {
  const [termo, setTermo] = useState('');
  const [termoBuscado, setTermoBuscado] = useState<string | null>(null);
  const [, forcarRender] = useState(0);
  const iniciadoEmRef = useRef(0);
  // Refoco após a escolha grátis/com vendidos e após "Nova consulta" (ADR-0127 Errata 1): o
  // leitor físico de código de barras precisa do campo focado para o próximo scan — sem isso, o
  // 2º produto escaneado logo após escolher "grátis"/"com vendidos" se perde no vazio.
  const inputRef = useRef<HTMLInputElement>(null);
  const [anuncioSimulando, setAnuncioSimulando] = useState<AnuncioSimulavel | null>(null);
  const [buscasRecentes, setBuscasRecentes] = useState<BuscaRecente[]>(lerBuscasRecentes);
  // Mantém o stepper visível um instante depois da resposta chegar, para mostrar as etapas
  // concluídas antes de trocar pelo resultado.
  const [mostrarProgresso, setMostrarProgresso] = useState(false);
  // Filtros da tabela (D13): 100% client-side, estado local — sem URL/localStorage nesta entrega.
  const [filtros, setFiltros] = useState<FiltrosAnuncios>(FILTROS_ANUNCIOS_VAZIOS);

  // Busca por EAN (ADR-0127 Errata 1): eanPendente = EAN detectado, aguardando escolha
  // grátis/com vendidos; eanBuscado = escolha feita, dispara a query abaixo.
  const [eanPendente, setEanPendente] = useState<string | null>(null);
  const [eanBuscado, setEanBuscado] = useState<{ ean: string; comVendas: boolean } | null>(null);

  // Query PRIMÁRIA (ADR-0127/D3): a tabela nasce da Apify. retry desligado — cada tentativa
  // sem cache dispara um run pago (US$ 0,10).
  const { data: vendas, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['pulse', 'sonar-vendas', termoBuscado],
    queryFn: () => fetchVendasSonar(termoBuscado!),
    enabled: !!termoBuscado,
    staleTime: Infinity,
    retry: false,
  });

  // retry desligado pelo mesmo motivo: "com vendidos" dispara Apify (custo por tentativa).
  const {
    data: resultadoEan, isFetching: eanCarregando, isError: eanErro, error: eanErroObj, refetch: refetchEan,
  } = useQuery({
    queryKey: ['pulse', 'sonar-ean', eanBuscado?.ean, eanBuscado?.comVendas],
    queryFn: () => fetchSonarPorEan(eanBuscado!.ean, eanBuscado!.comVendas),
    enabled: !!eanBuscado,
    staleTime: Infinity,
    retry: false,
  });

  // Leitura local (RLS), sem ML: chave pelo product_id porque o cruzamento com o Radar é por
  // ficha de catálogo, não pelo EAN digitado. Falha aqui não derruba o resultado do EAN — o bloco
  // some e o resto da tela continua.
  const eanCatalogado = resultadoEan?.conectado && resultadoEan.catalogado ? resultadoEan : null;
  const { data: cruzamentoEan } = useQuery({
    queryKey: ['pulse', 'sonar-ean-cruzamento', eanCatalogado?.ean, eanCatalogado?.product_id],
    queryFn: () => fetchCruzamentoEan(eanCatalogado!.ean, eanCatalogado!.product_id),
    enabled: !!eanCatalogado,
    staleTime: 60_000,
  });

  // Visitas 30d das ofertas do EAN: mesma edge da tabela do nicho, que já tem cache global por
  // item (dado público). Não passa pela Apify — vale também na consulta grátis.
  const itemIdsEan = useMemo(
    () => (eanCatalogado?.ofertas ?? []).map((o) => o.item_id).filter((id): id is string => !!id),
    [eanCatalogado],
  );
  const { data: visitasEanResp } = useQuery({
    queryKey: ['pulse', 'sonar-ean-visitas', itemIdsEan],
    queryFn: () => fetchVisitasSonar(itemIdsEan.slice(0, 20)),
    enabled: itemIdsEan.length > 0,
    staleTime: Infinity,
  });
  const visitasEan = visitasEanResp?.conectado ? visitasEanResp.por_item : undefined;

  const itens = useMemo(
    () => (vendas?.configurado ? itensDaAmostra(vendas) : []),
    [vendas],
  );
  const itemIds = useMemo(
    () => itens.map((i) => i.item_id).filter((x): x is string => x != null),
    [itens],
  );

  // Visitas (D3): dispara quando a lista de anúncios chega. Grátis (API oficial) — retry ok.
  const { data: visitas, isFetching: visitasCarregando } = useQuery({
    queryKey: ['pulse', 'sonar-visitas', termoBuscado, itemIds],
    queryFn: () => fetchVisitasSonar(itemIds),
    enabled: itemIds.length > 0,
    staleTime: Infinity,
    retry: 1,
  });

  // D8: entrada ausente/null = "—" (falha ou sem conexão); {total: 0} = "0" (zero medido).
  const visitasPorItem = useMemo(() => {
    const map = new Map<string, VisitasAnuncio | null>();
    if (visitas?.conectado) {
      for (const [id, v] of Object.entries(visitas.por_item)) map.set(id, v);
    }
    return map;
  }, [visitas]);

  const visitasTotal = useMemo(() => {
    // LOUD: soma só o medido; nada medido → null, nunca 0.
    const medidos = [...visitasPorItem.values()].filter((v): v is VisitasAnuncio => v != null);
    return medidos.length > 0 ? medidos.reduce((a, v) => a + v.total, 0) : null;
  }, [visitasPorItem]);

  const carregando = isFetching || visitasCarregando;
  const { visiveis, excluidasSemDado } = useMemo(
    () => aplicarFiltrosAnuncios(itens, visitasPorItem, filtros),
    [itens, visitasPorItem, filtros],
  );

  // Avanço do stepper temporizado no cliente: cada edge responde numa chamada única.
  useEffect(() => {
    if (carregando) {
      if (iniciadoEmRef.current === 0) iniciadoEmRef.current = Date.now();
      setMostrarProgresso(true);
      forcarRender((n) => n + 1);
      const id = setInterval(() => forcarRender((n) => n + 1), 250);
      return () => clearInterval(id);
    }
    iniciadoEmRef.current = 0;
    const t = setTimeout(() => setMostrarProgresso(false), 400);
    return () => clearTimeout(t);
  }, [carregando]);

  const garimpar = (t: string) => {
    setTermo(t);
    // EAN é produto específico (não nicho): não dispara a busca direto, mostra a escolha
    // grátis/com vendidos primeiro — o registro em "buscas recentes" acontece só quando o
    // operador escolher (escolherConsultaEan), que é quando a consulta de fato roda.
    if (EAN_RE.test(t)) {
      setTermoBuscado(null);
      setEanBuscado(null);
      setEanPendente(t);
      return;
    }
    setEanPendente(null);
    setEanBuscado(null);
    setBuscasRecentes(registrarBusca(t));
    setTermoBuscado(t);
  };

  const buscar = (e: FormEvent) => {
    e.preventDefault();
    const t = termo.trim();
    if (EAN_RE.test(t)) { garimpar(t); return; }
    if (t.length < 3) { toast.error('Digite ao menos 3 caracteres para prospectar.'); return; }
    garimpar(t);
  };

  const escolherConsultaEan = (comVendas: boolean) => {
    if (!eanPendente) return;
    setBuscasRecentes(registrarBusca(eanPendente));
    setEanBuscado({ ean: eanPendente, comVendas });
    setEanPendente(null);
    setTermo('');
    inputRef.current?.focus();
  };

  // Sem `defaultSort`: a ordem que chega da amostra é o ranking de relevância do ML, e perder
  // isso ao abrir a tela custaria mais que a conveniência de já vir ordenado por alguma coluna.
  const colunas = useMemo<Column<ItemVendasSonar>[]>(() => [
    {
      key: 'posicao', header: '#', className: 'tabular-nums',
      cell: (i) => (
        <div>
          {i.posicao != null ? `#${i.posicao}` : <span title="Posição não veio na amostra">—</span>}
          {i.patrocinado === true && <Badge variant="outline" className="ml-1 text-[10px]">Patrocinado</Badge>}
        </div>
      ),
      sortValue: (i) => i.posicao,
    },
    {
      // `w-full` faz esta coluna absorver a folga da tabela: as numéricas ficam no tamanho do
      // conteúdo e o nome do produto — a informação que identifica a linha — leva o resto.
      key: 'anuncio', header: 'Anúncio', className: 'w-full max-w-[420px]',
      cell: (i) => (
        <div className="flex items-center gap-2">
          {i.imagem && <img src={i.imagem} alt="" className="h-9 w-9 shrink-0 rounded bg-white object-contain" />}
          <div className="min-w-0">
            <span className="block truncate" title={i.titulo}>{i.titulo}</span>
            {(i.selo || i.catalog_product_id) && (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {i.selo && <Badge variant="secondary" className="text-[10px]">{i.selo}</Badge>}
                {i.catalog_product_id && (
                  <Badge variant="outline" className="text-[10px]" title={`Anúncio vinculado à ficha ${i.catalog_product_id}`}>
                    Catálogo
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
      ),
      sortValue: (i) => i.titulo,
    },
    {
      key: 'preco', header: 'Preço', className: 'tabular-nums',
      cell: (i) => {
        if (i.preco == null) return '—';
        return (
          <div>
            <span className="font-medium">{fmtBRL(i.preco)}</span>
            {i.preco_anterior != null && i.desconto_pct != null && (
              <div className="text-xs text-muted-foreground">
                de <span className="line-through">{fmtBRL(i.preco_anterior)}</span> · {i.desconto_pct}% OFF
              </div>
            )}
          </div>
        );
      },
      sortValue: (i) => i.preco,
    },
    {
      key: 'vendidos', header: 'Vendidos', className: 'tabular-nums',
      cell: (i) => i.vendidos == null
        ? <span title="O ML não exibe o dado para este anúncio">—</span>
        : <span title="Acumulado da vida do anúncio, faixa piso do ML — não é ritmo">+{fmtMilhar(i.vendidos)}</span>,
      sortValue: (i) => i.vendidos,
    },
    {
      key: 'faturamento', header: 'Faturamento', className: 'tabular-nums',
      cell: (i) => i.vendidos == null || i.preco == null
        ? <span title="Sem vendidos ou preço — não derivamos">—</span>
        : <span title="≈ vendidos × preço atual — o preço pode ter variado ao longo da vida">≈ {fmtBRL(i.vendidos * i.preco)}</span>,
      sortValue: (i) => (i.vendidos != null && i.preco != null ? i.vendidos * i.preco : null),
    },
    {
      key: 'avaliacao', header: 'Avaliação', className: 'tabular-nums',
      cell: (i) => i.avaliacao_nota == null ? '—' : (
        <div>
          <span>★ {i.avaliacao_nota.toFixed(1)}</span>
          {i.avaliacao_qtd != null && <div className="text-xs text-muted-foreground">({i.avaliacao_qtd})</div>}
        </div>
      ),
      sortValue: (i) => i.avaliacao_nota,
    },
    {
      key: 'visitas', header: 'Visitas', className: 'tabular-nums',
      cell: (i) => {
        const v = i.item_id != null ? visitasPorItem.get(i.item_id) ?? null : null;
        // D8: null = falha/sem conexão → "—"; {total: 0} = ZERO MEDIDO → "0".
        if (v == null) return <span title="Não medido (falha ou organização sem conexão ML)">—</span>;
        return (
          <div className="flex items-center gap-2">
            <span>{fmtInt(v.total)}</span>
            <Sparkline dados={normalizarSerieVisitas(v.por_dia)} />
          </div>
        );
      },
      sortValue: (i) => (i.item_id != null ? visitasPorItem.get(i.item_id)?.total ?? null : null),
    },
    // Coluna "Loja" removida a pedido do operador (19/08/2026): o nome da loja não muda decisão
    // de garimpo. O campo `vendedor` CONTINUA sendo coletado — é dele que sai a contagem de
    // rótulos distintos que alimenta a pulverização no fator Disputa do veredito, e o
    // `loja_oficial` segue no Raio-X e no fator Marca.
    {
      key: 'envio', header: 'Envio', className: 'text-xs',
      cell: (i) => {
        const label = i.full === true ? 'FULL' : i.flex === true ? 'FLEX' : null;
        return (
          <div className="flex items-center gap-1">
            {label ? <Badge variant="outline">{label}</Badge> : '—'}
            {i.internacional === true && <Globe className="h-3.5 w-3.5 text-info" aria-label="Internacional" />}
          </div>
        );
      },
    },
    {
      key: 'acao', header: '', stickyRight: true,
      cell: (i) => {
        // D15: prioridade ao link da Apify (se bem formado); fallback = URL canônica do item_id.
        const href = linkDoAnuncio(i.link, i.item_id ?? '');
        return (
          <div className="flex items-center justify-end gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setAnuncioSimulando({
              id: i.item_id ?? i.titulo,
              nome: i.titulo,
              category_id: i.category_id ?? null,
              preco_referencia: i.preco,
            })} title="Simular margem deste anúncio">
              Simular
            </Button>
            {href && (
              <Button asChild variant="ghost" size="icon-sm">
                <a href={href} target="_blank" rel="noopener noreferrer"
                  aria-label={`Abrir "${i.titulo}" no Mercado Livre (nova aba)`} title="Abrir no Mercado Livre">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
          </div>
        );
      },
    },
  ], [visitasPorItem]);

  const elapsedMs = iniciadoEmRef.current ? Date.now() - iniciadoEmRef.current : 0;

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Prospecta um nicho do Mercado Livre antes de você cadastrar o produto — o par do Radar, que
        vigia o que você já vende.
      </p>

      <form onSubmit={buscar} className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Ex.: tecido oxford 10 metros, ou um EAN/GTIN de 8 a 14 dígitos"
            aria-label="Termo de busca ou EAN/GTIN no Sonar"
            className="h-9 pl-8"
            // Foco automático: é o que faz o leitor de código de barras físico (USB/Bluetooth,
            // emula teclado) funcionar sem clique prévio — o form já submete no Enter (padrão HTML).
            // eslint-disable-next-line jsx-a11y/no-autofocus -- único campo da tela, requisito do leitor físico
            autoFocus
          />
        </div>
        <Button type="submit" disabled={carregando || eanCarregando}>
          <Search className="mr-2 h-4 w-4" />
          Prospectar
        </Button>
      </form>

      {eanPendente ? (
        <SonarEanEscolha ean={eanPendente} onEscolher={escolherConsultaEan} />
      ) : eanBuscado ? (
        eanCarregando ? (
          <SonarEanCarregando ean={eanBuscado.ean} comVendas={eanBuscado.comVendas} />
        ) : eanErro ? (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
            <p className="text-sm font-medium text-destructive">
              Não foi possível consultar o EAN "{eanBuscado.ean}".
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {eanErroObj instanceof Error ? eanErroObj.message : 'Erro desconhecido.'}
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetchEan()}>
              Tentar de novo
            </Button>
          </div>
        ) : resultadoEan && !resultadoEan.conectado ? (
          // Mesmo padrão de degradação explícita das outras rotas do Sonar.
          <EmptyState
            icon={Search}
            title="Sem conexão com o Mercado Livre"
            description="Conecte uma conta do Mercado Livre para consultar EAN — é dado público, mas o lookup oficial exige token de alguma conta conectada."
          />
        ) : resultadoEan && resultadoEan.conectado && !resultadoEan.catalogado ? (
          <EmptyState
            icon={Package}
            title={`EAN "${eanBuscado.ean}" sem ficha de catálogo no Mercado Livre`}
            description="Não é erro — acontece com faixas GS1 internas (ex.: aviamento) ou produtos ainda não catalogados. Tente outro EAN ou busque por termo."
          />
        ) : resultadoEan && resultadoEan.conectado && resultadoEan.catalogado ? (
          <SonarEanResultado
            resp={resultadoEan}
            cruzamento={cruzamentoEan}
            visitas={visitasEan}
            onNovaConsulta={() => { setEanBuscado(null); setTermo(''); inputRef.current?.focus(); }}
          />
        ) : null
      ) : !termoBuscado ? (
        buscasRecentes.length > 0 ? (
          <Card className="max-w-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
                Buscas recentes
              </div>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { limparBuscasRecentes(); setBuscasRecentes([]); }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Limpar tudo
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {buscasRecentes.map((b) => (
                <button
                  key={b.termo}
                  type="button"
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => garimpar(b.termo)}
                >
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{b.termo}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {tempoRelativo(b.em, new Date())}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        ) : (
          <EmptyState
            icon={Search}
            title="O que o Sonar faz"
            description={
              'Varre um nicho do Mercado Livre antes de você cadastrar o produto: os anúncios reais '
              + 'da busca, vendas acumuladas, visitas e concorrência. Fonte: amostra dos 20 anúncios '
              + 'mais relevantes (via Apify) + visitas da API oficial.'
            }
          />
        )
      ) : mostrarProgresso ? (
        <SonarProgresso passos={passosProgresso(elapsedMs, !carregando)} />
      ) : vendas && !vendas.configurado ? (
        // D16 modo 1: sem APIFY_TOKEN → estado vazio explícito, nada de tabela fantasma.
        <EmptyState
          icon={Search}
          title="O Sonar depende da Apify"
          description={'A tabela de anúncios nasce da amostra Apify. Configure o token '
            + '(variável APIFY_TOKEN no backend) para prospectar. Sem ele não há dado — '
            + 'não mostramos tela vazia fingindo nicho morto.'}
        />
      ) : isError ? (
        // D16 modo 2: run falhou/estourou o teto → erro com termo, causa e retry.
        // NUNCA "0 anúncios encontrados" — mentiria dizendo que o nicho está vazio.
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">
            Não foi possível prospectar "{termoBuscado}".
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro desconhecido.'}
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : vendas?.configurado && itens.length === 0 && vendas.itens_analisados > 0 ? (
        // Discriminante `itens_analisados` (D16): cache v4 gravado ANTES desta entrega tem
        // itens_analisados > 0 mas não tem `itens`/`por_anuncio` (payload pré-ADR-0127) — migração
        // transitória, TTL 7 dias, desaparece sozinho. SEM botão de retry: refetch() bate na mesma
        // chave de cache e devolve o MESMO payload (decisão: sem force-refresh no backend, cada
        // run custa US$ 0,10 — não vira botão de queimar orçamento por impaciência).
        <div role="alert" className="rounded-lg border border-warning/30 bg-warning/10 p-4">
          <p className="text-sm font-medium text-warning">
            O resultado em cache para "{termoBuscado}" é de antes desta atualização.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Esse painel foi gravado antes de o Sonar passar a listar os anúncios da busca (em vez de
            fichas de catálogo) e não tem essa lista. Ele se renova sozinho em até 7 dias — buscar
            outro termo funciona normalmente.
          </p>
        </div>
      ) : vendas?.configurado && itens.length === 0 ? (
        // itens_analisados === 0: aqui sim é falha de coleta, não cache antigo incompleto — o
        // retry funciona porque falha de run não é cacheada (pulse-sonar-vendas/index.ts). Amostra
        // vazia NUNCA vira "nenhum anúncio encontrado".
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">A amostra veio vazia para "{termoBuscado}".</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Isso é falha de coleta, não nicho sem anúncios. Busque de novo em instantes.
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>Tentar de novo</Button>
        </div>
      ) : vendas?.configurado ? (
        <>
          <VereditoSonar
            veredito={calcularVereditoAnuncios(vendas, visitasTotal)}
            contexto={contextoNichoAnuncios(vendas)}
            vendas={vendas}
          />
          <SonarVendas resp={vendas} />

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SonarFiltrosPopover filtros={filtros} setFiltros={setFiltros} />
            <span className="text-xs text-muted-foreground">
              {visiveis.length} de {itens.length} anúncios
              {excluidasSemDado > 0 && temFiltroAnunciosAtivo(filtros) && (
                <span title="Anúncios sem o dado do filtro ativo (null nunca vira 0) — não sumiram por serem ruins.">
                  {' '}· {excluidasSemDado} sem esse dado
                </span>
              )}
            </span>
            {temFiltroAnunciosAtivo(filtros) && (
              <Button variant="ghost" size="sm" onClick={() => setFiltros(FILTROS_ANUNCIOS_VAZIOS)}>
                <X className="mr-1 h-3.5 w-3.5" />
                Limpar filtros
              </Button>
            )}
          </div>

          <DataTable
            columns={colunas}
            rows={visiveis}
            rowKey={(i) => i.item_id ?? `pos-${i.posicao ?? 'x'}-${i.titulo}`}
            empty={<EmptyState icon={Package} title="Nenhum anúncio passa pelos filtros ativos." />}
          />
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      )}

      <DialogMargemSonar ficha={anuncioSimulando} onFechar={() => setAnuncioSimulando(null)} />
    </div>
  );
}
