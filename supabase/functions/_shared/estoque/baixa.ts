// E6b (ADR-0094): seleção e aplicação da baixa de estoque de uma venda paga.
// A venda é sagrada — nada aqui pode derrubar o sync-venda; o chamador envolve em try/catch.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { resolverOrigemEstoque } from './kit.ts';

export interface ItemVendaBaixa {
  codigo: string | null;
  quantity: number;
  ml_item_id?: string | null;
  titulo?: string | null;
}
export interface BaixaSelecionada { codigo: string; quantity: number }

/** Filtra itens sem SKU ou sem quantidade e agrega o mesmo SKU repetido no pedido. */
export function selecionarBaixas(itens: ItemVendaBaixa[]): BaixaSelecionada[] {
  const porCodigo = new Map<string, number>();
  for (const i of itens) {
    if (!i.codigo || i.quantity <= 0) continue;
    porCodigo.set(i.codigo, (porCodigo.get(i.codigo) ?? 0) + i.quantity);
  }
  return [...porCodigo].map(([codigo, quantity]) => ({ codigo, quantity }));
}

/**
 * Itens de venda paga que NÃO dá para baixar por falta de SKU resolvido.
 *
 * Incidente 2026-08-11: 12 unidades do NIVEA venderam na org DSA sem baixar nada, e sem deixar
 * rastro — `selecionarBaixas` descartava o item calado e nem o motivo de diagnóstico
 * `venda_sku_nao_encontrado` (que já existia no ledger, com 0 linhas em todo o banco) era
 * gravado. Um saldo que não desce é indistinguível de um produto que não vendeu.
 */
export function selecionarSemSku(itens: ItemVendaBaixa[]): ItemVendaBaixa[] {
  return itens.filter((i) => !i.codigo && i.quantity > 0);
}

/** Referência de idempotência do diagnóstico. Um por (pedido, item externo). */
export function refSemSku(canal: string, orderId: string | number, mlItemId: string | null): string {
  return `venda_sem_sku:${canal}:${orderId}:${mlItemId ?? 'sem-item'}`;
}

/** Referência de idempotência da baixa. Canal-agnóstica por construção. */
export function refBaixa(canal: string, orderId: string | number, codigo: string): string {
  return `${canal}:${orderId}:${codigo}`;
}

/** Movimento aplicado cujo push ao QStash ainda não foi confirmado (outbox no ledger). */
export interface MovimentoPendente {
  id: string;
  codigoPai: string;
  /** Intenção gravada no movimento. NUNCA fornecida pelo chamador. */
  canalOrigem: string | null;
  /** ADR-0111 — o movimento AUMENTA saldo (entrada, estorno). Habilita a reativação do anúncio. */
  reposicao: boolean;
}

export interface ResultadoBaixaVenda {
  /** Movimentos com push ainda não entregue ao QStash (outbox no ledger). */
  pendentesDePush: MovimentoPendente[];
  /** Venda pediu mais do que havia, mas ainda existia saldo (>0). Alerta por pedido. */
  vendaAcimaSaldo: Array<{
    codigo: string; pedido: number; anterior: number; aplicado: number;
    /** `codigo_pai` do kit quando a venda foi de kit; null em venda direta (ADR-0151). */
    kitCodigoPai: string | null;
    multiplicador: number;
  }>;
  /** ML vendeu com PubliAI já em zero. Dedupe por SKU/dia no caller. */
  desyncMl: Array<{ codigo: string; pedido: number }>;
  /** RPCs que erraram. Nunca vazio em silêncio: o chamador notifica. */
  falhas: Array<{ codigo: string; mensagem: string }>;
  /** Itens da venda paga que ficaram SEM baixa por não ter SKU resolvido. */
  semSku: Array<{ titulo: string | null; mlItemId: string | null; quantidade: number }>;
  /** SKUs que vieram no pedido mas não existem no catálogo — a RPC recusa e nada é baixado. */
  skuDesconhecido: Array<{ codigo: string; quantidade: number }>;
}

/**
 * Classifica o resultado da baixa de estoque em relação ao saldo:
 * - 'ok': quantidade aplicada atendeu todo o pedido (inclusive última unidade disponível).
 * - 'desync': ML vendeu com estoque já zerado no PubliAI (estoque_anterior === 0).
 * - 'parcial': venda pediu mais do que havia, mas ainda existia saldo (> 0).
 */
export function classificarBaixaSemSaldo(
  r: { estoque_anterior?: number; quantidade_aplicada?: number; quantidade_pedida?: number },
  pedidoFallback: number,
): 'ok' | 'parcial' | 'desync' {
  const pedida = r.quantidade_pedida ?? pedidoFallback;
  const aplicada = r.quantidade_aplicada ?? (r.estoque_anterior !== undefined ? Math.min(Math.max(0, r.estoque_anterior), pedida) : pedida);
  if (aplicada >= pedida) return 'ok';
  if ((r.estoque_anterior ?? 0) === 0) return 'desync';
  return 'parcial';
}

export async function registrarBaixaVenda(
  admin: SupabaseClient,
  p: { orgId: string; canal: string; orderId: string | number; itens: ItemVendaBaixa[] },
): Promise<ResultadoBaixaVenda> {
  // O diagnóstico do que NÃO dá para baixar vem primeiro e roda mesmo quando não há nenhuma
  // baixa possível — era exatamente esse o caminho que saía calado.
  const semSku = await registrarVendaSemSku(admin, p);

  const baixas = selecionarBaixas(p.itens);
  if (baixas.length === 0) {
    return { pendentesDePush: [], vendaAcimaSaldo: [], desyncMl: [], falhas: [], semSku, skuDesconhecido: [] };
  }

  const vendaAcimaSaldo: ResultadoBaixaVenda['vendaAcimaSaldo'] = [];
  const desyncMl: Array<{ codigo: string; pedido: number }> = [];
  const falhas: Array<{ codigo: string; mensagem: string }> = [];
  const skuDesconhecido: Array<{ codigo: string; quantidade: number }> = [];

  // O SKU vendido pode ser de um kit vinculado (ADR-0151 D-6): nesse caso quem tem saldo é a
  // BASE, e cada unidade de venda consome N unidades dela. Sem esta resolução, `baixar_estoque`
  // acha a linha do próprio kit (saldo 0) e aplica delta 0 em silêncio — a base nunca desce.
  for (const b of baixas) {
    const origem = await resolverOrigemEstoque(admin, p.orgId, b.codigo);
    // A REFERÊNCIA continua no SKU VENDIDO, nunca no da base: `estornar_estoque` procura o
    // movimento só por `referencia_externa` e repõe na variação resolvida a partir do `codigo`
    // GRAVADO no movimento. Trocar a ref faria venda e estorno nunca se encontrarem.
    const ref = refBaixa(p.canal, p.orderId, b.codigo);
    const { data, error } = await admin.rpc('baixar_estoque', {
      p_org: p.orgId,
      p_codigo: origem.codigoCanonico,
      p_qtd: b.quantity * origem.multiplicador,
      p_canal: p.canal,
      p_ref: ref,
    });
    if (error) {
      console.error('baixar_estoque_falhou', { orderId: p.orderId, codigo: b.codigo, erro: error.message });
      falhas.push({ codigo: b.codigo, mensagem: error.message });
      continue;
    }
    const r = data as {
      aplicado: boolean; motivo: string; codigo_pai?: string; movimento_id?: string;
      estoque_anterior?: number; quantidade_pedida?: number; quantidade_aplicada?: number;
    };
    if (!r.aplicado) {
      // SKU que o catálogo não conhece (incidente 2026-08-13): o pedido TROUXE o código, então
      // isto não é "venda sem SKU" e passava calado — `duplicata` e `cancelada_antes_da_baixa`
      // são caminhos normais, este não. O saldo não desceu e só o operador pode agir.
      if (r.motivo === 'sku_nao_encontrado') skuDesconhecido.push({ codigo: b.codigo, quantidade: b.quantity });
      continue;
    }
    await anotarOrigemDoMovimento(admin, r.movimento_id ?? null, {
      kitCodigoPai: origem.kitCodigoPai,
      multiplicador: origem.kitCodigoPai ? origem.multiplicador : null,
    });
    const classe = classificarBaixaSemSaldo(r, b.quantity * origem.multiplicador);
    if (classe === 'desync') {
      desyncMl.push({ codigo: b.codigo, pedido: b.quantity });
    } else if (classe === 'parcial') {
      vendaAcimaSaldo.push({
        codigo: b.codigo,
        pedido: b.quantity * origem.multiplicador,
        anterior: r.estoque_anterior ?? 0,
        aplicado: r.quantidade_aplicada ?? 0,
        kitCodigoPai: origem.kitCodigoPai,
        multiplicador: origem.multiplicador,
      });
    }
  }

  // O que enfileirar NÃO vem do que esta execução aplicou, e sim do OUTBOX: todo
  // movimento com push ainda não entregue. É o que fecha o buraco em que a RPC
  // commita e o enfileiramento falha — no retry, `aplicado` seria false e o push
  // se perderia para sempre. Aqui ele é reencontrado.
  return { pendentesDePush: await lerPushPendente(admin, p.orgId), vendaAcimaSaldo, desyncMl, falhas, semSku, skuDesconhecido };
}

/**
 * Anota, DEPOIS da RPC, que o débito veio da venda de um kit vinculado.
 *
 * Não vai por parâmetro da RPC de propósito: mudar a assinatura de `baixar_estoque` obrigaria
 * repetir a dança de owner/grants do `estoque_rpc_executor` (migration 20260804113000) num
 * caminho que já funciona. O preço é que a anotação NÃO é atômica com a baixa.
 *
 * É PURAMENTE auditoria (D-6): o ledger e o alerta de venda-acima-do-saldo passam a dizer
 * "3 kits de 3 = 9 unidades da base" em vez de um 9 sem explicação. Nenhuma decisão de push
 * depende disto — a Decisão 7 foi simplificada justamente para não haver plumbing de kit no
 * outbox. Falhar aqui custa uma linha de ledger sem atribuição, nada mais.
 */
async function anotarOrigemDoMovimento(
  admin: SupabaseClient,
  movimentoId: string | null,
  p: { kitCodigoPai: string | null; multiplicador: number | null },
): Promise<void> {
  if (!movimentoId) return;
  const { error } = await admin.from('estoque_movimentos').update({
    origem_kit_codigo_pai: p.kitCodigoPai,
    origem_kit_multiplicador: p.multiplicador,
  }).eq('id', movimentoId);
  if (error) console.error('anotar_origem_movimento_falhou', { movimentoId, erro: error.message });
}

/**
 * Grava no ledger, com `quantidade = 0`, o item de venda paga que não pôde ser baixado por
 * falta de SKU. Movimento informativo (o saldo não mudou), mas VISÍVEL: é a diferença entre
 * "esse produto não vendeu" e "vendeu e ninguém baixou".
 *
 * `codigo_pai` fica vazio de propósito — sem produto resolvido não há para onde empurrar
 * estoque, e o índice de outbox exige `codigo_pai <> ''`, então isto nunca vira push.
 */
async function registrarVendaSemSku(
  admin: SupabaseClient,
  p: { orgId: string; canal: string; orderId: string | number; itens: ItemVendaBaixa[] },
): Promise<ResultadoBaixaVenda['semSku']> {
  const itens = selecionarSemSku(p.itens);
  const registrados: ResultadoBaixaVenda['semSku'] = [];

  for (const i of itens) {
    const mlItemId = i.ml_item_id ?? null;
    const { error } = await admin.from('estoque_movimentos').insert({
      org_id: p.orgId,
      codigo: '',
      codigo_pai: '',
      quantidade: 0,
      quantidade_pedida: i.quantity,
      motivo: 'venda_sku_nao_encontrado',
      canal_origem: p.canal,
      referencia_externa: refSemSku(p.canal, p.orderId, mlItemId),
      observacao: `Venda sem SKU resolvido${i.titulo ? `: ${i.titulo}` : ''}${mlItemId ? ` (${mlItemId})` : ''}`,
      push_enfileirado_em: new Date().toISOString(),
    });
    // 23505 = já registrado numa execução anterior deste mesmo pedido. O sync roda várias vezes
    // (webhook de order + de shipment), então duplicata aqui é o caminho normal, não erro.
    if (error && error.code !== '23505') {
      console.error('registrar_venda_sem_sku_falhou', { orderId: p.orderId, mlItemId, erro: error.message });
      continue;
    }
    registrados.push({ titulo: i.titulo ?? null, mlItemId, quantidade: i.quantity });
  }
  return registrados;
}

/**
 * Estorna, para um pedido cancelado, tudo que foi de fato baixado dele.
 * A checagem "houve baixa?" vive DENTRO da RPC (com advisory lock e FOR UPDATE no
 * movimento de venda) — fazer o check aqui e o estorno lá seria check-then-act não
 * atômico, e a quantidade do snapshot do pedido cancelado pode divergir da baixada.
 * Quando não há baixa, a RPC grava o tombstone que impede a baixa posterior.
 */
export async function estornarVendaCancelada(
  admin: SupabaseClient,
  p: { orgId: string; canal: string; orderId: string | number; itens: ItemVendaBaixa[] },
): Promise<{ pendentesDePush: MovimentoPendente[]; falhas: Array<{ codigo: string; mensagem: string }> }> {
  const falhas: Array<{ codigo: string; mensagem: string }> = [];
  for (const b of selecionarBaixas(p.itens)) {
    const { error } = await admin.rpc('estornar_estoque', {
      p_org: p.orgId, p_canal: p.canal,
      p_ref_venda: refBaixa(p.canal, p.orderId, b.codigo),
      p_codigo: b.codigo,
    });
    if (error) {
      console.error('estornar_estoque_falhou', { orderId: p.orderId, codigo: b.codigo, erro: error.message });
      falhas.push({ codigo: b.codigo, mensagem: error.message });
    }
    // O que enfileirar vem do outbox, não do retorno — mesma razão da baixa.
  }
  return { pendentesDePush: await lerPushPendente(admin, p.orgId), falhas };
}

/** Movimentos aplicados cujo push ao QStash ainda não foi confirmado (outbox no ledger). */
export async function lerPushPendente(
  admin: SupabaseClient, orgId: string, limite = 200,
): Promise<MovimentoPendente[]> {
  const { data, error } = await admin.from('estoque_movimentos')
    .select('id, codigo_pai, push_canal_origem, quantidade')
    .eq('org_id', orgId)
    .is('push_enfileirado_em', null)
    .neq('codigo_pai', '')
    .order('criado_em', { ascending: true })
    .limit(limite);
  if (error) {
    console.error('ler_push_pendente_falhou', error.message);
    return [];
  }
  return (data ?? []).map((m) => ({
    id: m.id as string,
    codigoPai: m.codigo_pai as string,
    canalOrigem: (m.push_canal_origem as string | null) ?? null,
    // Pelo SINAL, não pelo motivo: qualquer movimento que soma saldo é reposição (ADR-0111).
    // Um motivo novo entra na regra sozinho, sem precisar ser lembrado numa lista.
    reposicao: Number(m.quantidade ?? 0) > 0,
  }));
}

/**
 * Houve baixa de estoque para este pedido? (ADR-0121)
 *
 * Existe para calar o aviso de cancelamento em pedido que nunca baixou nada: sem baixa não há
 * saldo devendo voltar, e o operador não tem o que conferir. Medido em 18/08/2026, na primeira
 * varredura com o novo gatilho: 26 pedidos cancelados — vários de 2021/2024, anteriores ao
 * ledger — dispararam o alerta de uma vez, in-app e no Telegram. O aviso é sobre estoque, então
 * a condição também tem que ser sobre estoque.
 *
 * `quantidade < 0` de propósito: um movimento com `quantidade = 0` é o registro de venda que o
 * saldo zerado não pôde atender (D-8) — nada desceu, nada volta.
 */
export async function houveBaixaDeVenda(
  admin: SupabaseClient,
  p: { orgId: string; canal: string; orderId: string | number; itens: ItemVendaBaixa[] },
): Promise<boolean> {
  const refs = selecionarBaixas(p.itens).map((b) => refBaixa(p.canal, p.orderId, b.codigo));
  if (refs.length === 0) return false;
  const { data, error } = await admin.from('estoque_movimentos')
    .select('id').eq('org_id', p.orgId).eq('motivo', 'venda')
    .in('referencia_externa', refs).lt('quantidade', 0).limit(1);
  // Falha de leitura NÃO cala o aviso: perder o alerta de um cancelamento real é pior que
  // repetir um alerta ruidoso, e o dedupe garante que ele sai no máximo uma vez.
  if (error) {
    console.error('houve_baixa_de_venda_falhou', p.orderId, error.message);
    return true;
  }
  return (data ?? []).length > 0;
}

export interface ResultadoDespacho { marcados: number; falhas: number }

/**
 * Enfileira o push de cada pendente e SÓ ENTÃO marca o outbox como entregue.
 *
 * O agrupamento é por `(codigoPai, canalOrigem)` — nunca só por produto. Movimentos
 * do mesmo produto podem ter políticas de propagação OPOSTAS: uma venda no ML exclui
 * o ML do push (ele já se decrementou), enquanto uma entrada precisa alcançar o ML.
 * Agrupar só por produto faria um despacho de venda drenar e marcar como entregue a
 * entrada, deixando o ML defasado com o saldo errado.
 *
 * A ordem enqueue → marca importa: marcar antes reintroduziria a perda que o outbox
 * existe para evitar. Marcar depois pode, no pior caso, enfileirar duas vezes — e push
 * absoluto é idempotente, então duplicar é inofensivo.
 */
export async function despacharPushPendente(
  admin: SupabaseClient,
  orgId: string,
  pendentes: MovimentoPendente[],
  enfileirar: (job: { org_id: string; codigo_pai: string; canal_origem: string | null; reativar?: boolean }, orgId: string) => Promise<string>,
): Promise<ResultadoDespacho> {
  let marcados = 0;
  let falhas = 0;

  // `reposicao` entra na chave junto com o canal, pela mesma razão que ele: uma venda e uma
  // entrada do mesmo produto têm políticas OPOSTAS. Agrupá-las faria a entrada ser despachada
  // com a intenção da venda — e o anúncio pausado não voltaria (ADR-0111).
  const grupos = new Map<string, { codigoPai: string; canalOrigem: string | null; reposicao: boolean; ids: string[] }>();
  for (const p of pendentes) {
    const chave = JSON.stringify([p.codigoPai, p.canalOrigem, p.reposicao]);
    if (!grupos.has(chave)) {
      grupos.set(chave, { codigoPai: p.codigoPai, canalOrigem: p.canalOrigem, reposicao: p.reposicao, ids: [] });
    }
    grupos.get(chave)!.ids.push(p.id);
  }

  for (const g of grupos.values()) {
    try {
      await enfileirar(
        { org_id: orgId, codigo_pai: g.codigoPai, canal_origem: g.canalOrigem, reativar: g.reposicao }, orgId,
      );
      // supabase-js devolve o erro como valor, não lança. Ignorar aqui faria a função
      // aparentar sucesso e reenviar o mesmo push para sempre.
      const { error } = await admin.from('estoque_movimentos')
        .update({ push_enfileirado_em: new Date().toISOString() })
        .in('id', g.ids);
      if (error) {
        // Enqueue aceito mas marca falhou: o movimento CONTINUA pendente. Sinalizar a
        // falha é o que impede o chamador de reler e re-enfileirar o mesmo grupo em laço.
        falhas++;
        console.error('marcar_push_entregue_falhou', { orgId, codigoPai: g.codigoPai, erro: error.message });
      } else {
        marcados += g.ids.length;
      }
    } catch (e) {
      // Fica no outbox. A próxima execução do sync ou a reconciliação diária pega.
      falhas++;
      console.error('despachar_push_falhou', { orgId, codigoPai: g.codigoPai, erro: String(e) });
    }
  }
  return { marcados, falhas };
}
