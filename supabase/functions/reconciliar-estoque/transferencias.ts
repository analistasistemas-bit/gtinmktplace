// ADR-0200 (contrato de segurança, item 5): reconciliação diária do kit com variação.
// 1. Transferência pendente é reconciliada sem limite de 24 h.
// 2. Triagem: todo SKU participante, sem filtro de status local nem janela de movimento, tem o saldo
//    local comparado com o ML (só leitura, sem pausar). Diferença vira transferência `entrada`, que é o
//    único caminho que escreve quantidade nesses SKUs. É a rede para a entrada que não virou transferência.
// 3. Exclusão de publicação parada (resultado não confirmado) gera alerta: só o Reenviar a solta.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { paginarTudo } from '../_shared/pagina.ts';
import { lerStatusMLEstrito } from '../_shared/operacoes/ml-status.ts';
import { criarTransferencia } from '../_shared/kit-variacao/saga.ts';

const PARADA_MS = 30 * 60 * 1000;
const PUBLICACAO_PARADA_MS = 60 * 60 * 1000;
const BLOCO_IN = 200;

/**
 * Uma cadeia viva grava `passo_em` a cada passo, no máximo T (5 min) depois do anterior: 30 min sem passo
 * é cadeia perdida. Reenfileirar uma viva também é seguro (o claim serializa). `travada` espera o operador.
 */
export async function retomarTransferenciasParadas(
  admin: SupabaseClient, enfileirar: (id: string, orgId: string) => Promise<void>, agoraMs = Date.now(),
): Promise<number> {
  const limite = new Date(agoraMs - PARADA_MS).toISOString();
  const linhas = await paginarTudo<{ id: string; org_id: string }>((de, ate) =>
    admin.from('kit_transferencias').select('id, org_id')
      .eq('estado', 'ativa').lt('passo_em', limite).order('id').range(de, ate));
  let n = 0;
  for (const t of linhas) {
    try {
      await enfileirar(t.id, t.org_id);
      n++;
    } catch (e) {
      console.error('reconciliar_transferencia_enfileirar_falhou', t.id, String(e));
    }
  }
  return n;
}

export interface DepsTriagem {
  admin: SupabaseClient;
  /** Quantidade do UP no ML, só leitura. Lança em falha. */
  lerQuantidade: (orgId: string, upId: string, itemIds: string[]) => Promise<number>;
  enfileirarSaga: (id: string, orgId: string) => Promise<void>;
  alertar: (orgId: string, texto: string) => Promise<void>;
}

function blocos<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += BLOCO_IN) out.push(xs.slice(i, i + BLOCO_IN));
  return out;
}

async function codigosParticipantes(admin: SupabaseClient, orgId: string): Promise<string[]> {
  const out = new Set<string>();
  for (const tabela of ['kit_variacao_skus', 'kit_variacao_componentes']) {
    const linhas = await paginarTudo<{ codigo: string }>((de, ate) =>
      admin.from(tabela).select('codigo').eq('org_id', orgId).order('codigo').range(de, ate));
    linhas.forEach((l) => out.add(l.codigo));
  }
  return [...out].sort();
}

async function triarOrg(deps: DepsTriagem, orgId: string): Promise<number> {
  const { admin } = deps;
  const codigos = await codigosParticipantes(admin, orgId);
  // Saldo da variação canônica (família mais recente), a mesma que a saga lê.
  const saldo = new Map<string, { estoque: number; criado: string }>();
  const itens: Array<Record<string, unknown>> = [];
  for (const bloco of blocos(codigos)) {
    // Paginado: um SKU acumula uma variação por lote importado, e o PostgREST corta em 1.000 linhas.
    const vs = await paginarTudo<Record<string, unknown>>((de, ate) => admin.from('variacoes')
      .select('id, codigo, estoque, familias!inner(criado_em)').eq('org_id', orgId).in('codigo', bloco)
      .order('id').range(de, ate));
    for (const v of vs) {
      const criado = String((v.familias as { criado_em?: string } | null)?.criado_em ?? '');
      const atual = saldo.get(v.codigo as string);
      if (!atual || criado > atual.criado) saldo.set(v.codigo as string, { estoque: Number(v.estoque ?? 0), criado });
    }
    // Item retirado (cor tirada do anúncio de propósito) não é oferta: fica de fora.
    itens.push(...await paginarTudo<Record<string, unknown>>((de, ate) => admin.from('anuncios_externos_itens')
      .select('id, sku, item_externo_id, user_product_id, catalog_listing_id').eq('org_id', orgId).in('sku', bloco)
      .eq('retirado', false).order('id').range(de, ate)));
  }

  let criadas = 0;
  const semUp: string[] = [];
  for (const codigo of codigos) {
    // Sem filtro de status local; retirado já ficou de fora na leitura.
    const doSku = itens.filter((i) => i.sku === codigo && i.user_product_id && i.item_externo_id);
    const local = saldo.get(codigo);
    if (!local) continue;              // SKU de kit em rascunho, sem variação: nada a ofertar.
    if (doSku.length === 0) { semUp.push(codigo); continue; }
    const i = doSku[0];
    const upId = i.user_product_id as string;
    const itemIds = [i.item_externo_id as string, ...(i.catalog_listing_id ? [i.catalog_listing_id as string] : [])];
    try {
      if (await deps.lerQuantidade(orgId, upId, itemIds) === local.estoque) continue;
      const r = await criarTransferencia(admin, {
        orgId, kitId: null, tipo: 'entrada',
        itens: [{ codigo, quantidade: 0 }], alvos: [{ codigo, upId, itemIds }],
      });
      if ('id' in r) {
        await deps.enfileirarSaga(r.id, orgId);
        criadas++;
      } else if (r.motivo === 'alvos_invalidos') {
        await deps.alertar(orgId, `Kit com variação: ${codigo} diverge do Mercado Livre e a transferência foi recusada `
          + '(alvos inválidos). Confira o vínculo do anúncio.');
      }
      // up_ocupado: transferência ou publicação em curso no SKU; a triagem de amanhã confere de novo.
    } catch (e) {
      console.error('reconciliar_kit_sku_falhou', orgId, codigo, String(e));
    }
  }
  if (semUp.length > 0) {
    await deps.alertar(orgId, `Kit com variação: ${semUp.join(', ')} sem user product publicado; o saldo desses SKUs `
      + 'não chega ao Mercado Livre.');
  }
  return criadas;
}

export async function triarParticipantes(deps: DepsTriagem): Promise<number> {
  const orgs = await paginarTudo<{ id: string }>((de, ate) =>
    deps.admin.from('organizations').select('id').contains('modulos_habilitados', ['kit_variacao'])
      .order('id').range(de, ate));
  let n = 0;
  for (const o of orgs) {
    try {
      n += await triarOrg(deps, o.id);
    } catch (e) {
      console.error('reconciliar_kit_org_falhou', o.id, String(e));   // uma org nunca bloqueia outra
    }
  }
  return n;
}

export async function alertarPublicacoesParadas(
  admin: SupabaseClient, alertar: (orgId: string, texto: string) => Promise<void>, agoraMs = Date.now(),
): Promise<number> {
  const limite = new Date(agoraMs - PUBLICACAO_PARADA_MS).toISOString();
  const linhas = await paginarTudo<{ org_id: string; codigo: string }>((de, ate) =>
    admin.from('kit_exclusoes').select('org_id, codigo')
      .eq('dono_tipo', 'publicacao').lt('criado_em', limite).order('org_id').order('codigo').range(de, ate));
  const porOrg = new Map<string, string[]>();
  for (const l of linhas) porOrg.set(l.org_id, [...(porOrg.get(l.org_id) ?? []), l.codigo]);
  for (const [orgId, codigos] of porOrg) {
    await alertar(orgId, `Kit com variação: a publicação de ${codigos.join(', ')} não foi confirmada no Mercado Livre `
      + 'e o SKU segue reservado para ela. Confira o anúncio e use Reenviar.')
      .catch((e) => console.error('reconciliar_kit_alerta_falhou', orgId, String(e)));
  }
  return porOrg.size;
}

/** Mesmo prazo da geração do clique (`PRAZO_ATIVACAO_S` em politica.ts). */
const PRAZO_CONFERENCIA_S = 600;

/**
 * Task 6 (achado 1 e fix round 2): ativação do operador sem confirmação segura a exclusão `ativacao`. Só entra
 * intenção com o prazo da geração vencido (nenhum PUT em voo). A conferência reivindica a execução com geração
 * própria (`kit_ativacao_reivindicar`, atômico; outra execução viva recusa), lê no ML todos os alvos e libera
 * só se a geração examinada ainda for a dona (`kit_ativacao_liberar`). Leitura que falha mantém e alerta.
 * Nunca libera por idade nem pelo snapshot da seleção.
 */
export async function conferirAtivacoesPendentes(
  admin: SupabaseClient,
  deps: {
    token: (orgId: string) => Promise<string>;
    alertar: (orgId: string, texto: string) => Promise<void>;
    /** Só teste. Produção: `lerStatusMLEstrito` (só 404 é null; envelope inválido lança). */
    lerStatus?: (orgId: string, itemId: string) => Promise<unknown>;
  },
  agoraMs = Date.now(),
): Promise<number> {
  const lerStatus = deps.lerStatus ?? (async (orgId: string, itemId: string) => lerStatusMLEstrito(await deps.token(orgId), itemId));
  const agora = new Date(agoraMs).toISOString();
  const linhas = await paginarTudo<{ org_id: string; dono_id: string; ml_item_id: string; alvos: string[]; codigos: string[] }>(
    (de, ate) => admin.from('kit_ativacoes').select('org_id, dono_id, ml_item_id, alvos, codigos')
      .lt('ate', agora).order('org_id').order('dono_id').range(de, ate));
  let liberadas = 0;
  for (const l of linhas) {
    try {
      const geracao = crypto.randomUUID();
      const { data: claim, error: e1 } = await admin.rpc('kit_ativacao_reivindicar', {
        p_org: l.org_id, p_dono: l.dono_id, p_item: l.ml_item_id, p_alvos: null, p_codigos: null,
        p_geracao: geracao, p_prazo_s: PRAZO_CONFERENCIA_S,
      });
      if (e1) throw new Error(`kit_ativacao_reivindicar: ${e1.message}`);
      if ((claim as { ok?: boolean } | null)?.ok !== true) continue;   // outra execução assumiu
      for (const id of l.alvos) await lerStatus(l.org_id, id);   // lança = não confirmado
      const { data: ok, error: e2 } = await admin.rpc('kit_ativacao_liberar', {
        p_org: l.org_id, p_dono: l.dono_id, p_geracao: geracao, p_apagar: true,
      });
      if (e2) throw new Error(`kit_ativacao_liberar: ${e2.message}`);
      if (ok === true) liberadas++;
    } catch (e) {
      console.error('reconciliar_kit_ativacao_sem_confirmacao', l.org_id, l.ml_item_id, String(e));
      await deps.alertar(l.org_id, `Kit com variação: a reativação de ${l.ml_item_id} (${l.codigos.join(', ')}) segue sem `
        + 'confirmação no Mercado Livre, e o SKU continua reservado. Confira o anúncio e clique em Reativar de novo.')
        .catch((x) => console.error('reconciliar_kit_alerta_falhou', l.org_id, String(x)));
    }
  }
  return liberadas;
}
