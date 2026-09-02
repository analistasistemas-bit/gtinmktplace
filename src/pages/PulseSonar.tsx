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
  Package, Plus, Receipt, Search, ShoppingCart, Store, Trash2, Trophy, Truck, X, Zap,
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
import { SonarAnalisePubliAI } from '@/components/pulse/sonar-analise-publiai';
import { SonarDre } from '@/components/pulse/sonar-dre';
import { SecaoSonar } from '@/components/pulse/secao-sonar';
import { VereditoSonar } from '@/components/pulse/veredito-sonar';
import { DialogAdicionar } from '@/components/pulse/dialog-adicionar';
import {
  lerBuscasRecentes, limparBuscasRecentes, registrarBusca, tempoRelativo, type BuscaRecente,
} from '@/lib/sonar-buscas-recentes';
import { calcularVereditoAnuncios, contextoNichoAnuncios } from '@/lib/veredito-sonar';
import {
  fetchCruzamentoEan, fetchSecoes237Sonar, fetchVendasSonar, fetchVisitasSonar,
  itensDaAmostra, linkDoAnuncio, normalizarSerieVisitas, passosProgresso,
  type CruzamentoEan, type EtapaProgresso, type ItemVendasSonar,
  type PainelVendasSonar, type RaioXNicho, type VisitasAnuncio,
} from '@/lib/sonar';
import {
  aplicarFiltrosAnuncios, temFiltroAnunciosAtivo, FILTROS_ANUNCIOS_VAZIOS, type FiltrosAnuncios,
} from '@/lib/sonar-filtros';
import { fmtBRL, fmtInt, fmtMilhar } from '@/lib/formato';

// Detecta EAN/GTIN no campo de busca — espelho de supabase/functions/_shared/pulse/entrada.ts
// (regex Deno não é importável no bundle Vite). Desde o ADR-0140 não decide MAIS o caminho da
// consulta (EAN e termo percorrem o mesmo pipeline): decide só se há GTIN para cruzar com o
// catálogo da org.
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
    <SecaoSonar
      titulo="Vendas do nicho"
      selo={<Badge variant="outline">estimativa</Badge>}
      subtitulo={`amostra dos ${resp.itens_analisados} anúncios mais relevantes — "+N vendidos" acumulado, piso do nicho e não venda mensal`}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          size="compact"
          label="Vendas acumuladas"
          // "unidades" explícito: sem a palavra o número passa por valor em reais (dúvida real do
          // Diego em 18/08). Quem é valor é o card ao lado.
          value={`≈ ${fmtMilhar(resp.vendas_totais, 1)} unidades`}
          hint={`${resp.itens_com_vendas} de ${resp.itens_analisados} anúncios · na vida dos anúncios`}
          icon={ShoppingCart}
          tom="info"
        />
        <KpiCard
          size="compact"
          label="Mercado endereçável"
          value={`≈ R$ ${fmtMilhar(resp.valor_mercado, 1)}`}
          hint="Σ preço × vendidos, na vida dos anúncios"
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
    </SecaoSonar>
  );
}

/**
 * "Eu já vendo isto?" (ADR-0127 Errata 2). A ausência também informa — produto que não está no
 * catálogo é oportunidade nova, e o operador precisa ver isso dito, não deduzido de um espaço em
 * branco. É a única informação da view antiga por EAN que a tela por termo não tem.
 *
 * ADR-0140 D-3: as duas metades têm confiabilidade DIFERENTE e a tela não pode tratá-las igual.
 * `minhas` cruza `variacoes.gtin` com o EAN — leitura local exata, sob RLS, sem Apify: a ausência
 * dela é afirmação válida. `no_radar` cruza por `catalog_product_id`, e desde que a consulta por
 * EAN passou a nascer da busca (e não do lookup de catálogo) esses ids vêm só do que a amostra
 * trouxer — medido em 28/08: 7 de 20 anúncios. Por isso o Radar **só é afirmado no positivo**:
 * achou, escreve; não achou, cala. Escrever "não está no Radar" a partir de uma amostra que
 * sabidamente não tem 13 dos 20 ids seria a mesma mentira que a regra LOUD proíbe em imposto e
 * visitas — ausência de dado nunca vira afirmação de ausência do fato.
 */
export function SonarEanCruzamento({ cruzamento }: { cruzamento: CruzamentoEan }) {
  const { minhas, no_radar } = cruzamento;
  if (minhas.length === 0 && !no_radar) {
    return (
      <p className="mb-3 text-xs text-muted-foreground">
        Produto novo para o seu catálogo: nenhuma variação sua tem este GTIN.
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

/** Identidade de uma linha da amostra. Mesma chave do `rowKey` da DataTable: `item_id` sozinho é
 *  nulo em parte dos anúncios, e cair no título deixaria dois homônimos com a mesma identidade. */
const chaveDoItem = (i: ItemVendasSonar) => i.item_id ?? `pos-${i.posicao ?? 'x'}-${i.titulo}`;

export default function PulseSonar() {
  const [termo, setTermo] = useState('');
  const [termoBuscado, setTermoBuscado] = useState<string | null>(null);
  const [, forcarRender] = useState(0);
  const iniciadoEmRef = useRef(0);
  // Limpeza + refoco do campo depois de um scan (ADR-0140; antes disso o gatilho era a escolha
  // grátis/com vendidos, que deixou de existir). O leitor físico emula teclado: digita os dígitos e
  // manda Enter. Enter submete o form mas NÃO limpa nem desfoca o input — sem limpar aqui, o 2º
  // código escaneado é anexado ao 1º ("789…371" + "789…764" = 26 dígitos), o que não casa mais com
  // EAN_RE, passa pelo piso de 3 caracteres e vira uma busca paga em lixo.
  const inputRef = useRef<HTMLInputElement>(null);
  const [buscasRecentes, setBuscasRecentes] = useState<BuscaRecente[]>(lerBuscasRecentes);
  // Mantém o stepper visível um instante depois da resposta chegar, para mostrar as etapas
  // concluídas antes de trocar pelo resultado.
  const [mostrarProgresso, setMostrarProgresso] = useState(false);
  // Filtros da tabela (D13): 100% client-side, estado local — sem URL/localStorage nesta entrega.
  const [filtros, setFiltros] = useState<FiltrosAnuncios>(FILTROS_ANUNCIOS_VAZIOS);
  const [adicionarAberto, setAdicionarAberto] = useState(false);

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
  /** Âncora da DRE. Padrão: o primeiro anúncio da amostra (ADR-0148 D-8) — na ordenação inicial, o
   *  que mais vende. O botão "Simular" da linha troca por outro (ADR-0150 D-2), e o seletor que a
   *  D-8 deixou para "a fatia seguinte" é exatamente isto. */
  const [ancoraId, setAncoraId] = useState<string | null>(null);
  // Amostra nova, âncora nova: manter a escolha do nicho anterior apontaria para um anúncio que
  // não está mais na tela.
  useEffect(() => setAncoraId(null), [termoBuscado]);
  // A DRE (task 19) começa fechada — abre quando o operador clica "Simular" numa linha da tabela.
  // Nicho novo: mesma lógica do reset acima, a DRE aberta apontaria para um contexto que já foi.
  const [dreAberta, setDreAberta] = useState(false);
  useEffect(() => setDreAberta(false), [termoBuscado]);

  const ancoraDre = useMemo(() => {
    const i = itens.find((x) => chaveDoItem(x) === ancoraId) ?? itens[0];
    if (!i) return null;
    return {
      id: chaveDoItem(i),
      nome: i.titulo,
      category_id: i.category_id ?? null,
      preco_referencia: i.preco,
    };
  }, [itens, ancoraId]);
  /** Preços observados do nicho para os cenários da DRE (ADR-0149 D-1). */
  const precosDoNicho = useMemo(() => {
    const validos = itens.map((i) => i.preco).filter((p): p is number => p != null && p > 0);
    return {
      maisBarato: validos.length ? Math.min(...validos) : null,
      medioDoNicho: vendas?.configurado ? (vendas.raio_x?.ticket_medio ?? null) : null,
    };
  }, [itens, vendas]);
  const itemIds = useMemo(
    () => itens.map((i) => i.item_id).filter((x): x is string => x != null),
    [itens],
  );

  // ADR-0140 D-1: EAN não tem mais caminho próprio — percorre o mesmo pipeline do termo. O que
  // sobra de específico é o cruzamento com o catálogo da org, que só faz sentido quando o que foi
  // buscado É um GTIN (por termo não há o que cruzar).
  const eanBuscado = termoBuscado && EAN_RE.test(termoBuscado) ? termoBuscado : null;
  // Ids de catálogo que a amostra trouxer (D-3): são parciais por natureza — a maioria dos
  // anúncios da busca não é de catálogo. Servem para ACHAR o produto no Radar, nunca para negar
  // que ele esteja lá. Entram na queryKey porque mudam com a amostra.
  const catalogIdsAmostra = useMemo(
    () => [...new Set(itens.map((i) => i.catalog_product_id).filter((x): x is string => !!x))],
    [itens],
  );
  // Leitura local (RLS), sem ML. Falha aqui não derruba o resultado — o bloco some e o resto fica.
  const { data: cruzamentoEan } = useQuery({
    queryKey: ['pulse', 'sonar-ean-cruzamento', eanBuscado, catalogIdsAmostra],
    queryFn: () => fetchCruzamentoEan(eanBuscado!, catalogIdsAmostra),
    enabled: !!eanBuscado && itens.length > 0,
    staleTime: 60_000,
  });

  // Cabeçalho por EAN: "Nicho: {número}" não faz sentido para busca por código de barras — troca
  // pelo nome do produto, sem chamada nova (o cruzamento acima já é local e já está na tela).
  // Prioridade: nome do catálogo da própria org (o mais confiável) > título do primeiro anúncio
  // da amostra (é de um anúncio, não do catálogo — sinalizado na tela) > nada, só o código.
  const nomeProdutoEan = useMemo(() => {
    if (!eanBuscado) return null;
    const doCatalogo = cruzamentoEan?.minhas.find((v) => v.nome)?.nome;
    if (doCatalogo) return { texto: doCatalogo, deAnuncio: false };
    const doAnuncio = itens[0]?.titulo;
    return doAnuncio ? { texto: doAnuncio, deAnuncio: true } : null;
  }, [eanBuscado, cruzamentoEan, itens]);

  // Visitas (D3): dispara quando a lista de anúncios chega. Grátis (API oficial) — retry ok.
  const { data: visitas, isFetching: visitasCarregando } = useQuery({
    queryKey: ['pulse', 'sonar-visitas', termoBuscado, itemIds],
    queryFn: () => fetchVisitasSonar(itemIds),
    enabled: itemIds.length > 0,
    staleTime: Infinity,
    retry: 1,
  });

  // Análise PubliAI seções 2/3/7 (ADR-0142): demanda por vendedor via pulse_vendedores.
  const {
    data: secoes237,
    isFetching: secoes237Carregando,
    isError: secoes237Erro,
    error: secoes237ErroObj,
    refetch: refetchSecoes237,
  } = useQuery({
    queryKey: ['pulse', 'sonar-secoes237', termoBuscado, itemIds],
    queryFn: () => fetchSecoes237Sonar(itens),
    enabled: !!vendas?.configurado && itens.length > 0,
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

  // ADR-0140 D-1/D-2: EAN não ramifica mais. Vira `termoBuscado` como qualquer termo — a busca do
  // ML por código de barras já devolve só os anúncios daquele produto (medido: 20 de 24 anúncios
  // para o EAN do ADR-0136, contra 1 pelo lookup de catálogo). Sem escolha grátis/paga: toda
  // consulta é a mesma, e o custo é o mesmo da busca por termo.
  const garimpar = (t: string) => {
    const ehEan = EAN_RE.test(t);
    // Termo digitado continua no campo (comportamento de sempre — a tela de resultado não repete o
    // termo em lugar nenhum). EAN sai: quem escaneia não digitou, e o campo cheio quebra o próximo
    // scan. Ver o comentário do `inputRef`.
    setTermo(ehEan ? '' : t);
    setBuscasRecentes(registrarBusca(t));
    setTermoBuscado(t);
    if (ehEan) inputRef.current?.focus();
  };

  const buscar = (e: FormEvent) => {
    e.preventDefault();
    const t = termo.trim();
    // O piso de 3 caracteres não atrapalha o EAN (mínimo 8 dígitos) e é o mesmo do backend.
    if (t.length < 3) { toast.error('Digite ao menos 3 caracteres para prospectar.'); return; }
    garimpar(t);
  };

  // Ordem inicial por `vendidos` desc (o que mais vende primeiro): é a pergunta que o operador faz
  // ao abrir o garimpo. O ranking de relevância do ML não se perde — continua na coluna `#`, que
  // reordena com um clique. Nulos vão para o fim pelo comparador do DataTable, então os anúncios
  // sem "+N vendidos" não sobem por falta de dado.
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
            <Button
              variant={chaveDoItem(i) === ancoraDre?.id ? 'default' : 'outline'}
              size="sm"
              aria-pressed={chaveDoItem(i) === ancoraDre?.id}
              onClick={() => {
                setAncoraId(chaveDoItem(i));
                setDreAberta(true);
                document.getElementById('sonar-dre')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              title="Usar este anúncio como referência da DRE"
            >
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
  ], [visitasPorItem, ancoraDre?.id]);

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
              + 'mais relevantes + visitas da API oficial.'
            }
          />
        )
      ) : mostrarProgresso ? (
        <SonarProgresso passos={passosProgresso(elapsedMs, !carregando)} />
      ) : vendas && !vendas.configurado ? (
        // D16 modo 1: sem APIFY_TOKEN → estado vazio explícito, nada de tabela fantasma.
        <EmptyState
          icon={Search}
          title="Fonte de dados do Sonar não configurada"
          description={'A tabela de anúncios nasce de uma amostra de mercado. Configure a fonte de '
            + 'dados no backend para prospectar. Sem ela não há dado — '
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
          {/* ADR-0140 D-3: só na consulta por EAN — é o que a busca por termo não tem como
              responder ("eu já vendo isto?" precisa de um GTIN para cruzar). */}
          {eanBuscado && cruzamentoEan && <SonarEanCruzamento cruzamento={cruzamentoEan} />}
          {/* O resultado não tinha título: por EAN o campo é limpo, e ao rolar 2.128px até a tabela
              ninguém sabia mais o que estava sendo analisado. A idade do cache também era
              invisível — e é ela que diz se a próxima busca custa. */}
          <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b pb-3">
            <div className="min-w-0">
              <h2
                className="truncate text-base font-semibold"
                title={
                  eanBuscado
                    ? `${vendas.termo}${nomeProdutoEan ? ` — ${nomeProdutoEan.texto}${nomeProdutoEan.deAnuncio ? ' (título do anúncio)' : ''}` : ''}`
                    : `Nicho: ${vendas.termo}`
                }
              >
                {eanBuscado ? (
                  nomeProdutoEan ? (
                    <>
                      {vendas.termo} — {nomeProdutoEan.texto}
                      {nomeProdutoEan.deAnuncio && (
                        <span className="font-normal text-muted-foreground"> (título do anúncio)</span>
                      )}
                    </>
                  ) : (
                    vendas.termo
                  )
                ) : (
                  `Nicho: ${vendas.termo}`
                )}
              </h2>
              <p className="text-xs text-muted-foreground">
                amostra de {vendas.itens_analisados} anúncios
                {vendas.gerado_em && ` · coletado ${tempoRelativo(vendas.gerado_em, new Date())}`}
                {' '}· reabrir este termo não dispara coleta nova (cache de 7 dias); um termo novo, sim
              </p>
            </div>
            {/* ADR-0140 D-3: só com GTIN há o que vigiar — o Radar acompanha ficha de catálogo. */}
            {eanBuscado && (
              <Button variant="outline" size="sm" onClick={() => setAdicionarAberto(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Adicionar ao Radar
              </Button>
            )}
          </div>
          <VereditoSonar
            veredito={calcularVereditoAnuncios(vendas, visitasTotal)}
            contexto={contextoNichoAnuncios(vendas)}
            vendas={vendas}
            visitasPorItem={visitasPorItem}
          />
          <SonarVendas resp={vendas} />
          <SonarAnalisePubliAI
            data={secoes237}
            carregando={secoes237Carregando}
            erro={secoes237Erro ? (secoes237ErroObj instanceof Error ? secoes237ErroObj : new Error('Erro desconhecido.')) : null}
            onRetry={() => refetchSecoes237()}
          />
          {/* Seção 6 (ADR-0148). Âncora padrão: o PRIMEIRO anúncio da amostra — na ordenação
              inicial, o que mais vende no nicho. O botão "Simular" de cada linha troca a âncora
              (ADR-0150 D-2): é o único simulador de margem do Sonar. */}
          <SonarDre
            ancora={ancoraDre}
            precos={precosDoNicho}
            aberta={dreAberta}
            onAlternar={setDreAberta}
          />

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
            defaultSort={{ key: 'vendidos', dir: 'desc' }}
            rowKey={chaveDoItem}
            empty={<EmptyState icon={Package} title="Nenhum anúncio passa pelos filtros ativos." />}
          />
        </>
      ) : (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      )}

      <DialogAdicionar
        aberto={adicionarAberto}
        entradaInicial={eanBuscado ?? ''}
        onFechar={() => setAdicionarAberto(false)}
      />
    </div>
  );
}
