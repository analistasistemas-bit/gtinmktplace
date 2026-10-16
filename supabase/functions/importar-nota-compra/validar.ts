// ADR-0181 D-2 — o servidor lê o próprio XML; do navegador só vêm as decisões do operador.
import { lerNfe } from '../_shared/nfe/ler-nfe.ts';
import {
  chaveNfeValida, cfopAceito, conciliarItens, quantidadeEmEstoque, erroDistribuicao,
} from '../_shared/nfe/regras.ts';
import type { DecisaoImportacao, ItemConciliado, NotaCompraLida } from '../_shared/nfe/tipos.ts';

const TETO_XML = 1_048_576;
const ehTexto = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const ehNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function decisoesValidas(v: unknown): DecisaoImportacao[] | null {
  if (!Array.isArray(v)) return null;
  const out: DecisaoImportacao[] = [];
  for (const d of v as Array<Record<string, unknown>>) {
    if (!d || !ehNum(d.nItem) || !ehTexto(d.codigoPai) || !ehNum(d.fator) || !Array.isArray(d.distribuicao)) return null;
    const dist = [];
    for (const l of d.distribuicao as Array<Record<string, unknown>>) {
      if (!l || !ehTexto(l.codigo) || !ehNum(l.quantidade) || !ehNum(l.custoPrecificacao)) return null;
      dist.push({ codigo: l.codigo.trim(), quantidade: l.quantidade, custoPrecificacao: l.custoPrecificacao });
    }
    out.push({ nItem: d.nItem, codigoPai: d.codigoPai.trim(), fator: d.fator, distribuicao: dist });
  }
  return out;
}

export function validarImportacao(
  body: unknown, cnpjOrg: string,
): { ok: true; nota: NotaCompraLida; itens: ItemConciliado[]; decisoes: DecisaoImportacao[]; xml: string; divergenciaTotal: number } | { ok: false; erro: string } {
  const b = (body ?? {}) as { xml?: unknown; decisoes?: unknown };
  if (typeof b.xml !== 'string') return { ok: false, erro: 'Envie o XML da nota.' };
  if (b.xml.length > TETO_XML) return { ok: false, erro: 'O XML passa de 1 MB.' };
  const decisoes = decisoesValidas(b.decisoes);
  if (!decisoes) return { ok: false, erro: 'Decisões por item em formato inválido.' };

  const aceitarDivergencia = (body as { aceitarDivergenciaTotal?: unknown })?.aceitarDivergenciaTotal === true;
  const lida = lerNfe(b.xml);
  if (!lida.ok) return { ok: false, erro: lida.erro };
  const nota = lida.nota;
  if (!chaveNfeValida(nota.chave)) return { ok: false, erro: 'Chave de acesso inválida (dígito verificador).' };
  if (nota.modelo !== 55) return { ok: false, erro: 'Só NF-e modelo 55 é aceita.' };
  if (nota.tipoNf !== 1) return { ok: false, erro: 'A nota precisa ser de saída do fornecedor (venda).' };
  if (nota.cStat !== null && nota.cStat !== 100) return { ok: false, erro: `A nota não está autorizada (cStat ${nota.cStat}).` };
  if (nota.destinatarioCnpj.replace(/\D/g, '') !== cnpjOrg.replace(/\D/g, '')) {
    return { ok: false, erro: 'O destinatário da nota não é o CNPJ desta empresa.' };
  }
  for (const i of nota.itens) {
    if (!cfopAceito(i.cfop)) return { ok: false, erro: `Item ${i.nItem}: CFOP ${i.cfop} não é de venda/revenda — nota recusada.` };
  }
  const conc = conciliarItens(nota);
  if (!conc.ok) return { ok: false, erro: conc.erro };
  if (conc.divergenciaTotal !== 0 && !aceitarDivergencia) {
    return { ok: false, erro: `${conc.avisoTotal} Marque a confirmação de divergência para seguir.` };
  }

  const porItem = new Map(decisoes.map((d) => [d.nItem, d]));
  if (porItem.size !== decisoes.length) return { ok: false, erro: 'Decisão repetida para o mesmo item.' };
  for (const d of decisoes) {
    if (!nota.itens.some((i) => i.nItem === d.nItem)) return { ok: false, erro: `Item ${d.nItem} não existe na nota.` };
  }
  for (const item of conc.itens) {
    const d = porItem.get(item.nItem);
    if (!d) return { ok: false, erro: `Item ${item.nItem} (${item.xProd}) está sem produto definido.` };
    const q = quantidadeEmEstoque(item.qCom, d.fator);
    if (!q.ok) return { ok: false, erro: `Item ${item.nItem}: ${q.erro}` };
    const e = erroDistribuicao(q.quantidade, d.distribuicao);
    if (e) return { ok: false, erro: `Item ${item.nItem}: ${e}` };
  }
  return { ok: true, nota, itens: conc.itens, decisoes, xml: b.xml, divergenciaTotal: conc.divergenciaTotal };
}
