// Vendas estimadas do Sonar (ADR-0122): parsers puros do dataset da Apify
// (actor karamelo/mercadolivre-scraper-brasil-portugues). Nenhuma chamada de rede aqui.
// `vendidos` é o "+N vendidos" da página do ML: acumulado do anúncio, arredondado (piso) —
// nunca venda mensal nem exata. Item sem o dado NUNCA soma como zero (regra LOUD).
import { extrairPalavrasChave } from './sonar.ts';

export interface ItemVendas {
  titulo: string;
  preco: number | null;
  vendidos: number | null;
  link: string | null;
  imagem: string | null;
  vendedor: string | null;
  /** ID numérico do vendedor no ML (campo Apify `vendedorID`, ADR-0142). */
  seller_id: number | null;
  frete_gratis: boolean | null;
  loja_oficial: boolean | null;
  internacional: boolean | null;
  /** Derivado do texto de envio da página ("Enviado pelo FULL" / "Full Super"). */
  full: boolean | null;
  // --- Campos novos (T1/ADR-0125, paridade Hunter) — tudo já pago, zero chamada extra. ---
  /** = idPublicacao (item_id do anúncio no ML). Chave primária de casamento com a ficha (D4). */
  item_id: string | null;
  /** = idProdutoCatalogo. Atalho de casamento quando o anúncio está em catálogo (só 6/20 no dataset medido). */
  catalog_product_id: string | null;
  avaliacao_nota: number | null;
  avaliacao_qtd: number | null;
  /** Posição na busca (1-based). NÃO diz se é orgânica — ver `patrocinado`. */
  posicao: number | null;
  /** tipoResultado !== 'ORGANIC'. NUNCA o campo `patrocinado` do actor — vazio em 0/20 no dataset medido. */
  patrocinado: boolean | null;
  /** Selo do ML, ex. "MAIS VENDIDO". */
  selo: string | null;
  preco_anterior: number | null;
  desconto_pct: number | null;
  /** Mesmo padrão do `full`, a partir do mesmo texto de envio. */
  flex: boolean | null;
  /** = produtoCategoryID (20/20 no dataset medido 18/08) — simulador de margem sem preditor. */
  category_id: string | null;
}

/** Raio-X do nicho a partir da MESMA amostra já paga (custo extra zero). Contagens são DA
 *  AMOSTRA (a UI rotula); só `total_anuncios` é absoluto — o "8.973 resultados" que o próprio
 *  ML imprime na página de busca. A busca oficial /sites/MLB/search devolve 403 para o app
 *  (testado 18/08 com token de user válido), então página raspada é a única fonte disso. */
export interface RaioXNicho {
  total_anuncios: number | null;
  ticket_medio: number | null;
  lojas_oficiais: number;
  full: number;
  frete_gratis: number;
  internacionais: number;
}

export interface PainelVendasSonar {
  termo: string;
  gerado_em: string;
  itens_analisados: number;
  itens_com_vendas: number;
  vendas_totais: number;
  valor_mercado: number; // Σ preço × vendidos, só onde ambos existem
  produto_destaque: ItemVendas | null;
  palavras_chave_titulos: Array<{ termo: string; contagem: number }>;
  raio_x: RaioXNicho;
  /** Índice por `item_id` (D4/ADR-0125) — cruzamento ficha↔anúncio vive no front (ADR-0122). */
  por_anuncio: Record<string, ItemVendas>;
  /** Amostra completa na ordem da busca — a tabela do front nasce daqui (item sem item_id
   *  fica fora de por_anuncio, mas continua sendo uma linha da tabela). Aditivo (D5). */
  itens: ItemVendas[];
}

/** "+500 vendidos" | "5 mil" | 500 → inteiro; sem dado/ilegível → null (nunca 0). */
export function parseVendidos(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.toLowerCase();
  const m = s.match(/([\d.,]+)/);
  if (!m) return null;
  // pt-BR: ponto é milhar ("1.000"), vírgula é decimal ("5,5 mil")
  let n = Number(m[1].replace(/\./g, '').replace(',', '.'));
  if (s.includes('mil')) n *= 1000;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** "4299" | "4.299,90" | "R$ 129,90" | 4299 → número; ilegível/≤0 → null. */
export function parsePrecoApify(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "4.299" = milhar pt-BR
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/** vendedorID do actor: string numérica ou número; ausente/inválido → null. */
export function parseSellerId(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** produtoReviews: "4.9" | "4,9" → número; fora de 0–5 (ex. "6", nota inválida) → null. */
const parseAvaliacaoNota = (v: unknown): number | null => {
  const n = parsePrecoApify(v);
  return n != null && n <= 5 ? n : null;
};

/** posicaoItem: inteiro ≥1 (posição na busca é 1-based); qualquer outra coisa → null. */
const parsePosicao = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;

/** tipoResultado: só 'ORGANIC' vira false — qualquer outra string não-vazia é patrocinado.
 *  NUNCA usar o campo `patrocinado` do actor (vazio em 0/20 no dataset medido, ADR-0125). */
const parsePatrocinado = (v: unknown): boolean | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() !== 'ORGANIC' : null;

/** precoDiscount: "13% OFF" → 13. */
const parseDescontoPct = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const m = v.match(/(\d+)\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** "8.973 resultados" (campo `resultadosTotais`, igual em todos os itens) → 8973. */
export function parseTotalAnuncios(json: unknown): number | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const v = (json[0] as Record<string, unknown>).resultadosTotais;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
  if (typeof v !== 'string') return null;
  const digitos = v.replace(/\D/g, '');
  const n = Number(digitos);
  return digitos !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

/** Dataset cru do actor → itens tipados. Item sem título é descartado (não dá pra exibir). */
export function parseItensApify(json: unknown): ItemVendas[] {
  if (!Array.isArray(json)) return [];
  const out: ItemVendas[] = [];
  for (const r of json) {
    const o = r as Record<string, unknown>;
    const titulo = str(o.eTituloProduto);
    if (!titulo) continue;
    const envio = str(o.envio);
    out.push({
      titulo,
      preco: parsePrecoApify(o.novoPreco),
      vendidos: parseVendidos(o.quantidadeVendida),
      link: str(o.zProdutoLink),
      imagem: str(o.imagemLink),
      vendedor: str(o.Vendedor),
      seller_id: parseSellerId(o.vendedorID),
      frete_gratis: bool(o.freteGratis),
      loja_oficial: bool(o.lojaOficial),
      internacional: bool(o.eCompraInternacional),
      full: envio === null ? null : /full/i.test(envio),
      item_id: str(o.idPublicacao),
      catalog_product_id: str(o.idProdutoCatalogo),
      avaliacao_nota: parseAvaliacaoNota(o.produtoReviews),
      avaliacao_qtd: parseVendidos(o.numeroAvaliacoes),
      posicao: parsePosicao(o.posicaoItem),
      patrocinado: parsePatrocinado(o.tipoResultado),
      selo: str(o.highlight),
      preco_anterior: parsePrecoApify(o.precoAnterior),
      desconto_pct: parseDescontoPct(o.precoDiscount),
      flex: envio === null ? null : /flex/i.test(envio),
      category_id: str(o.produtoCategoryID),
    });
  }
  return out;
}

/** Índice por `item_id` (D4/ADR-0125) — item sem `item_id` fica fora; colisão fica com o
 *  primeiro (mesma convenção do destaque abaixo: ordem de relevância da busca do ML). */
export function indexarPorAnuncio(itens: ItemVendas[]): Record<string, ItemVendas> {
  const out: Record<string, ItemVendas> = {};
  for (const item of itens) {
    if (!item.item_id || out[item.item_id]) continue;
    out[item.item_id] = item;
  }
  return out;
}

/** Agregador puro. produto_destaque = maior `vendidos` (> 0); empate fica com o primeiro
 *  (ordem de relevância da busca do ML). */
export function montarPainelVendas(
  termo: string,
  itens: ItemVendas[],
  totalAnuncios: number | null = null,
): PainelVendasSonar {
  let vendasTotais = 0;
  let valorMercado = 0;
  let comVendas = 0;
  let destaque: ItemVendas | null = null;
  const precos: number[] = [];
  const conta = { lojas_oficiais: 0, full: 0, frete_gratis: 0, internacionais: 0 };
  for (const item of itens) {
    if (item.preco != null) precos.push(item.preco);
    if (item.loja_oficial === true) conta.lojas_oficiais += 1;
    if (item.full === true) conta.full += 1;
    if (item.frete_gratis === true) conta.frete_gratis += 1;
    if (item.internacional === true) conta.internacionais += 1;
    if (item.vendidos == null) continue;
    comVendas += 1;
    vendasTotais += item.vendidos;
    if (item.preco != null) valorMercado += item.preco * item.vendidos;
    if (item.vendidos > 0 && (destaque == null || item.vendidos > (destaque.vendidos ?? 0))) {
      destaque = item;
    }
  }
  return {
    termo,
    gerado_em: new Date().toISOString(),
    itens_analisados: itens.length,
    itens_com_vendas: comVendas,
    vendas_totais: vendasTotais,
    valor_mercado: valorMercado,
    produto_destaque: destaque,
    palavras_chave_titulos: extrairPalavrasChave(itens.map((i) => i.titulo)),
    por_anuncio: indexarPorAnuncio(itens),
    itens,
    raio_x: {
      total_anuncios: totalAnuncios,
      ticket_medio: precos.length > 0 ? precos.reduce((a, b) => a + b, 0) / precos.length : null,
      ...conta,
    },
  };
}

// --- Snapshot histórico (ADR-0127/D7): shape exato da tabela sonar_snapshots -------------------
export interface LinhaSnapshot {
  termo: string;
  gerado_em: string;
  item_id: string;
  titulo: string;
  preco: number | null;
  vendidos: number | null;   // cru pós-parseVendidos; delta futuro = PISO (D13), null nunca 0
  posicao: number | null;
  patrocinado: boolean | null;
  vendedor: string | null;
  catalog_product_id: string | null;
}

/** Item sem item_id fica fora: sem chave não há série. LOUD: nulls passam intactos. */
export function linhasSnapshot(termo: string, geradoEm: string, itens: ItemVendas[]): LinhaSnapshot[] {
  const out: LinhaSnapshot[] = [];
  for (const i of itens) {
    if (!i.item_id) continue;
    out.push({
      termo, gerado_em: geradoEm, item_id: i.item_id, titulo: i.titulo, preco: i.preco,
      vendidos: i.vendidos, posicao: i.posicao, patrocinado: i.patrocinado,
      vendedor: i.vendedor, catalog_product_id: i.catalog_product_id,
    });
  }
  return out;
}
