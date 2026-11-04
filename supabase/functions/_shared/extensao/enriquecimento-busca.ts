// Enriquecimento de catálogo da busca (ADR-0189 emenda 2026-11-02 + adendo 2026-11-03; plano, Revisão 03/11-b:
// lote por página). Para catálogos identificados nos cards (inclusive de concorrente): /products/{id},
// /products/{id}/items e /users/{seller} com a conta da org, mais a comissão "na sua conta" da oferta exata do card.
// - A página inteira numa requisição: 1 unidade da cota de páginas, UMA reserva do orçamento global (limite
//   superior, fases 1 e 2 + fretes), pool contínuo de 16 (listing_prices ≤ 4) + fila de frete de 8 (fatia 2.1,
//   só quando o pedido traz `fretes`), deadline de 8 s desde a entrada na edge.
// - Sem cache Redis de produto/ofertas/perfil (o cache é do navegador). Comissão: UM MGET da chave existente
//   (`chaveComissao`); miss é calculado e só devolvido (o navegador guarda; os produtores financeiros enchem o Redis).
// - Resultado parcial é terminal: o que não deu para consultar volta `indisponivel` com motivo, sem retomada.
// - Nada inventado: vendedor/categoria/tipo/comissão só da oferta cujo item_id = item do card.
import {
  CEP_FRETE_OFERTA, chaveComissao, comissaoDaListingPrice, dataDoProduto, freteDaRespostaShipping, MAX_PERFIS_PEDIDO,
} from '../../extensao/roteamento.ts';
import { leituraCompletaDaFicha } from '../pulse/parse.ts';
import type { ListingPriceML } from '../ml/tarifa.ts';
import { redisMget } from '../redis/client.ts';
import type { ComissaoML, Disponivel } from './tipos.ts';
import {
  chaveOrcamentoMl, devolverOrcamentoMl, reservarOrcamentoMl, reservarPagina, type ContadorRedis, type ReservaOrcamentoMl,
} from './cotas-busca.ts';
import { sinalComPrazo } from './enriquecimento-busca-io.ts';

const ML = 'https://api.mercadolibre.com';
const POOL = 16; // chamadas ML simultâneas
const POOL_COMISSAO = 4; // listing_prices simultâneas, dentro das 16
const POOL_FRETE = 8; // shipping_options simultâneas, fila própria FORA das 16 (spike §7): total 24
const MAX_RESERVA = 250; // 200 dos componentes existentes + 50 fretes
const PRAZO_MS = 8000; // desde a entrada na edge (o index passa o instante; sem ele, desde o início daqui)
const TIMEOUT_GET_MS = 3000;
const FOLGA_RESPOSTA_MS = 500; // nenhum GET passa de prazo − folga: sobra tempo para montar a resposta
const MIN_GET_MS = 250; // menos que isso não vale uma unidade do orçamento
const TIPOS = new Set(['gold_special', 'gold_pro']);
const MEDALHAS = new Set(['silver', 'gold', 'platinum']);
const CATEGORIA = /^MLB\d{1,20}$/;
// Expirações do cache do navegador (Revisão 03/11, regra 10), calculadas aqui para o cliente só obedecer.
const TTL_PRODUTO_MS = 6 * 3600_000;
const TTL_OFERTAS_MS = 60_000;
const TTL_PERFIL_MS = 24 * 3600_000;
const TTL_FRETE_MS = 6 * 3600_000;
const REPUTACOES = new Set(['1_red', '2_orange', '3_yellow', '4_light_green', '5_green']);

export const MOTIVO = {
  limiteMl: 'limite do Mercado Livre', // 429 na família do endpoint: ninguém mais dela é despachado nesta rodada
  tempo: 'tempo esgotado',
  orcamento: 'orçamento do app esgotado', // teto global ou Redis do orçamento fora (fail-closed)
  cancelada: 'consulta cancelada',
  cotaPaginas: 'limite de páginas por minuto',
  redis: 'serviço indisponível agora',
  perfis: 'limite de perfis por pedido',
} as const;

export type Componente = 'produto' | 'ofertas';
export interface CatalogoPedido { catalogProductId: string; componentes: Componente[]; itens: { itemId: string; preco: number }[] }
export interface PedidoEnriquecimento {
  catalogos: CatalogoPedido[];
  /** Vendedores cujo perfil o navegador quer (ofertas já em cache lá). */
  perfis: number[];
  /** Vendedores com perfil válido no cache do navegador: não são consultados. */
  perfisEmCache: number[];
  /** Fretes cotados pelo item exato do card (fatia 2.1). Ausente = nenhum shipping_options (cliente 0.5.0). */
  fretes?: { itemId: string; preco: number }[];
}

/** `tentarApos` (ms): Retry-After de um 429, quando veio. */
export interface RespostaMl { status: number; corpo: unknown; tentarApos?: number }
export interface DepsEnriquecimento {
  /** Conta ML da conexão da org (chave da comissão). */
  conta: string;
  agora: () => Date;
  /** Uma tentativa, nunca lança (`getMlUmaVez`), com o timeout dado. */
  getMl: (url: string, timeoutMs: number) => Promise<RespostaMl>;
  /** Instante (ms) limite da página, contado da entrada na edge. Ausente = início desta execução + 8 s. */
  prazo?: number;
  /** Cliente desconectou: nenhum despacho novo. */
  sinal?: AbortSignal;
}

type Ind = { estado: 'indisponivel'; motivo: string };
export type Medalha = 'silver' | 'gold' | 'platinum' | 'sem';
export type Reputacao = '1_red' | '2_orange' | '3_yellow' | '4_light_green' | '5_green';
/** cidade = cidade cadastrada do vendedor (não prova origem do envio); reputacao = cor do termômetro do ML. */
export interface VendedorBusca { nome: string | null; medalha: Medalha | null; uf: string | null; cidade: string | null; reputacao: Reputacao | null }

export type OfertaExata =
  | {
    itemId: string; estado: 'ok'; categoriaId: string | null; sellerId: number | null; tipo: 'gold_special' | 'gold_pro' | null;
    /** Situação do perfil do vendedor deste item (null = sem seller_id). Detalhe em `vendedores[]`. */
    perfil: 'carregado' | 'no_navegador' | 'indisponivel' | null;
    comissaoNaSuaConta: Disponivel<ComissaoML>;
  }
  | { itemId: string; estado: 'nao_encontrada'; motivo: string };

export interface CatalogoEnriquecido {
  catalogProductId: string;
  /** indisponivel = cota de páginas recusada ou Redis fora; nada foi consultado. */
  estado: 'ok' | 'indisponivel';
  motivo?: string;
  /** Sempre null (forma do DTO anterior; sem retomada automática). */
  retomarEm: null;
  /** null = nada consultado. */
  consultadoEm: string | null;
  produto?: { estado: 'ok'; criadoEm: string | null; marca: string | null; expiraEm: string } | Ind;
  ofertas?: {
    estado: 'ok'; expiraEm: string; total: number | null; lidas: number;
    vendedoresIdentificados: number; ofertasSemVendedor: number;
    /** Todas as ofertas lidas (leitura completa) E todas com vendedor identificado; senão "≥ N". */
    completa: boolean; exatas: OfertaExata[];
  } | Ind;
}

export type VendedorEnriquecido =
  | ({ sellerId: number; estado: 'ok'; expiraEm: string } & VendedorBusca)
  | ({ sellerId: number } & Ind);

/** Frete cotado (CEP_FRETE_OFERTA) do item exato do card; expiraEm só quando ok. */
export interface FreteEnriquecido { itemId: string; preco: number; frete: Disponivel<number>; expiraEm: string | null }

export interface RespostaEnriquecimento {
  consultadoEm: string;
  catalogos: CatalogoEnriquecido[];
  vendedores: VendedorEnriquecido[];
  /** Só quando o pedido trouxe `fretes` (a forma da 0.5.0 não muda). */
  fretes?: FreteEnriquecido[];
  custo: { comandosRedis: number; chamadasMl: number };
  /** Maior Retry-After dos 429 desta rodada (ISO); null = nenhum 429 com Retry-After. Só para o "Tentar novamente". */
  tentarAposEm: string | null;
}

/** Roda uma operação Redis com o prazo restante da página; abortada = lança (o chamador trata como incerta). */
type NoPrazo = <T>(f: (sinal: AbortSignal) => Promise<T>) => Promise<T>;

const registro = (v: unknown) => (typeof v === 'object' && v != null && !Array.isArray(v) ? v as Record<string, unknown> : null);
const ind = (motivo: string): Ind => ({ estado: 'indisponivel', motivo });

const textoOuNulo = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** /products/{id} → `attributes[id=BRAND].value_name`; ausente/vazio = null. */
export function marcaDoProduto(corpo: unknown): string | null {
  const attrs = registro(corpo)?.attributes;
  return Array.isArray(attrs) ? textoOuNulo(registro(attrs.find((a) => registro(a)?.id === 'BRAND'))?.value_name) : null;
}

function ufOuNulo(v: unknown): string | null {
  const e = typeof v === 'string' ? v : registro(v)?.id;
  if (typeof e !== 'string') return null;
  const s = e.trim().toUpperCase().replace(/^BR-/, '');
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

/** /users/{id} de terceiro → nome, medalha, UF, cidade, reputação (level_id fora da lista = null). Não exige `transactions.total` (normalizarPerfilVendedor exige).
 *  "sem" só com `power_seller_status: null` explícito; ausente ou desconhecido = null. */
export function vendedorDoUsuario(corpo: unknown): VendedorBusca {
  const b = registro(corpo);
  const rep = registro(b?.seller_reputation);
  const st = rep && 'power_seller_status' in rep ? rep.power_seller_status : undefined;
  return {
    nome: typeof b?.nickname === 'string' ? b.nickname : null,
    medalha: st === null ? 'sem' : typeof st === 'string' && MEDALHAS.has(st) ? st as Medalha : null,
    uf: ufOuNulo(registro(b?.address)?.state),
    cidade: textoOuNulo(registro(b?.address)?.city),
    reputacao: typeof rep?.level_id === 'string' && REPUTACOES.has(rep.level_id) ? rep.level_id as Reputacao : null,
  };
}

type Projecao = { item_id: unknown; seller_id: unknown; category_id: unknown; listing_type_id: unknown };
type OfertasLidas = { total: number | null; lidas: Projecao[]; leituraCompleta: boolean };
type Resultado = RespostaMl | Ind;
const naoDespachado = (r: Resultado): r is Ind => 'estado' in r;

/** Resposta de /products/{id}/items → só os 4 campos usados (o corpo de ~100 KB sai de escopo aqui). */
function projetarOfertas(r: Resultado): OfertasLidas | Ind {
  if (naoDespachado(r)) return r;
  if (r.status === 404 && /no winners found/i.test(String(registro(r.corpo)?.message ?? ''))) return { total: 0, lidas: [], leituraCompleta: true };
  if (r.status === 429) return ind(MOTIVO.limiteMl);
  const results = registro(r.corpo)?.results;
  if (r.status !== 200 || !Array.isArray(results)) return ind('ofertas indisponíveis');
  const total = registro(registro(r.corpo)?.paging)?.total;
  return {
    total: typeof total === 'number' && Number.isFinite(total) ? total : null,
    lidas: results.map((o) => { const x = registro(o); return { item_id: x?.item_id, seller_id: x?.seller_id, category_id: x?.category_id, listing_type_id: x?.listing_type_id }; }),
    leituraCompleta: leituraCompletaDaFicha(r.corpo),
  };
}

/** 429 → limite do ML; outro não-200 (ou corpo não-objeto) → indisponível com o motivo do endpoint. */
const respostaOk = (r: Resultado, motivo: string): RespostaMl | Ind =>
  naoDespachado(r) ? r : r.status === 429 ? ind(MOTIVO.limiteMl) : r.status !== 200 || !registro(r.corpo) ? ind(motivo) : r;

const sellerValido = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);

type Familia = 'produto' | 'ofertas' | 'perfil' | 'comissao' | 'frete';
interface Tarefa { url: string; familia: Familia }
/** Saldo da reserva: `geral` (componentes existentes, pool 16) tem prioridade sobre `frete` (fila própria de 8). */
type Conta = 'geral' | 'frete';

/** Despacho da página com UMA reserva do orçamento global compartilhada pelas fases e pela fila de frete. Nunca
 *  despacha além do saldo; 429 numa família fecha só ela; deadline e cancelamento param os despachos novos.
 *  Minuto UTC virou com saldo → devolve o saldo na chave antiga e re-reserva na nova (uma virada por vez; ao fim
 *  dela TODAS as bombas vivas voltam a rodar). */
function criarDespacho(deps: DepsEnriquecimento, custo: ContadorRedis & { chamadasMl: number }, prazo: number, noPrazo: NoPrazo) {
  let reserva: ReservaOrcamentoMl = { concedidas: 0, chave: '' };
  const saldo: Record<Conta, number> = { geral: 0, frete: 0 };
  let virada: Promise<void> | null = null;
  let parada: string | null = null;
  let tentarApos = 0;
  const fechadas = new Set<Familia>();
  const bombas = new Set<() => void>();

  /** Concessão parcial: os componentes existentes ficam com até `geralMax`; o frete, só com o que sobra. */
  const dividir = (concedidas: number, geralMax: number) => {
    saldo.geral = Math.min(concedidas, geralMax);
    saldo.frete = concedidas - saldo.geral;
  };

  async function virar(agora: Date) {
    const geral = saldo.geral;
    const pedir = saldo.geral + saldo.frete;
    await noPrazo((s) => devolverOrcamentoMl(reserva, pedir, agora, custo, s));
    saldo.geral = 0; saldo.frete = 0;
    reserva = await noPrazo((s) => reservarOrcamentoMl(pedir, agora, custo, s));
    dividir(reserva.concedidas, geral);
  }

  const bloqueio = (f: Familia, conta: Conta, restanteMs: number): string | null =>
    deps.sinal?.aborted ? MOTIVO.cancelada
    : parada ?? (fechadas.has(f) ? MOTIVO.limiteMl
    : restanteMs < MIN_GET_MS ? MOTIVO.tempo
    : saldo[conta] <= 0 ? MOTIVO.orcamento
    : null);

  /** Pool contínuo: uma resposta lenta segura só a própria vaga. Tarefas além do saldo atual da conta (na ordem
   *  dada) ficam sem orçamento desde já: prioridade fase 1 → perfis → comissões. Conta `frete` = pool próprio de 8. */
  async function executar(tarefas: Tarefa[], conta: Conta = 'geral'): Promise<Resultado[]> {
    // Virada de minuto em voo (disparada pela fila de frete) zera o saldo até re-reservar: repartir só depois dela.
    while (virada) await virada;
    const pool = conta === 'frete' ? POOL_FRETE : POOL;
    const out: Resultado[] = new Array(tarefas.length);
    const filas: { geral: number[]; comissao: number[] } = { geral: [], comissao: [] };
    tarefas.forEach((t, i) => {
      if (i >= saldo[conta]) out[i] = ind(MOTIVO.orcamento);
      else (t.familia === 'comissao' ? filas.comissao : filas.geral).push(i);
    });
    let ativos = 0;
    let ativosComissao = 0;
    return new Promise((fim) => {
      const bombear = () => {
        while (!virada && ativos < pool) {
          const fila = filas.comissao.length && ativosComissao < POOL_COMISSAO ? filas.comissao : filas.geral.length ? filas.geral : null;
          if (!fila) break;
          const agora = deps.agora();
          if (saldo.geral + saldo.frete > 0 && chaveOrcamentoMl(agora) !== reserva.chave) {
            virada = virar(agora).finally(() => { virada = null; for (const b of [...bombas]) b(); });
            return;
          }
          const i = fila.shift()!;
          const t = tarefas[i];
          const restante = prazo - agora.getTime() - FOLGA_RESPOSTA_MS;
          const m = bloqueio(t.familia, conta, restante);
          if (m) { out[i] = ind(m); continue; }
          saldo[conta]--; custo.chamadasMl++; ativos++;
          const comissao = t.familia === 'comissao';
          if (comissao) ativosComissao++;
          // Despacho síncrono (o executor roda já); lançamento síncrono vira rejeição.
          new Promise<RespostaMl>((ok) => ok(deps.getMl(t.url, Math.min(TIMEOUT_GET_MS, restante))))
            .catch((): RespostaMl => ({ status: 0, corpo: null }))
            .then((r) => {
              out[i] = r; ativos--;
              if (comissao) ativosComissao--;
              if (r.status === 429) { fechadas.add(t.familia); tentarApos = Math.max(tentarApos, r.tentarApos ?? 0); }
              bombear();
            });
        }
        if (!virada && ativos === 0 && !filas.geral.length && !filas.comissao.length) { bombas.delete(bombear); fim(out); }
      };
      bombas.add(bombear);
      bombear();
    });
  }

  return {
    async reservar(unidades: number, geralMax: number) {
      reserva = await noPrazo((s) => reservarOrcamentoMl(unidades, deps.agora(), custo, s));
      dividir(reserva.concedidas, geralMax);
    },
    executar,
    /** Nenhum despacho novo em nenhuma fila (MGET falho: Redis incerto). O que já saiu segue. */
    parar(motivo: string) { parada = motivo; },
    /** Fim da página: devolve só o não despachado, uma vez, na chave da reserva vigente. */
    async devolver() {
      const n = saldo.geral + saldo.frete;
      if (n > 0) await noPrazo((s) => devolverOrcamentoMl(reserva, n, deps.agora(), custo, s));
      saldo.geral = 0; saldo.frete = 0;
    },
    tentarAposEm: () => (tentarApos > 0 ? new Date(tentarApos).toISOString() : null),
  };
}

/** shipping_options → frete (parser puro `freteDaRespostaShipping`); 429 = limite; outro não-200 = indisponível. */
const freteDe = (r: Resultado): Disponivel<number> => {
  const x = respostaOk(r, 'frete da oferta indisponível');
  return naoDespachado(x) ? x : freteDaRespostaShipping(x.corpo);
};

export async function enriquecerCatalogosBusca(
  orgId: string, userId: string, p: PedidoEnriquecimento, deps: DepsEnriquecimento,
): Promise<RespostaEnriquecimento> {
  const custo = { comandosRedis: 0, chamadasMl: 0 };
  const inicio = deps.agora();
  const consultadoEm = inicio.toISOString();
  const em = (ms: number) => new Date(inicio.getTime() + ms).toISOString();
  const emCache = new Set(p.perfisEmCache);
  const explicitos = [...new Set(p.perfis)].filter((s) => !emCache.has(s));
  // Um GET por item distinto (a URL não leva preço); o resultado vale para cada (item, preço) pedido.
  const itensFrete = [...new Set((p.fretes ?? []).map((f) => f.itemId))];
  const fretesCom = (de: (itemId: string) => Disponivel<number>): Pick<RespostaEnriquecimento, 'fretes'> =>
    p.fretes === undefined ? {} : {
      fretes: p.fretes.map(({ itemId, preco }) => {
        const frete = de(itemId);
        return { itemId, preco, frete, expiraEm: frete.estado === 'ok' ? em(TTL_FRETE_MS) : null };
      }),
    };

  // Todo I/O da página (Redis e ML) cabe no prazo contado da entrada na edge.
  const prazo = deps.prazo ?? inicio.getTime() + PRAZO_MS;
  const noPrazo: NoPrazo = async (f) => {
    const { signal, liberar } = sinalComPrazo(prazo - deps.agora().getTime());
    try { return await f(signal); } finally { liberar(); }
  };

  // Uma unidade por pedido (página inteira ou delta do scroll), inclusive pedido só de perfis.
  const pagina = await noPrazo((s) => reservarPagina(orgId, userId, inicio, custo, s));
  if (pagina !== 'ok') {
    const motivo = pagina === 'limite' ? MOTIVO.cotaPaginas : MOTIVO.redis;
    return {
      consultadoEm,
      catalogos: p.catalogos.map((c) => ({ catalogProductId: c.catalogProductId, estado: 'indisponivel', motivo, retomarEm: null, consultadoEm: null })),
      vendedores: explicitos.map((sellerId) => ({ sellerId, ...ind(motivo) })),
      ...fretesCom(() => ind(motivo)),
      custo,
      tentarAposEm: null,
    };
  }

  const urls1: Tarefa[] = p.catalogos.flatMap((c) => [
    ...(c.componentes.includes('produto') ? [{ url: `${ML}/products/${c.catalogProductId}`, familia: 'produto' as const }] : []),
    ...(c.componentes.includes('ofertas') ? [{ url: `${ML}/products/${c.catalogProductId}/items?limit=100`, familia: 'ofertas' as const }] : []),
  ]);
  // Limite superior: perfis e comissões só saem de itens de catálogos com ofertas pedidas.
  const itensComOfertas = p.catalogos.reduce((n, c) => n + (c.componentes.includes('ofertas') ? c.itens.length : 0), 0);
  const limiteGeral = urls1.length + Math.min(MAX_PERFIS_PEDIDO, explicitos.length + itensComOfertas) + itensComOfertas;
  const limite = Math.min(MAX_RESERVA, limiteGeral + itensFrete.length);

  const despacho = criarDespacho(deps, custo, prazo, noPrazo);
  let pFretes: Promise<Resultado[]> = Promise.resolve([]);
  try {
    await despacho.reservar(limite, limiteGeral);

    // Frete: fila própria (8) desde já, em paralelo às fases 1 e 2 (o id do item vem do card).
    pFretes = despacho.executar(
      itensFrete.map((id) => ({ url: `${ML}/items/${id}/shipping_options?zip_code=${CEP_FRETE_OFERTA}`, familia: 'frete' as const })), 'frete',
    );

    // Fase 1: /products e /products/items dos componentes pedidos.
    const r1 = await despacho.executar(urls1);
    let k = 0;
    const lidos = p.catalogos.map((c) => {
      const produto = c.componentes.includes('produto') ? r1[k++] : undefined;
      const ofertas = c.componentes.includes('ofertas') ? r1[k++] : undefined;
      const pr = produto === undefined ? undefined : respostaOk(produto, 'catálogo indisponível');
      return {
        c,
        produto: pr === undefined ? undefined
          : naoDespachado(pr) ? pr
          : { estado: 'ok' as const, criadoEm: dataDoProduto(pr.corpo), marca: marcaDoProduto(pr.corpo), expiraEm: em(TTL_PRODUTO_MS) },
        ofertas: ofertas === undefined ? undefined : projetarOfertas(ofertas),
      };
    });

    // Ofertas exatas (item_id do card) → vendedores a consultar e chaves de comissão (deduplicadas).
    type Exata = { itemId: string; preco: number; categoriaId: string | null; sellerId: number | null; tipo: 'gold_special' | 'gold_pro' | null; chave: string | null };
    const exatasPorCat = lidos.map(({ c, ofertas }) => {
      if (!ofertas || !('lidas' in ofertas)) return null;
      return c.itens.map((i): Exata | { itemId: string; motivo: string } => {
        const o = ofertas.lidas.find((x) => x.item_id === i.itemId);
        if (!o) {
          return {
            itemId: i.itemId,
            motivo: ofertas.total === 0 ? 'catálogo sem ofertas' : ofertas.leituraCompleta ? 'oferta não está entre as ofertas do catálogo' : 'oferta fora das ofertas lidas',
          };
        }
        const categoriaId = typeof o.category_id === 'string' && CATEGORIA.test(o.category_id) ? o.category_id : null;
        const tipo = typeof o.listing_type_id === 'string' && TIPOS.has(o.listing_type_id) ? o.listing_type_id as Exata['tipo'] : null;
        return { itemId: i.itemId, preco: i.preco, categoriaId, sellerId: sellerValido(o.seller_id), tipo, chave: categoriaId && tipo ? chaveComissao(deps.conta, categoriaId, tipo, i.preco) : null };
      });
    });
    const exatas = exatasPorCat.flatMap((l) => l ?? []).filter((e): e is Exata => 'preco' in e);

    // Comissão: UM MGET das chaves distintas. Erro/prazo no Redis = nenhum despacho novo (fase 2 inteira
    // indisponível); os dados da fase 1 seguem.
    const chaves = [...new Set(exatas.flatMap((e) => (e.chave ? [e.chave] : [])))];
    const comissoes = new Map<string, Disponivel<ComissaoML>>();
    let redisFalhou = false;
    if (chaves.length) {
      custo.comandosRedis++;
      const hits = await noPrazo((s) => redisMget(chaves, s)).catch(() => { redisFalhou = true; return []; });
      if (redisFalhou) despacho.parar(MOTIVO.redis); // inclui os fretes ainda não despachados
      hits.forEach((h, i) => {
        try { const v = h ? JSON.parse(h) : null; if (v?.estado === 'ok' && v.valor) comissoes.set(chaves[i], v); } catch { /* miss */ }
      });
    }
    const misses = chaves.filter((c) => !comissoes.has(c)).map((c) => exatas.find((e) => e.chave === c)!);

    // Perfis: explícitos + vendedores das ofertas exatas da página inteira, menos os em cache no navegador; até 50.
    const sellers = [...new Set([...explicitos, ...exatas.flatMap((e) => (e.sellerId && !emCache.has(e.sellerId) ? [e.sellerId] : []))])];
    const consultar = sellers.slice(0, MAX_PERFIS_PEDIDO);

    // Fase 2: perfis antes das comissões ausentes (ordem = prioridade no saldo).
    const tarefas2: Tarefa[] = [
      ...consultar.map((s) => ({ url: `${ML}/users/${s}`, familia: 'perfil' as const })),
      ...misses.map((e) => ({ url: `${ML}/sites/MLB/listing_prices?price=${e.preco}&category_id=${e.categoriaId}&listing_type_id=${e.tipo}`, familia: 'comissao' as const })),
    ];
    const r2 = redisFalhou ? tarefas2.map(() => ind(MOTIVO.redis)) : await despacho.executar(tarefas2);

    const vendedores: VendedorEnriquecido[] = consultar.map((sellerId, i) => {
      const r = respostaOk(r2[i], 'perfil indisponível');
      return naoDespachado(r) ? { sellerId, ...r } : { sellerId, estado: 'ok', ...vendedorDoUsuario(r.corpo), expiraEm: em(TTL_PERFIL_MS) };
    });
    for (const sellerId of sellers.slice(MAX_PERFIS_PEDIDO)) vendedores.push({ sellerId, ...ind(MOTIVO.perfis) });

    misses.forEach((e, i) => {
      const r = respostaOk(r2[consultar.length + i], 'comissão indisponível');
      comissoes.set(e.chave!, naoDespachado(r) ? r : comissaoDaListingPrice(r.corpo as ListingPriceML, e.preco));
    });

    const perfilDe = (s: number | null): Extract<OfertaExata, { estado: 'ok' }>['perfil'] => {
      if (s === null) return null;
      if (emCache.has(s)) return 'no_navegador';
      return vendedores.find((x) => x.sellerId === s)?.estado === 'ok' ? 'carregado' : 'indisponivel';
    };
    const catalogos = lidos.map(({ c, produto, ofertas }, ci): CatalogoEnriquecido => {
      const out: CatalogoEnriquecido = { catalogProductId: c.catalogProductId, estado: 'ok', retomarEm: null, consultadoEm };
      if (produto) out.produto = produto;
      if (ofertas) {
        const ids = 'lidas' in ofertas ? ofertas.lidas.map((o) => sellerValido(o.seller_id)) : [];
        const semVendedor = ids.filter((s) => s === null).length;
        out.ofertas = 'lidas' in ofertas
          ? {
            estado: 'ok', expiraEm: em(TTL_OFERTAS_MS), total: ofertas.total, lidas: ofertas.lidas.length,
            vendedoresIdentificados: new Set(ids.filter((s) => s !== null)).size, ofertasSemVendedor: semVendedor,
            completa: ofertas.leituraCompleta && semVendedor === 0,
            exatas: exatasPorCat[ci]!.map((e): OfertaExata => ('preco' in e
              ? {
                itemId: e.itemId, estado: 'ok', categoriaId: e.categoriaId, sellerId: e.sellerId, tipo: e.tipo, perfil: perfilDe(e.sellerId),
                comissaoNaSuaConta: e.chave ? comissoes.get(e.chave)!
                  : ind(e.tipo ? 'categoria não confirmada' : 'tipo do anúncio não confirmado'),
              }
              : { itemId: e.itemId, estado: 'nao_encontrada', motivo: e.motivo })),
          }
          : ofertas;
      }
      return out;
    });

    const rf = await pFretes;
    const porItem = new Map(itensFrete.map((id, i) => [id, freteDe(rf[i])]));
    return { consultadoEm, catalogos, vendedores, ...fretesCom((id) => porItem.get(id)!), custo, tentarAposEm: despacho.tentarAposEm() };
  } finally {
    await pFretes; // nunca rejeita; nada de devolver saldo com frete ainda despachando
    await despacho.devolver();
  }
}
