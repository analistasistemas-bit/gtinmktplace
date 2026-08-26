// ADR-0135 — miolo do push fiscal, deps injetadas (padrão sincronizar-estoque).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { SincronizarFiscalJob } from '../_shared/queue.ts';
import {
  montarFiscalInformation, type FamiliaFiscalPush, type VariacaoFiscalPush,
} from '../_shared/canais/fiscal-ml.ts';

export interface DepsFiscal {
  admin: SupabaseClient;
  resolverConexao: (admin: SupabaseClient, orgId: string, canal: string) => Promise<{ id: string } | null>;
  getToken: (conexao: unknown) => Promise<string>;
  listarVariacoes: (admin: SupabaseClient, familiaId: string) => Promise<VariacaoFiscalPush[]>;
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
    .select('id, org_id, nome_pai, ml_item_id, unidade, origem, ncm, cest, origem_nfe, fci, ex_tipi, tributacao_icms, tributacao_icms_regime')
    .eq('id', job.familia_id).single();
  if (!familia) return { status: 404, body: { erro: 'família não encontrada' } };

  const { data: org } = await admin.from('organizations')
    .select('modulos_habilitados').eq('id', familia.org_id).maybeSingle();
  if (!((org?.modulos_habilitados ?? []) as string[]).includes('fiscal')) {
    return { status: 200, body: { skip: 'org sem módulo fiscal' } };
  }
  const { data: empresa } = await admin.from('empresa_fiscal')
    .select('origin_type, regime_tributario').eq('org_id', familia.org_id).maybeSingle();

  const conexao = await deps.resolverConexao(admin, familia.org_id, 'mercado_livre');
  if (!conexao) return { status: 200, body: { erro: 'org sem conexão com o Mercado Livre' } };
  const token = await deps.getToken(conexao);
  const variacoes = await deps.listarVariacoes(admin, familia.id);
  const agora = () => new Date().toISOString();

  try {
    for (const v of variacoes) {
      const payload = montarFiscalInformation(familia as FamiliaFiscalPush, v, {
        origin_type: empresa?.origin_type ?? null,
      });
      await deps.portas.empurrarFiscalSku(token, payload);
      if (familia.ml_item_id) {
        await deps.portas.vincularSkuAnuncio(token, {
          sku: v.codigo, item_id: familia.ml_item_id,
          ...(v.ml_variation_id ? { variation_id: v.ml_variation_id } : {}),
        });
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

  if (familia.ml_item_id) {
    const pront = await deps.portas.lerCanInvoice(token, familia.ml_item_id);
    if (pront) {
      await admin.from('familias').update({
        can_invoice: pront.pronto, can_invoice_causa: pront.causa, can_invoice_em: agora(),
      }).eq('id', familia.id);
    }
  }
  await admin.from('familias').update({ fiscal_sincronizado_em: agora() }).eq('id', familia.id);
  return { status: 200, body: { ok: true } };
}
