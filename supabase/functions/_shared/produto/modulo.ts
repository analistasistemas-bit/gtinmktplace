// E6b (ADR-0094, D-13): esconder o menu é NAVEGAÇÃO (ADR-0047), não é fronteira de
// segurança. Sem esta checagem, qualquer token autenticado chamaria as edges do módulo
// mesmo numa org que não paga por ele.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// Use esta versão nos gates de ACESSO (403 de edge function): erro de leitura deve fechar
// o gate, nunca abrir — menos acesso é o lado seguro de uma falha transitória de banco.
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

// Use esta versão nos gates de DECISÃO DE NEGÓCIO (ex.: publicação) onde "módulo desativado"
// e "módulo ativado" levam a caminhos DIFERENTES (um pula o gate, o outro exige cadastro
// completo) — aqui `false` não é o lado seguro: erro de leitura virando `false` faria a família
// publicar SEM gate e sem push fiscal, o inverso de fail-closed. Por isso lança em vez de
// devolver `false`; quem chama deixa o throw propagar como falha transitória (sem `.status`,
// decidirRetryPorErro retenta).
export async function moduloHabilitadoStrict(
  admin: SupabaseClient, orgId: string, modulo: string,
): Promise<boolean> {
  const { data, error } = await admin.from('organizations')
    .select('modulos_habilitados').eq('id', orgId).maybeSingle();
  if (error) throw new Error(`moduloHabilitadoStrict: organizations: ${error.message}`);
  const habilitados = (data?.modulos_habilitados ?? []) as string[];
  return habilitados.includes(modulo);
}
