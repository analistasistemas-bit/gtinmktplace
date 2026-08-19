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
  fetchVendasSonar, fetchVisitasSonar, itensDaAmostra, linkDoAnuncio, normalizarSerieVisitas, passosProgresso,
  type EtapaProgresso, type ItemVendasSonar, type PainelVendasSonar, type RaioXNicho,
  type VisitasAnuncio,
} from '@/lib/sonar';
import {
  aplicarFiltrosAnuncios, temFiltroAnunciosAtivo, FILTROS_ANUNCIOS_VAZIOS, type FiltrosAnuncios,
} from '@/lib/sonar-filtros';
import { fmtBRL, fmtInt, fmtMilhar } from '@/lib/formato';

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
  const [anuncioSimulando, setAnuncioSimulando] = useState<AnuncioSimulavel | null>(null);
  const [buscasRecentes, setBuscasRecentes] = useState<BuscaRecente[]>(lerBuscasRecentes);
  // Mantém o stepper visível um instante depois da resposta chegar, para mostrar as etapas
  // concluídas antes de trocar pelo resultado.
  const [mostrarProgresso, setMostrarProgresso] = useState(false);
  // Filtros da tabela (D13): 100% client-side, estado local — sem URL/localStorage nesta entrega.
  const [filtros, setFiltros] = useState<FiltrosAnuncios>(FILTROS_ANUNCIOS_VAZIOS);

  // Query PRIMÁRIA (ADR-0127/D3): a tabela nasce da Apify. retry desligado — cada tentativa
  // sem cache dispara um run pago (US$ 0,10).
  const { data: vendas, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['pulse', 'sonar-vendas', termoBuscado],
    queryFn: () => fetchVendasSonar(termoBuscado!),
    enabled: !!termoBuscado,
    staleTime: Infinity,
    retry: false,
  });

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
    setBuscasRecentes(registrarBusca(t));
    setTermo(t);
    setTermoBuscado(t);
  };

  const buscar = (e: FormEvent) => {
    e.preventDefault();
    const t = termo.trim();
    if (t.length < 3) { toast.error('Digite ao menos 3 caracteres para prospectar.'); return; }
    garimpar(t);
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
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Ex.: tecido oxford 10 metros"
            aria-label="Termo de busca no Sonar"
            className="h-9 pl-8"
          />
        </div>
        <Button type="submit" disabled={carregando}>
          <Search className="mr-2 h-4 w-4" />
          Prospectar
        </Button>
      </form>

      {!termoBuscado ? (
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
