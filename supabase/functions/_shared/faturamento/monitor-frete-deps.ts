// Fiação real do monitor de frete (ADR-0169). Só ligação, nenhuma decisão — a regra vive em
// monitor-frete.ts, testada por vitest. Validada contra Postgres real na Task 6.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { reservarNotificacao } from './notificacoes-dedupe.ts';
import { notificarCategoria } from '../notificacoes/config.ts';
import type { DepsAltaFrete, VendaAnteriorFrete } from './monitor-frete.ts';

export function depsMonitorFrete(admin: SupabaseClient): DepsAltaFrete {
  return {
    async monitorAtivo(orgId) {
      const { data, error } = await admin.from('configuracoes')
        .select('monitor_frete_ativo').eq('org_id', orgId).maybeSingle();
      if (error) throw new Error(`monitorAtivo: ${error.message}`);
      return data?.monitor_frete_ativo === true;
    },

    async buscarVendaAnterior({ orgId, mlItemId, variationId, antesDe, orderId }) {
      // Regra inteira (1 linha/1 unidade, fora de pack, desempate por order_id) vive na função SQL
      // da Task 1 — a mesma que a medição da Task 6 usa.
      const { data, error } = await admin.rpc('frete_venda_anterior', {
        p_org_id: orgId, p_ml_item_id: mlItemId, p_variation_id: variationId,
        p_antes: antesDe, p_order_id: orderId,
      }).maybeSingle();
      if (error) throw new Error(`buscarVendaAnterior: ${error.message}`);
      if (!data) return null;
      const r = data as { order_id: number | string; frete_vendedor: number | string };
      return { order_id: Number(r.order_id), frete_vendedor: Number(r.frete_vendedor) } as VendaAnteriorFrete;
    },
    reservar: (orgId, userId, chave) => reservarNotificacao(admin, orgId, userId, 'frete_subiu', chave),
    notificar: (orgId, texto) => notificarCategoria(admin, orgId, 'financeiro', texto),
  };
}
