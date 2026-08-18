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

/** Dataset cru do actor → itens tipados. Item sem título é descartado (não dá pra exibir). */
export function parseItensApify(json: unknown): ItemVendas[] {
  if (!Array.isArray(json)) return [];
  const out: ItemVendas[] = [];
  for (const r of json) {
    const o = r as Record<string, unknown>;
    const titulo = str(o.eTituloProduto);
    if (!titulo) continue;
    out.push({
      titulo,
      preco: parsePrecoApify(o.novoPreco),
      vendidos: parseVendidos(o.quantidadeVendida),
      link: str(o.zProdutoLink),
      imagem: str(o.imagemLink),
      vendedor: str(o.Vendedor),
    });
  }
  return out;
}

/** Agregador puro. produto_destaque = maior `vendidos` (> 0); empate fica com o primeiro
 *  (ordem de relevância da busca do ML). */
export function montarPainelVendas(termo: string, itens: ItemVendas[]): PainelVendasSonar {
  let vendasTotais = 0;
  let valorMercado = 0;
  let comVendas = 0;
  let destaque: ItemVendas | null = null;
  for (const item of itens) {
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
  };
}
