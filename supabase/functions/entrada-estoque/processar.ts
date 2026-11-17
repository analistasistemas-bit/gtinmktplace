// Miolo da entrada de mercadoria, com dependências injetadas para ser testável sem Deno —
// mesmo arranjo de `ajustar-estoque/processar.ts`, do qual isto é o espelho para a entrada.
import { refDoItem, type ItemEntrada } from './validar.ts';
import { mensagemErroPedido } from '../_shared/reposicao/erro-pedido.ts';

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
): Promise<{ resultados: ResultadoItem[]; pushOk: boolean; erro?: string }> {
  const resultados: ResultadoItem[] = [];
  const produtos = new Set<string>();

  // ADR-0207 §16: com pedido, a submissão inteira é UMA transação (`registrar_entrada_lote`): qualquer recusa
  // desfaz todas as cores e vira 400. `validarEntrada` garante um pedido só por submissão.
  const pedido = p.itens.find((i) => i.pedidoCompraId)?.pedidoCompraId;
  if (pedido) {
    const { data, error } = await deps.rpc('registrar_entrada_lote', {
      p_org: p.orgId, p_doc: p.documento, p_obs: p.observacao, p_criado_por: p.userId, p_pedido_compra: pedido,
      p_itens: p.itens.map((i) => ({
        codigo: i.codigo, quantidade: i.quantidade, custo: i.custo, ref: refDoItem(p.ref, i.codigo, p.unico),
        com_pedido: !!i.pedidoCompraId,
      })),
    });
    if (error) return { resultados: [], pushOk: true, erro: mensagemErroPedido(error.message) };
    for (const r of data as Array<{ codigo: string; codigo_pai: string | null; estoque: number | null; duplicada: boolean }>) {
      if (r.codigo_pai) produtos.add(r.codigo_pai);
      resultados.push({ codigo: r.codigo, estoque: r.estoque, duplicada: r.duplicada });
    }
  }

  for (const item of pedido ? [] : p.itens) {
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

/**
 * Corpo e status HTTP da resposta. Formato antigo preservado inteiro (uma cor): `estoque`/`duplicada` no topo E o
 * 400 quando a RPC recusa — o cliente antigo trata erro pelo status, não por um campo no corpo. Uma aba já aberta
 * durante o deploy continua funcionando. Lote: erro é POR ITEM (o operador precisa ver o que não entrou).
 */
export function respostaEntrada(
  r: { resultados: ResultadoItem[]; pushOk: boolean; erro?: string }, unico: boolean,
): { status: number; body: unknown } {
  // Recusa da entrada vinculada a pedido: nada foi gravado, 400 nos dois formatos.
  if (r.erro) return { status: 400, body: { error: r.erro } };
  if (!unico) return { status: 200, body: r };
  const primeiro = r.resultados[0];
  if (primeiro?.erro) return { status: 400, body: { error: primeiro.erro } };
  return { status: 200, body: { estoque: primeiro?.estoque ?? null, duplicada: primeiro?.duplicada === true, pushOk: r.pushOk } };
}
