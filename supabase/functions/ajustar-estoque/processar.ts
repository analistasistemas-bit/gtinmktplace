// E6b (ADR-0110): miolo do ajuste de estoque, com dependências injetadas para ser testável
// sem Deno — mesmo arranjo de `sincronizar-estoque/processar.ts`.
import { refDoItem, type ItemAjuste } from './validar.ts';

export interface ResultadoItem {
  codigo: string;
  estoque: number | null;
  duplicada: boolean;
  erro?: string;
}

export interface DepsAjuste {
  rpc(nome: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  lerMovimento(orgId: string, ref: string): Promise<{ codigo_pai: string | null; estoque_resultante: number | null } | null>;
  enfileirar(job: { org_id: string; codigo_pai: string; canal_origem: null }, orgId: string): Promise<string>;
}

export async function processarAjuste(
  deps: DepsAjuste,
  p: { orgId: string; userId: string; itens: ItemAjuste[]; observacao: string | null; ref: string },
): Promise<{ resultados: ResultadoItem[]; pushOk: boolean }> {
  const resultados: ResultadoItem[] = [];
  const produtos = new Set<string>();

  for (const item of p.itens) {
    const ref = refDoItem(p.ref, item.codigo);
    const { data, error } = await deps.rpc('ajustar_estoque', {
      p_org: p.orgId, p_codigo: item.codigo, p_novo_saldo: item.novoSaldo,
      p_obs: p.observacao, p_criado_por: p.userId, p_ref: ref,
    });
    if (error) {
      // Um item ruim não pode derrubar os outros: o operador precisa saber o que entrou.
      resultados.push({ codigo: item.codigo, estoque: null, duplicada: false, erro: error.message });
      continue;
    }
    // `data` null = a referência já tinha sido aplicada. O movimento existe; leia dele o saldo
    // e o produto, porque é ele que diz para onde o push precisa ir.
    const mov = await deps.lerMovimento(p.orgId, ref);
    if (mov?.codigo_pai) produtos.add(mov.codigo_pai);
    resultados.push({
      codigo: item.codigo,
      estoque: data === null ? (mov?.estoque_resultante ?? null) : Number(data),
      duplicada: data === null,
    });
  }

  // O push sai SEMPRE para todo produto tocado — inclusive quando tudo veio duplicado. Mesmo
  // contrato da entrada: perder a propagação é pior que enfileirar de novo, e push absoluto é
  // idempotente. canal_origem null = todos os canais publicados.
  let pushOk = true;
  for (const codigoPai of produtos) {
    try {
      await deps.enfileirar({ org_id: p.orgId, codigo_pai: codigoPai, canal_origem: null }, p.orgId);
    } catch (e) {
      pushOk = false;
      console.error('ajuste_push_falhou', codigoPai, String(e));
    }
  }

  return { resultados, pushOk };
}
