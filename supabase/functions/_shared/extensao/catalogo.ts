// Catálogo na Extensão PubliAI (ADR-0189 D-12, Task 23): lógica pura sobre /products/{id} e /products/{id}/items.
// Decisões do consultor (22/10): posição por preço (empate divide), vencedor só pelo buy_box_winner do ML,
// nossa oferta marcada "Sua", leitura parcial explícita, perfil não carregado = "não informado".
import { leituraCompletaDaFicha, parseOfertasProduto } from '../pulse/parse.ts';
import type { VendedorML } from './tipos.ts';

export interface OfertaCatalogo {
  itemId: string;
  sellerId: number;
  preco: number;
  tipo: string | null;
  full: boolean;
  freteGratis: boolean;
  lojaOficial: boolean;
  propria: boolean;
  vencedora: boolean;
  /** null = perfil não carregado (limite de consultas ou falha). */
  vendedor: VendedorML | null;
}

export type Participacao =
  /** posicao null = ficha lida pela metade (as ofertas mais baratas podem estar fora da página lida). */
  | { estado: 'participa'; itemId: string; preco: number; posicao: number | null; empatada: boolean; ptw: PrecoParaGanhar | null }
  | { estado: 'nao_participa' }
  /** Ficha lida pela metade e a nossa oferta não veio: não dá para afirmar que não participa. */
  | { estado: 'nao_localizada' }
  | { estado: 'sem_conexao' };

export interface RespostaCatalogo {
  coletadoEm: string;
  /** Só o que o ML informa: `buy_box_winner` da API ou, sem ele, o item da buy box da página aberta. */
  vencedor: { itemId: string; sellerId: number | null; preco: number; origem: 'api' | 'pagina' } | null;
  ofertas: OfertaCatalogo[];
  leitura: { carregadas: number; total: number | null; completa: boolean };
  resumo: {
    vendedores: number;
    /** null em leitura parcial: extremos da página lida não são os do catálogo. */
    menorPreco: number | null;
    maiorPreco: number | null;
    full: number;
    freteGratis: number;
    lojasOficiais: number;
    perfisCarregados: number;
    /** Vendedores únicos por UF; sem perfil ou sem UF → `nao_informado`. */
    porUf: Record<string, number>;
    porMedalha: { platinum: number; gold: number; silver: number; sem: number; nao_informado: number };
  };
  participacao: Participacao;
}

/** Disputa da buy box do NOSSO anúncio (`/items/{id}/price_to_win`; 403 para terceiros). Não é a referência de
 *  preço de `/suggestions` (ADR-0119, Errata 3). */
export interface PrecoParaGanhar {
  status: 'winning' | 'sharing_first_place' | 'competing' | 'listed';
  precoParaGanhar: number | null;
}
const STATUS_PTW = new Set(['winning', 'sharing_first_place', 'competing', 'listed']);

/** Só o vocabulário documentado do ML; qualquer outro status → null (não inventar significado). */
export function parsePrecoParaGanhar(json: unknown): PrecoParaGanhar | null {
  const d = json as { status?: unknown; price_to_win?: unknown } | null;
  if (typeof d?.status !== 'string' || !STATUS_PTW.has(d.status)) return null;
  const p = typeof d.price_to_win === 'number' && d.price_to_win > 0 ? d.price_to_win : null;
  return { status: d.status as PrecoParaGanhar['status'], precoParaGanhar: p };
}

/** 1 + ofertas estritamente mais baratas (empates ficam 1, 1, 3). */
export function posicaoPorPreco(precos: number[], preco: number): { posicao: number; empatada: boolean } {
  return { posicao: 1 + precos.filter((p) => p < preco).length, empatada: precos.filter((p) => p === preco).length > 1 };
}

type ItemBruto = { seller_id?: unknown; price?: unknown };

/** Vendedores cujo perfil será consultado: nossa conta (se está na ficha), vencedor e o resto por menor preço. */
export function perfisPrioritarios(itens: ItemBruto[], vencedor: { sellerId: number | null } | null, contaOrg: number | null, limite: number): number[] {
  const ofertas = itens
    .filter((i): i is { seller_id: number; price: number } => typeof i.seller_id === 'number' && typeof i.price === 'number')
    .sort((a, b) => a.price - b.price);
  const naFicha = new Set(ofertas.map((o) => o.seller_id));
  const ordem = [
    ...(contaOrg != null && naFicha.has(contaOrg) ? [contaOrg] : []),
    ...(vencedor?.sellerId != null && naFicha.has(vencedor.sellerId) ? [vencedor.sellerId] : []),
    ...ofertas.map((o) => o.seller_id),
  ];
  return [...new Set(ordem)].slice(0, limite);
}

/** Vencedor só pelo que o ML informa: `buy_box_winner` válido da API ou, sem ele, o item da buy box da página `/p/`
 *  (só se estiver entre as ofertas). Única regra, usada também para escolher o perfil a consultar. */
export function vencedorDoCatalogo(produto: unknown, itens: unknown, itemDaPagina: string | null | undefined): RespostaCatalogo['vencedor'] {
  const v = (produto as { buy_box_winner?: { item_id?: unknown; price?: unknown; seller_id?: unknown } | null } | null)?.buy_box_winner;
  if (typeof v?.item_id === 'string' && typeof v.price === 'number' && v.price > 0) {
    return { itemId: v.item_id, sellerId: typeof v.seller_id === 'number' ? v.seller_id : null, preco: v.price, origem: 'api' };
  }
  const p = itemDaPagina ? parseOfertasProduto(itens).find((o) => o.item_id === itemDaPagina) : undefined;
  return p ? { itemId: p.item_id, sellerId: p.seller_id, preco: p.preco, origem: 'pagina' } : null;
}

export function montarCatalogo(e: {
  produto: unknown;
  itens: unknown;
  /** seller id da conexão ML da org; null = sem conexão. */
  contaOrg: string | null;
  perfis: Map<number, VendedorML | null>;
  ptw: PrecoParaGanhar | null;
  coletadoEm: string;
  /** Item da buy box lido na página /p/ (o evento da página é o vencedor); vale só se estiver entre as ofertas. */
  itemDaPagina?: string | null;
}): RespostaCatalogo {
  const ofertasBrutas = parseOfertasProduto(e.itens);
  const vencedor = vencedorDoCatalogo(e.produto, e.itens, e.itemDaPagina);
  const conta = e.contaOrg != null && /^\d+$/.test(e.contaOrg) ? Number(e.contaOrg) : null;
  const ofertas: OfertaCatalogo[] = ofertasBrutas
    .map((o) => ({
      itemId: o.item_id,
      sellerId: o.seller_id,
      preco: o.preco,
      tipo: o.tier,
      full: o.full_ml,
      freteGratis: o.frete_gratis,
      lojaOficial: o.loja_oficial,
      propria: conta !== null && o.seller_id === conta,
      vencedora: vencedor !== null && o.item_id === vencedor.itemId,
      vendedor: e.perfis.get(o.seller_id) ?? null,
    }))
    .sort((a, b) => a.preco - b.preco);

  const total = (e.itens as { paging?: { total?: unknown } } | null)?.paging?.total;
  const leitura = { carregadas: ofertas.length, total: typeof total === 'number' ? total : null, completa: leituraCompletaDaFicha(e.itens) };

  // Contagens por vendedor único (UF/medalha) e por oferta (Full, frete, oficial).
  const porVendedor = new Map<number, VendedorML | null>();
  for (const o of ofertas) if (!porVendedor.has(o.sellerId)) porVendedor.set(o.sellerId, o.vendedor);
  const porUf: Record<string, number> = {};
  const porMedalha = { platinum: 0, gold: 0, silver: 0, sem: 0, nao_informado: 0 };
  for (const v of porVendedor.values()) {
    const uf = v?.uf ?? 'nao_informado';
    porUf[uf] = (porUf[uf] ?? 0) + 1;
    if (!v) porMedalha.nao_informado++;
    else if (v.medalha === 'platinum' || v.medalha === 'gold' || v.medalha === 'silver') porMedalha[v.medalha]++;
    else porMedalha.sem++;
  }
  const precos = ofertas.map((o) => o.preco);

  let participacao: Participacao;
  const nossa = ofertas.find((o) => o.propria); // já ordenadas: a nossa de menor preço
  if (conta === null) participacao = { estado: 'sem_conexao' };
  else if (nossa) {
    participacao = {
      estado: 'participa', itemId: nossa.itemId, preco: nossa.preco,
      ...(leitura.completa ? posicaoPorPreco(precos, nossa.preco) : { posicao: null, empatada: false }),
      ptw: e.ptw,
    };
  } else participacao = leitura.completa ? { estado: 'nao_participa' } : { estado: 'nao_localizada' };

  return {
    coletadoEm: e.coletadoEm,
    vencedor,
    ofertas,
    leitura,
    resumo: {
      vendedores: porVendedor.size,
      menorPreco: leitura.completa && precos.length ? Math.min(...precos) : null,
      maiorPreco: leitura.completa && precos.length ? Math.max(...precos) : null,
      full: ofertas.filter((o) => o.full).length,
      freteGratis: ofertas.filter((o) => o.freteGratis).length,
      lojasOficiais: ofertas.filter((o) => o.lojaOficial).length,
      perfisCarregados: [...porVendedor.values()].filter((v) => v !== null).length,
      porUf,
      porMedalha,
    },
    participacao,
  };
}
