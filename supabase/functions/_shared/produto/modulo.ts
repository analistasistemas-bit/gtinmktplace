// E6b (ADR-0094, D-13): esconder o menu é NAVEGAÇÃO (ADR-0047), não é fronteira de
// segurança. Sem esta checagem, qualquer token autenticado chamaria as edges do módulo
// mesmo numa org que não paga por ele.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export async function exigirModulo(
  admin: SupabaseClient, orgId: string, modulo: string,
): Promise<boolean> {
  const { data, error } = await admin.from('organizations')
    .select('modulos_habilitados').eq('id', orgId).maybeSingle();
  // Falha de leitura NÃO libera: gate fecha por padrão.
  if (error || !data) return false;
  const habilitados = (data.modulos_habilitados ?? []) as string[];
  return habilitados.includes(modulo);
}
