// ADR-0181 D-3/D-4 — miolo da importação, dependências injetadas.
import { custoAquisicaoUnit } from '../_shared/nfe/regras.ts';
import type { DecisaoImportacao, ItemConciliado, NotaCompraLida } from '../_shared/nfe/tipos.ts';

export interface DepsImportacao {
  notaExistente(orgId: string, chave: string): Promise<{ status: string } | null>;
  /** Sobe SEM sobrescrever: 'ja_existia' quando o objeto já está lá (corrida/retry). */
  upload(path: string, xml: string): Promise<'criado' | 'ja_existia'>;
  rpc(nome: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  enfileirar(job: { org_id: string; codigo_pai: string; canal_origem: null; reativar: boolean }, orgId: string): Promise<string>;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function montarItensRpc(itens: ItemConciliado[], decisoes: DecisaoImportacao[]): Record<string, unknown>[] {
  return itens.map((i) => {
    const d = decisoes.find((x) => x.nItem === i.nItem)!;
    const custo = r6(custoAquisicaoUnit(i, d.fator));
    return {
      n_item: i.nItem, cprod: i.cProd, xprod: i.xProd, ncm: i.ncm, cfop: i.cfop, gtin: i.gtin,
      ucom: i.uCom, qcom: i.qCom, fator_conversao: d.fator,
      v_prod: i.vProd, v_frete: i.vFrete, v_seg: i.vSeg, v_desc: i.vDesc, v_outro: i.vOutro,
      v_ipi: i.vIPI, v_st: i.vST, v_fcpst: i.vFCPST, rateio: i.rateio, orig: i.orig, codigo_pai: d.codigoPai,
      distribuicao: d.distribuicao.map((l) => ({
        codigo: l.codigo, quantidade: l.quantidade,
        custo_aquisicao_unit: custo, custo_precificacao_unit: l.custoPrecificacao,
      })),
    };
  });
}

export async function processarImportacao(
  deps: DepsImportacao,
  p: { orgId: string; userId: string; nota: NotaCompraLida; itens: ItemConciliado[];
       decisoes: DecisaoImportacao[]; xml: string; sha256: string; divergenciaTotal: number },
): Promise<{ notaId: string; duplicada: boolean; pushOk: boolean }> {
  const existente = await deps.notaExistente(p.orgId, p.nota.chave);
  if (existente && existente.status !== 'importada') {
    throw new Error(`Esta nota está ${existente.status} e não pode ser importada de novo.`);
  }
  // Endereçado pelo CONTEÚDO: o path carrega o sha256 do XML que gerou os dados desta chamada.
  // Duas tentativas com XMLs diferentes da mesma chave nunca compartilham objeto, e quem vence a
  // RPC grava o path/hash do próprio arquivo (N-B3). 'ja_existia' = mesmo hash = mesmo conteúdo.
  const xmlPath = `${p.orgId}/${p.nota.chave}/${p.sha256}.xml`;
  if (!existente) await deps.upload(xmlPath, p.xml);

  const { data, error } = await deps.rpc('importar_nota_compra', {
    p_org: p.orgId, p_user: p.userId,
    p_nota: {
      chave: p.nota.chave, numero: p.nota.numero, serie: p.nota.serie,
      emitente_cnpj: p.nota.emitenteCnpj, emitente_nome: p.nota.emitenteNome,
      emitida_em: p.nota.emitidaEm, valor_total: p.nota.totais.vNF, assinada: p.nota.assinada,
      xml_path: xmlPath, xml_sha256: p.sha256,
      divergencia_total_aceita: p.divergenciaTotal === 0 ? null : p.divergenciaTotal,
    },
    p_itens: montarItensRpc(p.itens, p.decisoes),
  });
  if (error) throw new Error(error.message);
  const r = data as { nota_id: string; duplicada: boolean; codigos_pai: string[] };

  let pushOk = true;
  for (const codigoPai of r.codigos_pai) {
    try {
      await deps.enfileirar({ org_id: p.orgId, codigo_pai: codigoPai, canal_origem: null, reativar: true }, p.orgId);
    } catch (e) { pushOk = false; console.error('importar_nota_push_falhou', codigoPai, String(e)); }
  }
  return { notaId: r.nota_id, duplicada: r.duplicada, pushOk };
}

export async function reenviarPush(
  deps: Pick<DepsImportacao, 'enfileirar'> & {
    codigosDaNota(orgId: string, chave: string): Promise<string[]>;
    statusDaNota(orgId: string, chave: string): Promise<string | null>;
  },
  orgId: string, chave: string,
): Promise<{ pushOk: boolean }> {
  // Só a nota ainda importada é reposição (reativa pausado, ADR-0111); desfeita/cancelada só reduz.
  const reativar = (await deps.statusDaNota(orgId, chave)) === 'importada';
  let pushOk = true;
  for (const codigoPai of await deps.codigosDaNota(orgId, chave)) {
    try {
      await deps.enfileirar({ org_id: orgId, codigo_pai: codigoPai, canal_origem: null, reativar }, orgId);
    } catch (e) { pushOk = false; console.error('reenviar_push_falhou', codigoPai, String(e)); }
  }
  return { pushOk };
}
