// ADR-0175: rotinas que enumeram por linhas de domínio (vendas, movimentos, anúncios) e não por
// conexão precisam pular orgs arquivadas explicitamente.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { paginarTudo } from './pagina.ts';

export async function listarOrgsArquivadas(admin: SupabaseClient): Promise<Set<string>> {
  // Paginado (teto de 1000 linhas do PostgREST): id omitido seria tratado como org ativa.
  const linhas = await paginarTudo<{ id: string }>(
    (de, ate) => admin.from('organizations').select('id').not('arquivada_em', 'is', null).order('id').range(de, ate),
  );
  return new Set(linhas.map((o) => o.id));
}

/** Filtro PostgREST `not.in` — vazio quando não há arquivadas (aplicar só se `!== null`). */
export function filtroNotIn(ids: Set<string>): string | null {
  return ids.size === 0 ? null : `(${[...ids].join(',')})`;
}
