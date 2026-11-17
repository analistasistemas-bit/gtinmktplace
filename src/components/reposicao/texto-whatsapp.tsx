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

/** "Calça Sarja Marrom Escuro: 38×2 40×1 42×6 (cód. RS-169)": uma linha por produto e cor. */
export function textoWhatsApp(pedido: PedidoDTO, skus: SkuTela[], familias: FamiliaTela[]): string {
  const grupos = new Map<string, { nome: string; cod: string | null; partes: string[]; semGrade: number }>();
  for (const l of itensOrdenados(pedido, skus, familias)) {
    // Chave pelo produto (codigoPai), não pelo nome: duas famílias de mesmo nome não se misturam.
    const chave = `${l.item.codigoPai}\u0000${l.cor ?? ''}`;
    const nome = [l.produto, l.cor].filter(Boolean).join(' ');
    const g = grupos.get(chave) ?? { nome, cod: l.item.codigoFornecedor, partes: [], semGrade: 0 };
    if (l.tamanho) g.partes.push(`${l.tamanho}×${l.item.quantidade}`);
    else g.semGrade += l.item.quantidade;
    grupos.set(chave, g);
  }
  const linhas = [...grupos.values()].map((g) => {
    const qtd = [...g.partes, ...(g.semGrade ? [String(g.semGrade)] : [])].join(' ');
    return `${g.nome}: ${qtd}${g.cod ? ` (cód. ${g.cod})` : ''}`;
  });
  const total = pedido.itens.reduce((a, i) => a + i.quantidade, 0);
  const data = pedido.previstoPara ? [`Entrega prevista: ${fmtDia(pedido.previstoPara)}/${pedido.previstoPara.slice(0, 4)}`] : [];
  return [`Pedido de compra · ${pedido.fornecedor.nome}`, ...data, '', ...linhas, '', `Total: ${total} ${total === 1 ? 'unidade' : 'unidades'}`].join('\n');
}
