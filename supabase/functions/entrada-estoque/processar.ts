// Miolo da entrada de mercadoria, com dependências injetadas para ser testável sem Deno —
// mesmo arranjo de `ajustar-estoque/processar.ts`, do qual isto é o espelho para a entrada.
import { refDoItem, type ItemEntrada } from './validar.ts';

export interface ResultadoItem {
  codigo: string;
  estoque: number | null;
  duplicada: boolean;
  erro?: string;
}

export interface DepsEntrada {
  rpc(nome: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
  lerMovimento(orgId: string, ref: string): Promise<{ codigo_pai: string | null; estoque_resultante: number | null } | null>;
  enfileirar(
    job: { org_id: string; codigo_pai: string; canal_origem: null; reativar: true },
    orgId: string,
  ): Promise<string>;
}

export async function processarEntrada(
  deps: DepsEntrada,
  p: {
    orgId: string; userId: string; itens: ItemEntrada[]; unico: boolean;
    documento: string | null; observacao: string | null; ref: string;
  },
): Promise<{ resultados: ResultadoItem[]; pushOk: boolean }> {
  const resultados: ResultadoItem[] = [];
  const produtos = new Set<string>();

  for (const item of p.itens) {
    const ref = refDoItem(p.ref, item.codigo, p.unico);
    const { data, error } = await deps.rpc('registrar_entrada', {
      p_org: p.orgId, p_codigo: item.codigo, p_qtd: item.quantidade,
      p_custo: item.custo, p_doc: p.documento, p_obs: p.observacao,
      p_criado_por: p.userId, p_ref: ref,
    });
    if (error) {
      // Um item ruim não pode derrubar os outros: o operador precisa saber o que entrou.
      resultados.push({ codigo: item.codigo, estoque: null, duplicada: false, erro: error.message });
      continue;
    }
    // `data` null = a referência já tinha sido aplicada. O movimento existe; leia dele o saldo e
    // o produto, porque é ele que diz para onde o push precisa ir.
    const mov = await deps.lerMovimento(p.orgId, ref);
    if (mov?.codigo_pai) produtos.add(mov.codigo_pai);
    resultados.push({
      codigo: item.codigo,
      estoque: data === null ? (mov?.estoque_resultante ?? null) : Number(data),
      duplicada: data === null,
    });
  }

  // O push sai SEMPRE para todo produto tocado — inclusive quando tudo veio duplicado: se a
  // primeira tentativa aplicou a entrada mas morreu antes de enfileirar, o retry cairia em
  // `duplicada` e a propagação nunca aconteceria. Push absoluto é idempotente.
  // `canal_origem: null` = todos os canais publicados; `reativar: true` porque entrada é
  // reposição e anúncio pausado com saldo volta ao ar (ADR-0111).
  // Sem `skus`: aqui o push é do PRODUTO INTEIRO de propósito — é o caminho que reconverge o
  // anúncio com o saldo do app. O recorte por SKU vale só para a entrada que nasce junto de uma
  // cor nova, que passa pelo outbox (`skuRestrito`, `_shared/estoque/baixa.ts`).
  let pushOk = true;
  for (const codigoPai of produtos) {
    try {
      await deps.enfileirar(
        { org_id: p.orgId, codigo_pai: codigoPai, canal_origem: null, reativar: true }, p.orgId,
      );
    } catch (e) {
      // A entrada já foi gravada e é a verdade; o push é recuperável pela reconciliação diária.
      pushOk = false;
      console.error('entrada_push_falhou', codigoPai, String(e));
    }
  }

  return { resultados, pushOk };
}
