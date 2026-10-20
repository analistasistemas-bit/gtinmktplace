// A3 (auditoria fiscal 19/10): regime tributário da org NUNCA é presumido. Erro de leitura é
// transitório (sem `.status` → retenta); ausência de cadastro ou regime ≠ simples é definitivo (400).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export async function lerRegimeFiscalOrg(admin: SupabaseClient, orgId: string): Promise<'simples'> {
  const { data, error } = await admin.from('empresa_fiscal')
    .select('regime_tributario').eq('org_id', orgId).maybeSingle();
  if (error) throw new Error(`empresa_fiscal: ${error.message}`);
  if (!data) {
    throw Object.assign(
      new Error('Organização sem cadastro da empresa fiscal — preencha em Configurações › Fiscal (ADR-0135)'),
      { status: 400 },
    );
  }
  if (data.regime_tributario !== 'simples') {
    throw Object.assign(
      new Error(`v1 emite só Simples Nacional — regime da organização é "${data.regime_tributario}" (ADR-0135 D-6)`),
      { status: 400 },
    );
  }
  return 'simples';
}
