// Sonar (ADR-0120): garimpo on-demand de um nicho do Mercado Livre, par do Radar (Pulse.tsx),
// que vigia o que já vendemos. O Sonar varre ANTES de cadastrar o produto.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BadgeCheck, Check, ChevronDown, ChevronRight, Circle, CircleDollarSign, Clock, ExternalLink,
  Eye, Filter, Globe, Loader2, Package, Receipt, Search, ShoppingCart, Store, Trash2, TrendingUp,
  Trophy, Truck, Users, X, Zap,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from 'recharts';
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
import { DialogMargemSonar } from '@/components/pulse/dialog-margem-sonar';
import { VereditoSonar } from '@/components/pulse/veredito-sonar';
import {
  lerBuscasRecentes, limparBuscasRecentes, registrarBusca, tempoRelativo, type BuscaRecente,
} from '@/lib/sonar-buscas-recentes';
import { calcularVeredito, contextoNicho } from '@/lib/veredito-sonar';
import {
  fetchPainelSonar, fetchVendasSonar, fichasAtivas, fichasSemVendedor, passosProgresso,
  type PainelSonar, type EtapaProgresso, type RaioXNicho, type RespostaVendasSonar,
} from '@/lib/sonar';
import {
  cruzarFichaComVendas, espalhamentoPct, vendedorMaisForte, visitasPorOferta, type VendasFicha,
} from '@/lib/sonar-cruzamento';
import {
  aplicarFiltros, temFiltroAtivo, FILTROS_VAZIOS, type FiltrosSonar,
} from '@/lib/sonar-filtros';
import { fmtBRL, fmtInt, fmtMilhar } from '@/lib/formato';

type Ficha = PainelSonar['fichas'][number];

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

// Bloco de vendas estimadas (ADR-0122): carrega em paralelo ao painel oficial e degrada sozinho —
// Apify fora do ar ou sem token nunca derruba o resto do Sonar.
function SonarVendas({ resp, carregando, erro }: {
  resp: RespostaVendasSonar | undefined; carregando: boolean; erro: boolean;
}) {
  if (carregando) {
    return (
      <Card className="mb-4 p-4">
        <div className="mb-2 text-sm font-medium">Vendas do nicho</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      </Card>
    );
  }
  if (erro) {
    return (
      <Card className="mb-4 p-4">
        <div className="mb-1 text-sm font-medium">Vendas do nicho</div>
        <p className="text-sm text-muted-foreground">
          Consulta de vendas falhou ou demorou demais — o resto do painel não é afetado. Busque de
          novo para tentar outra vez.
        </p>
      </Card>
    );
  }
  if (!resp) return null;
  if (!resp.configurado) {
    return (
      <Card className="mb-4 p-4">
        <div className="mb-1 text-sm font-medium">Vendas do nicho</div>
        <p className="text-sm text-muted-foreground">
          Configure o token da Apify (variável <code className="font-mono text-xs">APIFY_TOKEN</code>)
          para ver vendas acumuladas, mercado endereçável e produto destaque do nicho.
        </p>
      </Card>
    );
  }

  const destaque = resp.produto_destaque;
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
              {destaque.link ? (
                <a
                  href={destaque.link}
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
                ≈ {fmtMilhar(destaque.vendidos ?? 0, 1)} vendidos
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

// Popover de filtros (D13): controles marcados † no plano (dependem da Apify) só renderizam com
// `grupoBDisponivel` — mesma regra das colunas do Grupo B (D5). `esconderLojaOficial` é da API
// oficial e aparece sempre.
function SonarFiltrosPopover({ filtros, setFiltros, grupoBDisponivel }: {
  filtros: FiltrosSonar;
  setFiltros: (f: FiltrosSonar) => void;
  grupoBDisponivel: boolean;
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
              Preço mín. (mediana)
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
              Preço máx. (mediana)
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
            <label htmlFor="sonar-filtro-max-vendedores" className="text-xs">
              Máx. vendedores
              <Input
                id="sonar-filtro-max-vendedores"
                type="number"
                inputMode="numeric"
                value={filtros.maxVendedores ?? ''}
                onChange={(e) => setFiltros({ ...filtros, maxVendedores: num(e.target.value) })}
                className="mt-1"
              />
            </label>
            {grupoBDisponivel && (
              <>
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
              </>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t pt-2.5">
            {grupoBDisponivel && (
              <>
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
              </>
            )}
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
  const [semVendedorAberto, setSemVendedorAberto] = useState(false);
  const [fichaSimulando, setFichaSimulando] = useState<PainelSonar['fichas'][number] | null>(null);
  const [buscasRecentes, setBuscasRecentes] = useState<BuscaRecente[]>(lerBuscasRecentes);
  // Mantém o stepper visível um instante depois da resposta chegar, para mostrar as 4 etapas
  // concluídas antes de trocar pelo resultado (em vez de sumir direto na 3ª, travada).
  const [mostrarProgresso, setMostrarProgresso] = useState(false);
  // Filtros da tabela (D13): 100% client-side, estado local — sem URL/localStorage nesta entrega.
  const [filtros, setFiltros] = useState<FiltrosSonar>(FILTROS_VAZIOS);

  const { data: painel, isFetching, isError, error } = useQuery({
    queryKey: ['pulse', 'sonar', termoBuscado],
    queryFn: () => fetchPainelSonar(termoBuscado!),
    enabled: !!termoBuscado,
    staleTime: Infinity, // cache real é o Redis (24h) — o front nunca refaz a mesma busca sozinho
  });

  // Vendas estimadas (ADR-0122): paralelo e independente do painel oficial. retry desligado —
  // cada tentativa sem cache dispara um run pago na Apify.
  const { data: vendas, isFetching: vendasCarregando, isError: vendasErro } = useQuery({
    queryKey: ['pulse', 'sonar-vendas', termoBuscado],
    queryFn: () => fetchVendasSonar(termoBuscado!),
    enabled: !!termoBuscado,
    staleTime: Infinity,
    retry: false,
  });

  // A tela de resultado só abre quando o painel oficial E as vendas resolverem (pedido do Diego
  // 18/08: "quando aparecer a tela, já tem que estar todas as informações"). Sem isso o painel
  // estreava com esqueleto no bloco de vendas e o veredito trocava de nível na frente do
  // operador quando a Apify respondia. Vendas com erro também resolve (retry: false) — falha
  // nunca prende o operador no stepper.
  const carregando = isFetching || vendasCarregando;

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
    if (t.length < 3) { toast.error('Digite ao menos 3 caracteres para garimpar.'); return; }
    garimpar(t);
  };

  // Memoizados: entram como dependência dos useMemo abaixo (filtros/cruzamento) — sem isso o
  // array novo a cada render invalidaria o memo sempre.
  const ativas = useMemo(() => (painel ? fichasAtivas(painel) : []), [painel]);
  const vazias = useMemo(() => (painel ? fichasSemVendedor(painel) : []), [painel]);

  // Colunas do Grupo B só existem com Apify configurada E `por_anuncio` presente (D5) — cache v4
  // antigo sem o índice não tem como cruzar. Fora daqui a tabela é IDÊNTICA à de antes.
  const grupoBDisponivel = vendas?.configurado === true && !!vendas.por_anuncio;

  // Cruzamento ficha↔anúncio (D4) calculado UMA vez por ficha aqui, nunca por célula — Map
  // reaproveitado por todas as colunas do Grupo B e pelos filtros.
  const vendasPorFicha = useMemo(() => {
    const porAnuncio = vendas?.configurado === true ? vendas.por_anuncio : undefined;
    const map = new Map<string, VendasFicha | null>();
    if (!painel) return map;
    for (const f of painel.fichas) map.set(f.product_id, cruzarFichaComVendas(f, porAnuncio));
    return map;
  }, [painel, vendas]);

  // Filtros (D13/D14): aplicados só nas rows da tabela — KPIs e veredito continuam com `painel`
  // inteiro, nunca com `ativas` filtrada (senão o veredito mudaria com o filtro).
  const { visiveis: fichasVisiveis, excluidasSemDado } = useMemo(
    () => aplicarFiltros(ativas, vendasPorFicha, filtros),
    [ativas, vendasPorFicha, filtros],
  );

  // Sem `defaultSort`: a ordem que chega da API é o ranking de relevância do ML, e perder isso ao
  // abrir a tela custaria mais que a conveniência de já vir ordenado por alguma coluna.
  const colunasFichas = useMemo<Column<Ficha>[]>(() => {
    const colProduto: Column<Ficha> = {
      key: 'nome',
      header: 'Produto',
      className: 'max-w-xs',
      cell: (f) => {
        const vf = grupoBDisponivel ? vendasPorFicha.get(f.product_id) : null;
        return (
          <div className="max-w-xs">
            <span className="block truncate" title={f.nome}>{f.nome}</span>
            {(vf?.selo || vf?.patrocinado === true) && (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {vf?.selo && <Badge variant="secondary" className="text-[10px]">{vf.selo}</Badge>}
                {vf?.patrocinado === true && <Badge variant="outline" className="text-[10px]">Patrocinado</Badge>}
              </div>
            )}
          </div>
        );
      },
      sortValue: (f) => f.nome,
    };

    const colOfertas: Column<Ficha> = {
      key: 'ofertas',
      header: 'Ofertas',
      className: 'tabular-nums',
      cell: (f) => f.ofertas,
      sortValue: (f) => f.ofertas,
    };

    const colVendas: Column<Ficha> = {
      key: 'vendidos',
      header: 'Vendas (acum.)',
      className: 'tabular-nums',
      cell: (f) => {
        const vf = vendasPorFicha.get(f.product_id);
        if (vf?.vendidos == null) return <span title="Sem anúncio correspondente na amostra">—</span>;
        return (
          <span title="Acumulado da vida do anúncio, arredondado em faixas pelo ML — não é ritmo mensal">
            +{fmtMilhar(vf.vendidos)}
          </span>
        );
      },
      sortValue: (f) => vendasPorFicha.get(f.product_id)?.vendidos ?? null,
    };

    const colFaturamento: Column<Ficha> = {
      key: 'faturamento',
      header: 'Faturamento (acum.)',
      className: 'tabular-nums',
      cell: (f) => {
        const vf = vendasPorFicha.get(f.product_id);
        if (vf?.faturamento == null) return <span title="Sem anúncio correspondente na amostra">—</span>;
        return (
          <span title="≈ vendidos × preço atual do anúncio — o preço pode ter variado ao longo da vida">
            ≈ {fmtBRL(vf.faturamento)}
          </span>
        );
      },
      sortValue: (f) => vendasPorFicha.get(f.product_id)?.faturamento ?? null,
    };

    const colPreco: Column<Ficha> = {
      key: 'preco',
      header: 'Preço',
      className: 'tabular-nums',
      cell: (f) => {
        if (!f.preco) return '—';
        const espalhamento = espalhamentoPct(f.preco);
        const vf = grupoBDisponivel ? vendasPorFicha.get(f.product_id) : null;
        return (
          <div>
            <span className="font-medium">{fmtBRL(f.preco.mediana)}</span>
            <div className="text-xs text-muted-foreground">
              {fmtBRL(f.preco.min)} – {fmtBRL(f.preco.max)}
              {espalhamento != null && ` · +${Math.round(espalhamento)}%`}
            </div>
            {vf?.preco_anterior != null && vf.desconto_pct != null && (
              <div className="text-xs text-muted-foreground" title="desconto do anúncio na amostra Apify">
                de <span className="line-through">{fmtBRL(vf.preco_anterior)}</span> · {vf.desconto_pct}% OFF
              </div>
            )}
          </div>
        );
      },
      // Sort mudou de min pra mediana (T8): mediana é o número principal exibido agora — se o
      // Diego preferir o piso de volta, é reverter esta linha.
      sortValue: (f) => f.preco?.mediana ?? null,
    };

    const colAvaliacao: Column<Ficha> = {
      key: 'avaliacao',
      header: 'Avaliação',
      className: 'tabular-nums',
      cell: (f) => {
        const vf = vendasPorFicha.get(f.product_id);
        if (vf?.avaliacao_nota == null) return <span title="Sem anúncio correspondente na amostra">—</span>;
        return (
          <div>
            <span>★ {vf.avaliacao_nota.toFixed(1)}</span>
            {vf.avaliacao_qtd != null && <div className="text-xs text-muted-foreground">({vf.avaliacao_qtd})</div>}
          </div>
        );
      },
      sortValue: (f) => vendasPorFicha.get(f.product_id)?.avaliacao_nota ?? null,
    };

    const colPosicao: Column<Ficha> = {
      key: 'posicao',
      header: 'Posição',
      className: 'tabular-nums',
      cell: (f) => {
        const vf = vendasPorFicha.get(f.product_id);
        const titulo = 'Posição orgânica na busca do ML (amostra)';
        if (vf?.posicao_organica == null) return <span title={titulo}>—</span>;
        return <span title={titulo}>#{vf.posicao_organica}</span>;
      },
      sortValue: (f) => vendasPorFicha.get(f.product_id)?.posicao_organica ?? null,
    };

    const colVisitas: Column<Ficha> = {
      key: 'visitas',
      header: 'Visitas (30d)',
      className: 'tabular-nums',
      cell: (f) => {
        if (f.visitas_30d == null) return <span title="Não medido">—</span>;
        const porOferta = visitasPorOferta(f.visitas_30d, f.ofertas);
        return (
          <div className="flex items-center gap-2">
            <div>
              <span>{fmtInt(f.visitas_30d)}</span>
              {porOferta != null && (
                <div
                  className="text-xs text-muted-foreground"
                  title={`Visitas do anúncio ganhador ÷ nº de ofertas (${f.ofertas})`}
                >
                  ≈ {fmtInt(Math.round(porOferta))}/oferta
                </div>
              )}
            </div>
            <Sparkline dados={f.visitas_por_dia} />
          </div>
        );
      },
      sortValue: (f) => f.visitas_30d ?? null,
    };

    const colEnvio: Column<Ficha> = {
      key: 'envio',
      header: 'Envio',
      className: 'text-xs',
      cell: (f) => {
        const vf = vendasPorFicha.get(f.product_id);
        const label = vf?.full === true ? 'FULL' : vf?.flex === true ? 'FLEX' : null;
        return (
          <div>
            <div className="flex items-center gap-1">
              {label ? <Badge variant="outline">{label}</Badge> : <span title="Sem anúncio correspondente na amostra">—</span>}
              {vf?.internacional === true && <Globe className="h-3.5 w-3.5 text-info" aria-label="Internacional" />}
            </div>
            <div className="text-muted-foreground">frete grátis {f.frete_gratis_pct}%</div>
          </div>
        );
      },
    };

    const colVendedores: Column<Ficha> = {
      key: 'vendedores',
      header: 'Vendedores / UF',
      className: 'text-xs text-muted-foreground',
      cell: (f) => {
        const ufs = [...new Set(f.vendedores.map((v) => v.uf).filter((uf): uf is string => !!uf))];
        const top = vendedorMaisForte(f.vendedores);
        const oficial = f.vendedores.some((v) => v.loja_oficial);
        return (
          <div>
            <div className="flex items-center gap-1">
              <span>{f.vendedores.length} {ufs.length > 0 && `(${ufs.join(', ')})`}</span>
              {oficial && <Badge variant="secondary">Oficial</Badge>}
            </div>
            {top && (
              <div>top: {fmtMilhar(top.transacoes_total)} vendas{top.uf && ` · ${top.uf}`}</div>
            )}
          </div>
        );
      },
      sortValue: (f) => f.vendedores.length,
    };

    const colAcao: Column<Ficha> = {
      key: 'acao',
      header: '',
      // `/p/{product_id}` leva à ficha de catálogo, onde as ofertas dos concorrentes aparecem lado
      // a lado — é o link possível: a API não devolve a URL do anúncio de terceiro. Mesmo formato
      // usado no dialog de detalhe do Radar e aceito pelo "Adicionar produto".
      cell: (f) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setFichaSimulando(f)}>
            Simular margem
          </Button>
          <Button asChild variant="ghost" size="icon-sm">
            <a
              href={`https://www.mercadolivre.com.br/p/${f.product_id}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Abrir "${f.nome}" no Mercado Livre (nova aba)`}
              title="Abrir no Mercado Livre"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      ),
    };

    // Com Apify fora (D5) a tabela é EXATAMENTE a de antes: Produto, Ofertas, Preço, Visitas,
    // Vendedores/UF, Ações. Com Apify dentro, "Ofertas" cede espaço aos 5 campos novos — 9
    // colunas de dados + Ações no total (D11), sem estourar a largura do desktop.
    return [
      colProduto,
      ...(grupoBDisponivel ? [] : [colOfertas]),
      ...(grupoBDisponivel ? [colVendas, colFaturamento] : []),
      colPreco,
      ...(grupoBDisponivel ? [colAvaliacao, colPosicao] : []),
      colVisitas,
      ...(grupoBDisponivel ? [colEnvio] : []),
      colVendedores,
      colAcao,
    ];
  }, [grupoBDisponivel, vendasPorFicha]);
  const elapsedMs = iniciadoEmRef.current ? Date.now() - iniciadoEmRef.current : 0;

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Garimpa um nicho do Mercado Livre antes de você cadastrar o produto — o par do Radar, que
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
          Garimpar
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
              'Varre um nicho do Mercado Livre antes de você cadastrar o produto: fichas de '
              + 'catálogo, concorrência, preço e demanda do nicho. Limites do dado: só cobre '
              + 'produtos com ficha de catálogo, e a demanda é medida por visitas e ranking — o '
              + 'Mercado Livre não expõe vendas exatas de terceiros.'
            }
          />
        )
      ) : mostrarProgresso ? (
        <SonarProgresso passos={passosProgresso(elapsedMs, !carregando)} />
      ) : isError ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">Não foi possível garimpar este termo.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'Erro desconhecido.'}
          </p>
        </div>
      ) : painel ? (
        <>
          <VereditoSonar
            veredito={calcularVeredito(painel, vendas?.configurado ? vendas : null)}
            contexto={contextoNicho(painel, vendas?.configurado ? vendas : null)}
          />

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <KpiCard size="compact" label="Visitas (30d)" value={fmtMilhar(painel.agregado.visitas_30d_total, 1)} icon={Eye} tom="info" />
            <KpiCard
              size="compact"
              label="Fichas no catálogo"
              // O ML satura `paging.total` em 10.000 — sem o "+" o número vira uma contagem falsa.
              value={painel.total_catalogo >= 10_000
                ? `${fmtMilhar(painel.total_catalogo)}+`
                : fmtMilhar(painel.total_catalogo)}
              hint={`${ativas.length + vazias.length} analisadas`}
              icon={Package}
              tom="info"
            />
            <KpiCard size="compact" label="Ofertas" value={fmtInt(painel.agregado.ofertas_total)} icon={TrendingUp} tom="info" />
            <KpiCard size="compact" label="Vendedores distintos" value={painel.agregado.vendedores_distintos} icon={Users} tom="info" />
            <KpiCard size="compact" label="Frete grátis" value={`${painel.agregado.frete_gratis_pct}%`} icon={Truck} tom="info" />
          </div>

          <SonarVendas resp={vendas} carregando={vendasCarregando} erro={vendasErro} />

          {painel.agregado.visitas_por_dia.length > 0 && (
            <Card className="mb-4 p-4">
              <div className="mb-2 text-sm font-medium">Visitas por dia</div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={painel.agregado.visitas_por_dia} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="grad-sonar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="data" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={40} tickFormatter={(v) => fmtInt(Number(v))} />
                    <RTooltip formatter={(v) => [fmtInt(Number(v)), 'Visitas']} labelClassName="text-foreground" contentStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="total" stroke="var(--primary)" strokeWidth={2} fill="url(#grad-sonar)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SonarFiltrosPopover filtros={filtros} setFiltros={setFiltros} grupoBDisponivel={grupoBDisponivel} />
            <span className="text-xs text-muted-foreground">
              {fichasVisiveis.length} de {ativas.length} fichas
              {excluidasSemDado > 0 && temFiltroAtivo(filtros) && (
                <span title="Fichas sem o dado do filtro ativo (null nunca vira 0) — não sumiram por serem ruins.">
                  {' '}· {excluidasSemDado} sem esse dado
                </span>
              )}
            </span>
            {temFiltroAtivo(filtros) && (
              <Button variant="ghost" size="sm" onClick={() => setFiltros(FILTROS_VAZIOS)}>
                <X className="mr-1 h-3.5 w-3.5" />
                Limpar filtros
              </Button>
            )}
          </div>

          <DataTable
            columns={colunasFichas}
            rows={fichasVisiveis}
            rowKey={(f) => f.product_id}
            empty={
              temFiltroAtivo(filtros)
                ? <EmptyState icon={Package} title="Nenhuma ficha passa pelos filtros ativos." />
                : <EmptyState icon={Package} title="Nenhuma ficha com vendedor ativo para este termo." />
            }
          />

          {painel.palavras_chave.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 text-sm font-medium">Palavras-chave do nicho</div>
              <div className="flex flex-wrap gap-1.5">
                {painel.palavras_chave.map((p) => (
                  <Badge key={p.termo} variant="secondary">{p.termo} ({p.contagem})</Badge>
                ))}
              </div>
            </div>
          )}

          {vazias.length > 0 && (
            <div className="mt-6">
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setSemVendedorAberto((o) => !o)}
              >
                {semVendedorAberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Fichas de catálogo sem vendedor ativo ({vazias.length})
              </button>
              {semVendedorAberto && (
                <div className="mt-2 rounded-lg border p-3">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Essas fichas já existem no catálogo do Mercado Livre, mas ninguém está vendendo
                    agora — pode ser oportunidade: a ficha está pronta e sem concorrência ativa.
                  </p>
                  <ul className="flex flex-col gap-1 text-sm">
                    {vazias.map((f) => <li key={f.product_id}>{f.nome}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      )}

      <DialogMargemSonar ficha={fichaSimulando} onFechar={() => setFichaSimulando(null)} />
    </div>
  );
}
