// ADR-0135 — miolo do push fiscal, deps injetadas (padrão sincronizar-estoque).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { SincronizarFiscalJob } from '../_shared/queue.ts';
import {
  montarFiscalInformation, type FamiliaFiscalPush, type VariacaoFiscalPush,
} from '../_shared/canais/fiscal-ml.ts';
import { camposFiscaisFaltantes, type CamposFiscaisFamilia } from '../_shared/fiscal/validar.ts';

export interface ItemUP { sku: string; item_externo_id: string | null }

export interface DepsFiscal {
  admin: SupabaseClient;
  resolverConexao: (admin: SupabaseClient, orgId: string, canal: string) => Promise<{ id: string } | null>;
  getToken: (conexao: unknown) => Promise<string>;
  listarVariacoes: (admin: SupabaseClient, familiaId: string) => Promise<VariacaoFiscalPush[]>;
  /** Fix round 2 (C1): filhos User Products da família (ADR-0088). [] = Legacy (1 item só). */
  listarItensUP: (admin: SupabaseClient, orgId: string, codigoPai: string) => Promise<ItemUP[]>;
  portas: {
    empurrarFiscalSku: (token: string, payload: Record<string, unknown>) => Promise<void>;
    vincularSkuAnuncio: (token: string, v: { sku: string; item_id: string; variation_id?: string }) => Promise<void>;
    lerCanInvoice: (token: string, itemId: string) => Promise<{ pronto: boolean; causa: string | null } | null>;
  };
}

const ehTransitorio = (e: unknown): boolean => {
  const s = (e as { status?: number }).status;
  return s == null || s === 429 || s >= 500;
};

export async function processarSincronizacaoFiscal(
  deps: DepsFiscal, job: SincronizarFiscalJob,
): Promise<{ status: number; body: unknown }> {
  const { admin } = deps;
  const { data: familia } = await admin.from('familias')
    .select('id, org_id, codigo_pai, nome_pai, ml_item_id, unidade, origem, ncm, cest, origem_nfe, fci, ex_tipi, tributacao_icms, tributacao_icms_regime')
    .eq('id', job.familia_id).single();
  if (!familia) return { status: 404, body: { erro: 'família não encontrada' } };

  // Fix round 3 (Q2): erro de LEITURA (transitório) nunca vira decisão definitiva — 500 pro
  // QStash retentar. Só `data == null` de verdade (linha ausente) é decisão.
  const { data: org, error: orgErr } = await admin.from('organizations')
    .select('modulos_habilitados').eq('id', familia.org_id).maybeSingle();
  if (orgErr) return { status: 500, body: orgErr.message };
  if (!((org?.modulos_habilitados ?? []) as string[]).includes('fiscal')) {
    return { status: 200, body: { skip: 'org sem módulo fiscal' } };
  }
  const { data: empresa, error: empresaErr } = await admin.from('empresa_fiscal')
    .select('origin_type, regime_tributario').eq('org_id', familia.org_id).maybeSingle();
  if (empresaErr) return { status: 500, body: empresaErr.message };
  const agora = () => new Date().toISOString();

  const recusar = async (causa: string): Promise<{ status: number; body: unknown }> => {
    await admin.from('familias').update({
      can_invoice: false, can_invoice_causa: causa, can_invoice_em: agora(),
    }).eq('id', familia.id);
    return { status: 200, body: { erro: causa } };
  };

  // Fix round 1/2: o gate (D-7) roda no publish/update, mas o worker é alvo de re-enqueue MANUAL
  // via QStash (operação de rotina neste projeto) — nunca confiar que o gate já passou. Valida
  // de novo aqui, ANTES de montar/empurrar qualquer payload. `regime_tributario` NUNCA defaulta
  // em silêncio quando `empresa_fiscal` não existe (I5) — e v1 só emite Simples Nacional (C2/D-6).
  if (!empresa) return await recusar('push recusado: organização sem cadastro em empresa_fiscal');
  if (!empresa.origin_type) return await recusar('push recusado: origin_type não cadastrado em empresa_fiscal');
  if (empresa.regime_tributario !== 'simples') {
    return await recusar('v1 emite só Simples Nacional — regime da org é normal (ADR-0135 D-6)');
  }
  const faltas = camposFiscaisFaltantes(familia as CamposFiscaisFamilia, 'simples');
  if (faltas.length) return await recusar(`push recusado: cadastro incompleto — ${faltas.join('; ')}`);

  const conexao = await deps.resolverConexao(admin, familia.org_id, 'mercado_livre');
  if (!conexao) return { status: 200, body: { erro: 'org sem conexão com o Mercado Livre' } };
  const token = await deps.getToken(conexao);

  // Fix round 3 (Q1): listarVariacoes/listarItensUP lançam em erro de leitura (index.ts) — nunca
  // vira decisão definitiva, sempre 500 pro QStash retentar, sem tocar can_invoice.
  let variacoes: VariacaoFiscalPush[];
  let itensUP: ItemUP[];
  try {
    variacoes = await deps.listarVariacoes(admin, familia.id);
    // C1: rota UP tem um item ML POR SKU (anuncios_externos_itens); familias.ml_item_id só guarda
    // o 1º item da partição 0 — usá-lo pra TODOS os SKUs afirmaria fiscal no item errado. Família
    // Legacy (sem filhos) não muda: 1 item só, de familias.ml_item_id, como sempre foi.
    itensUP = await deps.listarItensUP(admin, familia.org_id, familia.codigo_pai);
  } catch (e) {
    return { status: 500, body: (e as Error).message };
  }
  const itemIdPorSku = new Map(itensUP.map((i) => [i.sku, i.item_externo_id]));
  const itemIdDoSku = (sku: string): string | null =>
    itensUP.length > 0 ? (itemIdPorSku.get(sku) ?? null) : familia.ml_item_id;

  // Q3: SKU da rota UP sem item resolvido (pendente/criacao_incerta) não pode ficar de fora do
  // AND em silêncio — sem isso a família gravaria can_invoice=true com um SKU nunca vinculado.
  const skusOrfaos: string[] = [];

  try {
    for (const v of variacoes) {
      const payload = montarFiscalInformation(familia as FamiliaFiscalPush, v, {
        origin_type: empresa.origin_type,
      });
      await deps.portas.empurrarFiscalSku(token, payload);
      const itemId = itemIdDoSku(v.codigo);
      if (itemId) {
        await deps.portas.vincularSkuAnuncio(token, {
          sku: v.codigo, item_id: itemId,
          ...(v.ml_variation_id ? { variation_id: v.ml_variation_id } : {}),
        });
      } else if (itensUP.length > 0) {
        skusOrfaos.push(v.codigo);
      }
    }
  } catch (e) {
    if (ehTransitorio(e)) {
      // 5xx/timeout: 500 (texto) → QStash retenta; o upsert torna o replay inofensivo.
      return { status: 500, body: (e as Error).message };
    }
    // 4xx: definitivo — pendência visível no semáforo, sem retry (D-9 do ADR-0114, herdado).
    await admin.from('familias').update({
      can_invoice: false,
      can_invoice_causa: `push fiscal recusado: ${(e as Error).message}`,
      can_invoice_em: agora(),
    }).eq('id', familia.id);
    return { status: 200, body: { erro: (e as Error).message } };
  }

  if (skusOrfaos.length > 0) {
    const causa = `SKU(s) sem item vinculado no ML: ${skusOrfaos.join(', ')}`;
    await admin.from('familias').update({
      can_invoice: false, can_invoice_causa: causa, can_invoice_em: agora(),
    }).eq('id', familia.id);
    await admin.from('familias').update({ fiscal_sincronizado_em: agora() }).eq('id', familia.id);
    return { status: 200, body: { erro: causa } };
  }

  // Semáforo: um item por SKU na rota UP (AND — qualquer item não-pronto derruba a família toda,
  // causa citando qual item), um item só na Legacy. Leitura falha (null) em QUALQUER item NÃO
  // escreve nada — nunca regride um `true` já gravado por causa de uma falha transitória de
  // leitura (I7); só grava quando TODOS os itens responderam de verdade.
  const idsParaChecar = itensUP.length > 0
    ? Array.from(new Set(itensUP.map((i) => i.item_externo_id).filter((id): id is string => !!id)))
    : (familia.ml_item_id ? [familia.ml_item_id] : []);
  if (idsParaChecar.length > 0) {
    const resultados = await Promise.all(idsParaChecar.map(async (itemId) => ({
      itemId, r: await deps.portas.lerCanInvoice(token, itemId),
    })));
    if (resultados.every(({ r }) => r != null)) {
      const falha = resultados.find(({ r }) => !r!.pronto);
      const pronto = !falha;
      const causa = falha
        ? (itensUP.length > 0 ? `item ${falha.itemId}: ${falha.r!.causa}` : falha.r!.causa)
        : null;
      await admin.from('familias').update({
        can_invoice: pronto, can_invoice_causa: causa, can_invoice_em: agora(),
      }).eq('id', familia.id);
    }
  }
  await admin.from('familias').update({ fiscal_sincronizado_em: agora() }).eq('id', familia.id);
  return { status: 200, body: { ok: true } };
}
