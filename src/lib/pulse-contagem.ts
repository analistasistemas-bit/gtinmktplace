// A contagem de alertas mora fora de `lib/pulse` porque a sidebar (bundle inicial, toda página)
// precisa dela: importar `lib/pulse` inteiro arrastaria `pulse-margem` e a qualificação de
// mercado para o carregamento inicial, que hoje só é pago ao entrar na rota /pulse.
import { supabase } from './supabase';
import type { FiltroSeveridade } from './pulse';

export async function contarPulseAlertas(severidade: FiltroSeveridade): Promise<number> {
  let q = supabase.from('pulse_alertas')
    .select('id', { count: 'exact', head: true })
    .eq('lido', false);
  if (severidade !== 'todos') q = q.eq('severidade', severidade);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}
