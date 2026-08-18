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
  frete_gratis: boolean | null;
  loja_oficial: boolean | null;
  internacional: boolean | null;
  /** Derivado do texto de envio da página ("Enviado pelo FULL" / "Full Super"). */
  full: boolean | null;
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
      frete_gratis: bool(o.freteGratis),
      loja_oficial: bool(o.lojaOficial),
      internacional: bool(o.eCompraInternacional),
      full: envio === null ? null : /full/i.test(envio),
    });
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
    raio_x: {
      total_anuncios: totalAnuncios,
      ticket_medio: precos.length > 0 ? precos.reduce((a, b) => a + b, 0) / precos.length : null,
      ...conta,
    },
  };
}
