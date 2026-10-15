// ADR-0181 — regras puras da nota de compra. Importado pelo front e pela edge: só imports
// relativos folha, sem jsr:/npm:/Deno.
import type { CampoAcessorio, ItemConciliado, LinhaDistribuicao, NotaCompraLida } from './tipos.ts';
import { ORIGENS_NFE_POR_ORIGEM } from '../fiscal/validar.ts';

export function chaveNfeValida(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;
  let soma = 0;
  let peso = 2;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return (r < 2 ? 0 : 11 - r) === Number(chave[43]);
}

export function gtinValido(gtin: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) return false;
  const d = gtin.split('').map(Number);
  const dv = d.pop()!;
  const soma = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === dv;
}

// D-2: só venda/revenda do fornecedor (com e sem ST).
export const CFOPS_ACEITOS: ReadonlySet<string> = new Set([
  '5101', '5102', '5103', '5104', '5105', '5106',
  '6101', '6102', '6103', '6104', '6105', '6106', '6107', '6108',
  '5401', '5402', '5403', '5405', '6401', '6402', '6403', '6404',
]);
export const cfopAceito = (cfop: string): boolean => CFOPS_ACEITOS.has(cfop.trim());

export function quantidadeEmEstoque(
  qCom: number, fator: number,
): { ok: true; quantidade: number } | { ok: false; erro: string } {
  if (!Number.isInteger(fator) || fator < 1) {
    return { ok: false, erro: 'O fator de conversão precisa ser um número inteiro maior ou igual a 1.' };
  }
  const q = qCom * fator;
  const arred = Math.round(q);
  if (!Number.isFinite(q) || Math.abs(q - arred) > 1e-6 || arred <= 0) {
    return { ok: false, erro: `A quantidade (${qCom} × ${fator}) precisa fechar em uma quantidade inteira de unidades.` };
  }
  return { ok: true, quantidade: arred };
}

const CAMPOS: CampoAcessorio[] = ['vFrete', 'vSeg', 'vDesc', 'vOutro', 'vIPI', 'vST', 'vFCPST'];
const cent = (n: number) => Math.round(n * 100);

/** Divide `total` (centavos) proporcionalmente a `pesos` pelos maiores restos: soma exata, sem negativos.
 *  Empate de resto → menor `desempate` (o nItem). */
function maioresRestos(total: number, pesos: number[], desempate: number[]): number[] {
  const somaPesos = pesos.reduce((s, p) => s + p, 0);
  const brutos = pesos.map((p) => (total * p) / somaPesos);
  const partes = brutos.map(Math.floor);
  let sobra = total - partes.reduce((s, p) => s + p, 0);
  const ordem = brutos.map((b, i) => ({ i, resto: b - Math.floor(b) }))
    .sort((a, b) => b.resto - a.resto || desempate[a.i] - desempate[b.i]);
  for (const { i } of ordem) { if (sobra <= 0) break; partes[i] += 1; sobra -= 1; }
  return partes;
}

export function conciliarItens(
  nota: NotaCompraLida,
): { ok: true; itens: ItemConciliado[]; avisoTotal: string | null; divergenciaTotal: number } | { ok: false; erro: string } {
  const itens: ItemConciliado[] = nota.itens.map((i) => ({ ...i, rateio: {} }));
  // Fora do suporte (compra nacional para revenda): imposto de importação e IPI devolvido.
  if (nota.totais.vII > 0) return { ok: false, erro: 'Nota com Imposto de Importação (vII) não é suportada — é compra de importação direta.' };
  if (nota.totais.vIPIDevol > 0) return { ok: false, erro: 'Nota com IPI devolvido (vIPIDevol) não é compra para revenda.' };
  const negativo = [...itens.flatMap((i) => [i.vProd, ...CAMPOS.map((c) => i[c])]), ...Object.values(nota.totais)]
    .some((v) => v < 0);
  if (negativo) return { ok: false, erro: 'A nota tem valor negativo — não é possível conferir os totais.' };

  const prodItens = itens.map((i) => cent(i.vProd));
  const somaProd = prodItens.reduce((s, v) => s + v, 0);
  if (somaProd !== cent(nota.totais.vProd)) {
    return { ok: false, erro: `A soma dos itens (${somaProd / 100}) não bate com o total de produtos da nota (${nota.totais.vProd}).` };
  }
  for (const campo of CAMPOS) {
    const somaItens = itens.reduce((s, i) => s + cent(i[campo]), 0);
    const total = cent(nota.totais[campo]);
    if (somaItens === total) continue;
    if (somaItens !== 0 || somaProd === 0) {
      return { ok: false, erro: `Os totais de ${campo} não batem entre os itens e o total da nota.` };
    }
    maioresRestos(total, prodItens, itens.map((i) => i.nItem)).forEach((parte, idx) => {
      itens[idx][campo] = parte / 100;
      if (parte > 0) itens[idx].rateio[campo] = parte / 100;
    });
  }
  const t = nota.totais;
  const composto = cent(t.vProd) - cent(t.vDesc) + cent(t.vST) + cent(t.vFCPST) + cent(t.vFrete) + cent(t.vSeg)
    + cent(t.vOutro) + cent(t.vII) + cent(t.vIPI) + cent(t.vIPIDevol);
  const diff = cent(t.vNF) - composto;
  const avisoTotal = diff === 0 ? null
    : `O total da nota (${t.vNF}) difere da soma dos componentes (${composto / 100}). Confira antes de confirmar.`;
  return { ok: true, itens, avisoTotal, divergenciaTotal: diff / 100 };
}

export function custoAquisicaoUnit(item: ItemConciliado, fator: number): number {
  const total = item.vProd + item.vFrete + item.vSeg + item.vOutro + item.vIPI + item.vST + item.vFCPST - item.vDesc;
  return total / (item.qCom * fator);
}

export function erroDistribuicao(esperado: number, linhas: LinhaDistribuicao[]): string | null {
  const vistos = new Set<string>();
  let soma = 0;
  for (const l of linhas) {
    if (vistos.has(l.codigo)) return `SKU repetido na distribuição: ${l.codigo}.`;
    vistos.add(l.codigo);
    if (!Number.isInteger(l.quantidade)) return `A quantidade de ${l.codigo} precisa ser inteira.`;
    if (l.quantidade <= 0) return `A quantidade de ${l.codigo} precisa ser maior que zero.`;
    if (!(Number.isFinite(l.custoPrecificacao) && l.custoPrecificacao > 0)) return `O custo de ${l.codigo} precisa ser maior que zero.`;
    soma += l.quantidade;
  }
  if (soma !== esperado) return `A distribuição soma ${soma} de ${esperado} unidades da nota.`;
  return null;
}

export function limparDescricaoFornecedor(xProd: string): string {
  return xProd.replace(/(\s*-\s*DIV)+\s*$/i, '').replace(/\s+/g, ' ').trim();
}

const REVENDA_INTERNA: Record<number, number> = { 1: 2, 6: 7 };
export function origemSugerida(orig: number | null): { origemNfe: number; origem: 'nacional' | 'importado' } | null {
  if (orig === null || !Number.isInteger(orig) || orig < 0 || orig > 8) return null;
  const origemNfe = REVENDA_INTERNA[orig] ?? orig;
  return { origemNfe, origem: ORIGENS_NFE_POR_ORIGEM.nacional.includes(origemNfe) ? 'nacional' : 'importado' };
}
