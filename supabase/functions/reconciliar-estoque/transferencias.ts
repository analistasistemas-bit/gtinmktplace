// ADR-0197 (contrato de segurança, item 5): reconciliação diária do kit com variação.
// 1. Transferência pendente é reconciliada sem limite de 24 h.
// 2. Triagem: todo SKU participante, sem filtro de status local nem janela de movimento, tem o saldo
//    local comparado com o ML (só leitura, sem pausar). Diferença vira transferência `entrada`, que é o
//    único caminho que escreve quantidade nesses SKUs. É a rede para a entrada que não virou transferência.
// 3. Exclusão de publicação parada (resultado não confirmado) gera alerta: só o Reenviar a solta.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { paginarTudo } from '../_shared/pagina.ts';
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
    const { data: vs, error: e1 } = await admin.from('variacoes')
      .select('codigo, estoque, familias!inner(criado_em)').eq('org_id', orgId).in('codigo', bloco);
    if (e1) throw new Error(`variacoes: ${e1.message}`);
    for (const v of vs ?? []) {
      const criado = String((v.familias as { criado_em?: string } | null)?.criado_em ?? '');
      const atual = saldo.get(v.codigo as string);
      if (!atual || criado > atual.criado) saldo.set(v.codigo as string, { estoque: Number(v.estoque ?? 0), criado });
    }
    const { data: is, error: e2 } = await admin.from('anuncios_externos_itens')
      .select('sku, item_externo_id, user_product_id, catalog_listing_id, retirado').eq('org_id', orgId).in('sku', bloco);
    if (e2) throw new Error(`anuncios_externos_itens: ${e2.message}`);
    itens.push(...(is ?? []));
  }

  let criadas = 0;
  const semUp: string[] = [];
  for (const codigo of codigos) {
    // Sem filtro de status local: só o item retirado de propósito fica atrás do vivo.
    const doSku = itens.filter((i) => i.sku === codigo && i.user_product_id && i.item_externo_id)
      .sort((a, b) => Number(!!a.retirado) - Number(!!b.retirado));
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
