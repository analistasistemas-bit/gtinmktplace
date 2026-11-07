import { supabase } from '@/lib/supabase';

// Depois de salvar o fiscal, o push ao ML roda na fila (QStash): o save zera `fiscal_sincronizado_em`
// de todas as versões do produto e o worker grava de novo ao concluir, aceito ou recusado, junto com
// `can_invoice`. Sonda só esse campo (barato) em vez de recarregar a lista inteira a cada volta.
// ponytail: polling com teto de 60 s; trocar por Realtime se virar padrão em outras telas.
export async function aguardarSyncFiscal(
  familiaId: string,
  { intervaloMs = 3000, limiteMs = 60_000 }: { intervaloMs?: number; limiteMs?: number } = {},
): Promise<boolean> {
  const { data: fam } = await supabase.from('familias')
    .select('org_id, codigo_pai').eq('id', familiaId).maybeSingle();
  if (!fam) return false;
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    await new Promise((r) => setTimeout(r, intervaloMs));
    const { data, error } = await supabase.from('familias').select('fiscal_sincronizado_em')
      .eq('org_id', fam.org_id).eq('codigo_pai', fam.codigo_pai).eq('status', 'publicado');
    if (error || !data?.length) return false; // sem versão no ar não há push a esperar
    if (data.every((r) => r.fiscal_sincronizado_em)) return true;
  }
  return false;
}
