// ADR-0195: grava o que o worker enviou e agenda a conferência. O anúncio já foi escrito quando isto
// roda, então nada aqui derruba a publicação: linha sem job vira inconclusiva na tela pelo teto de 20 min.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { ResultadoAtualizacao } from '../canais/contrato.ts';
import { enfileirarConfirmacao } from '../queue.ts';
import type { EnviadoSku } from './avaliar.ts';

export interface ItemConfirmar {
  itemExternoId: string;
  modelo: 'variacoes' | 'item';
  enviado: Record<string, EnviadoSku>;
  capados: number;
}

/** Item escrito pelo conector no caminho Legacy/split. null quando a escrita não mexeu em estoque. */
export function itemConfirmarLegacy(
  itemExternoId: string,
  r: ResultadoAtualizacao,
  estoques: Array<{ codigo: string; estoque: number }>,
): ItemConfirmar | null {
  const enviado = r.enviados;
  if (!enviado) return null;
  return {
    itemExternoId,
    // Item plano (ADR-0084): o id externo do SKU é o próprio item, e o saldo fica na raiz.
    modelo: Object.values(r.variacoesExternas).includes(itemExternoId) ? 'item' : 'variacoes',
    enviado,
    capados: estoques.filter((v) => v.codigo in enviado && v.estoque > enviado[v.codigo].qtd).length,
  };
}

export async function registrarConfirmacao(admin: SupabaseClient, a: {
  orgId: string; loteId: string; familiaId: string; codigoPai: string; enviadoEm: string; itens: ItemConfirmar[];
}): Promise<void> {
  if (a.itens.length === 0) return;
  try {
    const { error } = await admin.from('confirmacoes_ml').upsert(a.itens.map((i) => ({
      org_id: a.orgId, lote_id: a.loteId, familia_id: a.familiaId, codigo_pai: a.codigoPai,
      item_externo_id: i.itemExternoId, modelo: i.modelo, enviado: i.enviado, capados: i.capados,
      enviado_em: a.enviadoEm,
      status: 'aguardando', tentativas: 0, observado: null, divergentes: [], verificado_em: null,
    })), { onConflict: 'familia_id,item_externo_id' });
    if (error) console.error(`registrar conferência falhou (${a.familiaId}):`, error.message);
  } catch (e) {
    console.error(`registrar conferência falhou (${a.familiaId}):`, (e as Error).message);
  }
}

export async function agendarConfirmacao(familiaId: string, enviadoEm: string): Promise<void> {
  try {
    await enfileirarConfirmacao({ familia_id: familiaId, tentativa: 1, versao: enviadoEm });
  } catch (e) {
    console.error(`agendar conferência falhou (${familiaId}):`, (e as Error).message);
  }
}
