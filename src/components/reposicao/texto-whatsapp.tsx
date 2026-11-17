// Spec 2026-11-16-reposicao §3.5: itens do pedido na ordem da prancheta (produto, cor A→Z, tamanho na ordem
// da grade) e o texto que a loja cola no WhatsApp do fornecedor. Puro: o sistema não envia nada.
import { ordenarEixos } from '@/lib/cadastro-grade';
import type { FamiliaTela, PedidoDTO, PedidoItemDTO, SkuTela } from '../../../supabase/functions/_shared/reposicao/tipos';
import { TAMANHOS_CANONICOS } from './mapa-grade';
import { fmtDia } from './por-que';

export interface ItemRotulado {
  item: PedidoItemDTO; produto: string; cor: string | null; tamanho: string | null; custo: number | null;
  /** "Short Bermuda Preto P": nome do campo e da linha. */
  rotulo: string;
}

export function itensOrdenados(pedido: PedidoDTO, skus: SkuTela[], familias: FamiliaTela[]): ItemRotulado[] {
  const skuPor = new Map(skus.map((s) => [s.codigo, s]));
  const nomePor = new Map(familias.map((f) => [f.codigoPai, f.nome]));
  const linhas = pedido.itens.map((item) => {
    const s = skuPor.get(item.codigo);
    const produto = nomePor.get(item.codigoPai) ?? item.codigoPai;
    // SKU fora da tela (kit, apagado): o código no lugar do tamanho, para não somar com outro SKU.
    const tamanho = s ? s.tamanho : `SKU ${item.codigo}`;
    const cor = s?.cor ?? null;
    return { item, produto, cor, tamanho, custo: s?.custo ?? null, rotulo: [produto, cor, tamanho].filter(Boolean).join(' ') };
  });
  const ordemTam = ordenarEixos(new Set(), new Set(linhas.map((l) => l.tamanho ?? '')), { cores: [], tamanhos: TAMANHOS_CANONICOS }).tamanhos;
  return linhas.sort((a, b) => a.produto.localeCompare(b.produto, 'pt-BR') || a.item.codigoPai.localeCompare(b.item.codigoPai)
    || (a.cor ?? '').localeCompare(b.cor ?? '', 'pt-BR')
    || ordemTam.indexOf(a.tamanho ?? '') - ordemTam.indexOf(b.tamanho ?? ''));
}

/** Linhas já ordenadas, agrupadas por produto (codigoPai, não nome: duas famílias de mesmo nome não se misturam). */
export function porProduto(linhas: ItemRotulado[]): { codigoPai: string; produto: string; linhas: ItemRotulado[] }[] {
  const grupos = new Map<string, { codigoPai: string; produto: string; linhas: ItemRotulado[] }>();
  for (const l of linhas) {
    const g = grupos.get(l.item.codigoPai) ?? { codigoPai: l.item.codigoPai, produto: l.produto, linhas: [] };
    g.linhas.push(l);
    grupos.set(l.item.codigoPai, g);
  }
  return [...grupos.values()];
}

/** Prancheta: o produto uma vez ("Calça Sarja (cód. RS-169)") e uma linha por cor ("Marrom Escuro: 38×2 · 40×1").
 *  Produto sem cor cabe numa linha só ("Cinto Couro: 2"). */
export function textoWhatsApp(pedido: PedidoDTO, skus: SkuTela[], familias: FamiliaTela[]): string {
  const blocos = porProduto(itensOrdenados(pedido, skus, familias)).map((p) => {
    const cores = new Map<string, { partes: string[]; semGrade: number }>();
    for (const l of p.linhas) {
      const c = cores.get(l.cor ?? '') ?? { partes: [], semGrade: 0 };
      if (l.tamanho) c.partes.push(`${l.tamanho}×${l.item.quantidade}`);
      else c.semGrade += l.item.quantidade;
      cores.set(l.cor ?? '', c);
    }
    const qtd = (c: { partes: string[]; semGrade: number }) => [...c.partes, ...(c.semGrade ? [String(c.semGrade)] : [])].join(' · ');
    const cod = p.linhas.find((l) => l.item.codigoFornecedor)?.item.codigoFornecedor;
    const nome = `${p.produto}${cod ? ` (cód. ${cod})` : ''}`;
    const semCor = cores.get('');
    if (cores.size === 1 && semCor) return [`${nome}: ${qtd(semCor)}`];
    return [nome, ...[...cores].map(([cor, c]) => `${cor || 'Sem cor'}: ${qtd(c)}`)];
  });
  const total = pedido.itens.reduce((a, i) => a + i.quantidade, 0);
  const data = pedido.previstoPara ? [`Entrega prevista: ${fmtDia(pedido.previstoPara)}/${pedido.previstoPara.slice(0, 4)}`] : [];
  return [`Pedido de compra · ${pedido.fornecedor.nome}`, ...data, '', ...blocos.flatMap((b) => [...b, '']), `Total: ${total} ${total === 1 ? 'unidade' : 'unidades'}`].join('\n');
}
