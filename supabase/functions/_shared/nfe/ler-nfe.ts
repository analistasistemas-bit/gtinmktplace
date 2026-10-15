// ADR-0181 D-2 — leitura do XML da NF-e de compra, pura (front e edge). Extração textual do
// subconjunto da NF-e: aceita o XML da SEFAZ (nItem atributo, Signature) e a exportação de ERP
// (nItem elemento, sem Signature).
// ponytail: não é um parser XML genérico — não trata CDATA nem tags homônimas aninhadas (a NF-e
// não as usa nos campos lidos). Comentários são removidos; exige uma única infNFe; protocolo é
// casado pela chave. Upgrade: parser XML completo se aparecer leiaute fora disso.
import type { ItemNotaLido, NotaCompraLida, TotaisNota } from './tipos.ts';
import { gtinValido } from './regras.ts';

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENT[e]);
// Prefixo de namespace XML válido (NCName): letras, dígitos, '-', '_', '.'.
const PFX = '(?:[A-Za-z_][\\w.-]*:)?';

function blocos(xml: string, tag: string): Array<{ attrs: string; corpo: string }> {
  const re = new RegExp(`<${PFX}${tag}\\b([^>]*)>([\\s\\S]*?)</${PFX}${tag}>`, 'g');
  return Array.from(xml.matchAll(re), (m) => ({ attrs: m[1], corpo: m[2] }));
}
const bloco = (xml: string | null, tag: string): string | null => (xml === null ? null : blocos(xml, tag)[0]?.corpo ?? null);
function texto(xml: string | null, tag: string): string | null {
  if (xml === null) return null;
  const m = xml.match(new RegExp(`<${PFX}${tag}\\b[^>]*>([^<]*)</${PFX}${tag}>`));
  const t = m ? decodificar(m[1]).trim() : '';
  return t === '' ? null : t;
}

class ErroLeitura extends Error {}
function numero(xml: string | null, tag: string, obrigatorio = false): number {
  const t = texto(xml, tag);
  if (t === null) { if (obrigatorio) throw new ErroLeitura(`Campo ${tag} ausente.`); return 0; }
  const n = Number(t);
  if (!Number.isFinite(n)) throw new ErroLeitura(`Campo ${tag} com valor inválido: ${t}.`);
  return n;
}
const obrig = (xml: string | null, tag: string): string => {
  const t = texto(xml, tag);
  if (t === null) throw new ErroLeitura(`Campo ${tag} ausente.`);
  return t;
};

export function lerNfe(entrada: string): { ok: true; nota: NotaCompraLida } | { ok: false; erro: string } {
  try {
    // Comentários e instruções de processamento não são documento: removidos antes de tudo.
    // A declaração XML só vale no início; qualquer outra <?...?> (inclusive <?xml-...?>) é removida.
    const xml = entrada.replace(/^\uFEFF?\s*<\?xml\s[^?]*\?>/, '')
      .replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
    const infs = blocos(xml, 'infNFe');
    if (infs.length === 0) return { ok: false, erro: 'O arquivo não é uma NF-e (falta infNFe).' };
    if (infs.length > 1) return { ok: false, erro: 'O arquivo tem mais de uma NF-e; envie uma nota por arquivo.' };
    const inf = infs[0];
    const chave = inf.attrs.match(/Id="NFe(\d{44})"/)?.[1] ?? '';
    const ide = bloco(inf.corpo, 'ide');
    const emit = bloco(inf.corpo, 'emit');
    const dest = bloco(inf.corpo, 'dest');
    const tot = bloco(inf.corpo, 'ICMSTot');
    // Protocolo é associado à NF-e pela chave; protocolo sem status NÃO é "sem protocolo".
    const temProtocolo = new RegExp(`<${PFX}protNFe\\b`).test(xml);
    const prot = bloco(xml, 'infProt');
    const cStat = texto(prot, 'cStat');
    if (temProtocolo && prot === null) return { ok: false, erro: 'O protocolo de autorização está incompleto.' };
    if (prot !== null) {
      if (cStat === null) return { ok: false, erro: 'O protocolo de autorização está sem status (cStat).' };
      const chProt = texto(prot, 'chNFe');
      if (chProt !== chave) return { ok: false, erro: 'A chave do protocolo não corresponde à chave da NF-e.' };
    }

    const dets = blocos(inf.corpo, 'det');
    if (dets.length === 0) return { ok: false, erro: 'A nota não tem itens.' };
    const itens: ItemNotaLido[] = dets.map((det) => {
      const prod = bloco(det.corpo, 'prod');
      const imposto = bloco(det.corpo, 'imposto');
      const icms = bloco(imposto, 'ICMS');
      const ipi = bloco(imposto, 'IPI');
      const gtin = texto(prod, 'cEAN');
      const orig = texto(icms, 'orig');
      const nItem = Number(det.attrs.match(/nItem="(\d+)"/)?.[1] ?? texto(det.corpo, 'nItem'));
      if (!Number.isInteger(nItem) || nItem < 1) throw new ErroLeitura('Item sem nItem válido.');
      return {
        nItem,
        cProd: obrig(prod, 'cProd'), xProd: obrig(prod, 'xProd'),
        ncm: texto(prod, 'NCM'), cfop: obrig(prod, 'CFOP'),
        gtin: gtin && gtinValido(gtin) ? gtin : null,
        uCom: obrig(prod, 'uCom'), qCom: numero(prod, 'qCom', true),
        vProd: numero(prod, 'vProd', true), vFrete: numero(prod, 'vFrete'), vSeg: numero(prod, 'vSeg'),
        vDesc: numero(prod, 'vDesc'), vOutro: numero(prod, 'vOutro'),
        vIPI: numero(ipi, 'vIPI'), vST: numero(icms, 'vICMSST'), vFCPST: numero(icms, 'vFCPST'),
        orig: orig === null ? null : Number(orig),
      };
    });

    const totais: TotaisNota = {
      vProd: numero(tot, 'vProd', true), vFrete: numero(tot, 'vFrete'), vSeg: numero(tot, 'vSeg'),
      vDesc: numero(tot, 'vDesc'), vOutro: numero(tot, 'vOutro'), vIPI: numero(tot, 'vIPI'),
      vST: numero(tot, 'vST'), vII: numero(tot, 'vII'), vIPIDevol: numero(tot, 'vIPIDevol'),
      vFCPST: numero(tot, 'vFCPST'), vNF: numero(tot, 'vNF', true),
    };
    return {
      ok: true,
      nota: {
        chave,
        numero: numero(ide, 'nNF', true), serie: numero(ide, 'serie', true),
        modelo: numero(ide, 'mod', true), tipoNf: numero(ide, 'tpNF', true),
        emitidaEm: obrig(ide, 'dhEmi'),
        emitenteCnpj: obrig(emit, 'CNPJ'), emitenteNome: obrig(emit, 'xNome'),
        destinatarioCnpj: texto(dest, 'CNPJ') ?? '',
        totais,
        assinada: new RegExp(`<${PFX}Signature\\b`).test(xml),
        cStat: cStat === null ? null : Number(cStat),
        itens,
      },
    };
  } catch (e) {
    if (e instanceof ErroLeitura) return { ok: false, erro: e.message };
    throw e;
  }
}
