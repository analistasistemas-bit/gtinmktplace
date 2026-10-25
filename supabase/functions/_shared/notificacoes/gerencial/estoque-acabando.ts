// Seleção pura de "estoque acabando" do resumo diário (fase 1): campeões de lucro 30d que vão faltar.
// Cobertura = `coberturaDias` da tela Vendas SKU (src/lib/vendas-sku.ts); o teste garante a paridade.
import { diaBrt } from './janelas.ts';
import { nomeSku } from './nome-sku.ts';
import type { ResultadoItem } from './resultado.ts';

export interface CatalogoEstoque { codigo: string; estoque: number | null; ehKit: boolean; nome: string | null; nomeFamilia: string | null }
export interface ItemEstoque { codigo: string; nome: string; estoque: number; porDia: number; cobertura: number | null; zerado: boolean; lucro30: number }

export const CAMPEOES = 20;
export const MIN_DIAS_VENDA = 3;
export const COBERTURA_ALERTA = 7;
export const ZERADO_VENDA_RECENTE_DIAS = 7;
export const JANELA_DIAS = 30;

/** Dias até acabar no ritmo dos últimos 30 dias; estoque ≤ 0 → 0 (a tela daria negativo). */
export function coberturaResumo(estoque: number, unidades30: number): number {
  if (estoque <= 0) return 0;
  return Math.floor(estoque / (unidades30 / JANELA_DIAS));
}

interface Acc { unidades: number; lucro: number | null; dias: Set<string>; ultima: number }

export function selecionarEstoqueAcabando(
  itens: ResultadoItem[], dataPorOrder: Map<number, string>, catalogo: Map<string, CatalogoEstoque>, fimJanela: string,
): ItemEstoque[] {
  const porCodigo = new Map<string, Acc>();
  for (const it of itens) {
    if (!it.faturavel || !it.codigo) continue;
    const data = dataPorOrder.get(it.orderId);
    if (!data) continue;
    const t = Date.parse(data);
    const a = porCodigo.get(it.codigo) ?? { unidades: 0, lucro: null, dias: new Set<string>(), ultima: -Infinity };
    a.unidades += it.quantidade;
    if (it.lucro != null) a.lucro = (a.lucro ?? 0) + it.lucro;
    a.dias.add(diaBrt(new Date(t)));
    a.ultima = Math.max(a.ultima, t);
    porCodigo.set(it.codigo, a);
  }

  const limite7 = Date.parse(fimJanela) - ZERADO_VENDA_RECENTE_DIAS * 24 * 3_600_000;
  const campeoes: { codigo: string; cat: CatalogoEstoque & { estoque: number }; a: Acc; lucro30: number }[] = [];
  for (const [codigo, a] of porCodigo) {
    const cat = catalogo.get(codigo);
    if (!cat || cat.ehKit || cat.estoque == null || a.lucro == null || a.dias.size < MIN_DIAS_VENDA) continue;
    campeoes.push({ codigo, cat: cat as CatalogoEstoque & { estoque: number }, a, lucro30: a.lucro });
  }
  campeoes.sort((x, y) => y.lucro30 - x.lucro30 || (x.codigo < y.codigo ? -1 : 1));

  const out: ItemEstoque[] = [];
  for (const { codigo, cat, a, lucro30 } of campeoes.slice(0, CAMPEOES)) {
    const zerado = cat.estoque <= 0;
    const cobertura = coberturaResumo(cat.estoque, a.unidades);
    if (zerado ? a.ultima < limite7 : cobertura >= COBERTURA_ALERTA) continue;
    out.push({ codigo, nome: nomeSku({ codigo, titulo: cat.nome, nomeFamilia: cat.nomeFamilia }), estoque: cat.estoque, porDia: a.unidades / JANELA_DIAS, cobertura, zerado, lucro30 });
  }
  // zerados por lucro; depois menor cobertura (desempate lucro, código). `campeoes` já vem por lucro/código.
  return out.sort((x, y) => Number(y.zerado) - Number(x.zerado) || (x.zerado ? 0 : (x.cobertura! - y.cobertura!)) || y.lucro30 - x.lucro30 || (x.codigo < y.codigo ? -1 : 1));
}
