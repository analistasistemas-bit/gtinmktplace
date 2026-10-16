// ADR-0181 Plano 2b-1 — lê as notas de compra do mês e monta linhas/totais/conferência. XML é a fonte fiscal.
import { lerNfe } from '../../../supabase/functions/_shared/nfe/ler-nfe.ts';
import type { NotaCompraLida } from '../../../supabase/functions/_shared/nfe/tipos.ts';
import type { ConferenciaCompras, LeituraCompras, LinhaCompra, NotaCompraRow, TotalNotaCompra, XmlCompra } from './tipos-compras';

const c = (n: number) => Math.round(n * 100);
const filhos = (e: Element, tag: string) => Array.from(e.children).filter((x) => x.localName === tag);
type Trib = { tipo: 'CSOSN' | 'CST' | ''; codigo: string };

/** lerNfe (reuso, sem alteração) + CSOSN/CST só de det/imposto/ICMS/<grupo> e o finNFe. */
export function lerCompra(texto: string):
  | { ok: true; nota: NotaCompraLida; trib: Map<number, Trib>; finNFe: string | null }
  | { ok: false; erro: string } {
  const lida = lerNfe(texto);
  if (!lida.ok) return { ok: false, erro: lida.erro };
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return { ok: false, erro: 'XML ilegível' };
  const trib = new Map<number, Trib>();
  for (const det of Array.from(doc.getElementsByTagNameNS('*', 'det'))) {
    // Atributo (SEFAZ) ou elemento <nItem> (exportação de ERP aceita pelo Plano 1).
    const n = Number(det.getAttribute('nItem') ?? filhos(det, 'nItem')[0]?.textContent?.trim());
    if (!Number.isInteger(n) || n <= 0) continue;
    const icms = filhos(det, 'imposto').flatMap((i) => filhos(i, 'ICMS'))[0];
    const grupo = icms ? Array.from(icms.children)[0] : undefined;
    const csosn = grupo ? filhos(grupo, 'CSOSN')[0]?.textContent?.trim() : undefined;
    const cst = grupo ? filhos(grupo, 'CST')[0]?.textContent?.trim() : undefined;
    trib.set(n, csosn ? { tipo: 'CSOSN', codigo: csosn } : cst ? { tipo: 'CST', codigo: cst } : { tipo: '', codigo: '' });
  }
  const finNFe = doc.getElementsByTagNameNS('*', 'finNFe')[0]?.textContent?.trim() ?? null;
  return { ok: true, nota: lida.nota, trib, finNFe };
}

const PASTA = { importada: 'compras/xmls/', desfeita: 'compras/xmls-desfeitas/', cancelada: 'compras/xmls-canceladas/' } as const;

export function montarCompras(mes: string, notas: NotaCompraRow[], xmls: Map<string, XmlCompra>): LeituraCompras {
  const conf: ConferenciaCompras = {
    mes, vazio: notas.length === 0, parcial: false, motivosParcial: [], selecionadas: notas.length, detalhadas: 0, itens: 0, comFalha: 0,
    desfeitas: [], canceladas: [], semAssinatura: [], finalidadeAtipica: [], indisponiveis: [], semHash: [], divergentes: [], ilegiveis: [],
    totalMesC: 0, totalSemDetalheC: 0,
  };
  const linhas: LinhaCompra[] = [];
  const totaisNota: TotalNotaCompra[] = [];
  const arquivos: Record<string, Uint8Array> = {};
  const dec = new TextDecoder();

  for (const n of notas) {
    const x = xmls.get(n.id) ?? { tipo: 'indisponivel' as const, motivo: 'não baixado' };
    if (!n.assinada) conf.semAssinatura.push(n.chave);
    // Mesma classificação para todas as situações: integridade → leitura.
    let falhou = false;
    let lida: Extract<ReturnType<typeof lerCompra>, { ok: true }> | null = null;
    if (x.tipo === 'ok') {
      arquivos[`${PASTA[n.status]}${n.chave}.xml`] = x.bytes;   // íntegro vai no zip, mesmo se ilegível
      const r = lerCompra(dec.decode(x.bytes));
      if (r.ok) lida = r; else { falhou = true; conf.ilegiveis.push({ chave: n.chave, erro: r.erro }); }
    } else {
      falhou = true;
      if (x.tipo === 'indisponivel') conf.indisponiveis.push({ chave: n.chave, motivo: x.motivo });
      else if (x.tipo === 'sem_hash') conf.semHash.push(n.chave);
      else conf.divergentes.push(n.chave);
    }
    if (falhou) conf.comFalha += 1;
    if (n.status !== 'importada') {
      (n.status === 'desfeita' ? conf.desfeitas : conf.canceladas)
        .push({ chave: n.chave, numero: n.numero, fornecedor: n.emitente_nome, em: n.desfeita_em, comXml: x.tipo === 'ok' });
      continue;
    }
    if (!lida) { conf.totalSemDetalheC += c(n.valor_total); continue; }
    const nota = lida.nota; const t = nota.totais;
    const instante = Date.parse(nota.emitidaEm);
    const fin = lida.finNFe ?? '';
    if (fin && fin !== '1') conf.finalidadeAtipica.push({ chave: n.chave, finNFe: fin });
    for (const it of nota.itens) {
      const trib = lida.trib.get(it.nItem) ?? { tipo: '' as const, codigo: '' };
      linhas.push({
        instante, emissao: nota.emitidaEm, importacao: n.importada_em, fornecedor: nota.emitenteNome, cnpj: nota.emitenteCnpj,
        numero: String(nota.numero), serie: String(nota.serie), chave: nota.chave, finalidade: fin,
        nItem: it.nItem, cProd: it.cProd, xProd: it.xProd, ncm: it.ncm ?? '', cfop: it.cfop, tribTipo: trib.tipo, tribCodigo: trib.codigo,
        qCom: it.qCom, uCom: it.uCom, produtosC: c(it.vProd), freteC: c(it.vFrete), seguroC: c(it.vSeg), descontoC: c(it.vDesc),
        outrasC: c(it.vOutro), ipiC: c(it.vIPI), stC: c(it.vST), fcpstC: c(it.vFCPST),
      });
    }
    // R1: vII e vIPIDevol integram o vNF no leiaute.
    const componentes = c(t.vProd) - c(t.vDesc) + c(t.vFrete) + c(t.vSeg) + c(t.vOutro) + c(t.vII) + c(t.vIPI) + c(t.vIPIDevol) + c(t.vST) + c(t.vFCPST);
    totaisNota.push({
      instante, chave: nota.chave, numero: String(nota.numero), fornecedor: nota.emitenteNome,
      vProdC: c(t.vProd), vFreteC: c(t.vFrete), vSegC: c(t.vSeg), vDescC: c(t.vDesc), vOutroC: c(t.vOutro), vIPIC: c(t.vIPI),
      vSTC: c(t.vST), vFCPSTC: c(t.vFCPST), vNFC: c(t.vNF), diferencaC: c(t.vNF) - componentes,
      divergenciaAceitaC: n.divergencia_total_aceita == null ? null : c(n.divergencia_total_aceita),
    });
    conf.detalhadas += 1; conf.itens += nota.itens.length; conf.totalMesC += c(t.vNF);
  }

  linhas.sort((a, b) => a.instante - b.instante || Number(a.numero) - Number(b.numero) || a.nItem - b.nItem);
  totaisNota.sort((a, b) => a.instante - b.instante || Number(a.numero) - Number(b.numero));
  if (conf.comFalha) conf.motivosParcial.push(`${conf.comFalha} compras com falha`);
  conf.parcial = conf.motivosParcial.length > 0;
  return { linhas, totaisNota, conferencia: conf, arquivos };
}
