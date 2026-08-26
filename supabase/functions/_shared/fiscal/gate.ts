// ADR-0135 D-7 — gate de escrita de anúncio: org com módulo fiscal não publica família
// fiscalmente incompleta. LOUD via throw (cai no catch do worker → status='erro' visível).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { exigirModulo } from '../produto/modulo.ts';
import { camposFiscaisFaltantes, type CamposFiscaisFamilia } from './validar.ts';

export interface FamiliaFiscalRow extends CamposFiscaisFamilia {
  id: string;
  org_id: string;
  nome_pai: string;
}

/** @returns false = org sem módulo (nada a fazer); true = módulo ativo e família OK. */
export async function exigirFiscalCompletoSePreciso(
  admin: SupabaseClient, familia: FamiliaFiscalRow,
): Promise<boolean> {
  if (!(await exigirModulo(admin, familia.org_id, 'fiscal'))) return false;

  const { data: empresa } = await admin.from('empresa_fiscal')
    .select('regime_tributario').eq('org_id', familia.org_id).maybeSingle();
  const regime = (empresa?.regime_tributario ?? 'simples') as 'simples' | 'normal';

  const faltas = camposFiscaisFaltantes(familia, regime);
  if (faltas.length) {
    throw new Error(
      `Cadastro fiscal incompleto em "${familia.nome_pai}" — preencha antes de publicar: ` +
      `${faltas.join('; ')} (ADR-0135 D-7)`,
    );
  }
  return true;
}
