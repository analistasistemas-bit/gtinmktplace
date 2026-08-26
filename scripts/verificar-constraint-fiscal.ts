/**
 * Prova executável da constraint organizations_fiscal_exige_pj (ADR-0135 D-2).
 * Cria org sintética PF, tenta ligar o módulo fiscal via service_role e EXIGE a recusa;
 * vira a org para PJ e exige o aceite. Limpa tudo no finally. Exit 1 em qualquer furo.
 * Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... pnpm dlx tsx scripts/verificar-constraint-fiscal.ts
 */
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const slug = `constraint-fiscal-${Date.now()}`;
let orgId: string | null = null;

async function main() {
  const { data: org, error } = await db.from('organizations')
    .insert({ nome: 'TESTE constraint fiscal', slug, is_test: true }).select('id').single();
  if (error) throw new Error(`setup falhou: ${error.message}`);
  orgId = org.id;

  const pf = await db.from('organizations')
    .update({ modulos_habilitados: ['fiscal'] }).eq('id', org.id);
  if (!pf.error) throw new Error('FURO: org PF aceitou o módulo fiscal — constraint ausente');
  if (!/fiscal_exige_pj/.test(pf.error.message)) {
    throw new Error(`recusou pelo motivo errado: ${pf.error.message}`);
  }
  console.log('✓ PF + fiscal recusado pela constraint');

  const pj = await db.from('organizations')
    .update({ tipo_pessoa: 'pj', modulos_habilitados: ['fiscal'] }).eq('id', org.id);
  if (pj.error) throw new Error(`PJ + fiscal deveria passar: ${pj.error.message}`);
  console.log('✓ PJ + fiscal aceito');
}

main()
  .then(() => console.log('OK'))
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(async () => { if (orgId) await db.from('organizations').delete().eq('id', orgId); });
