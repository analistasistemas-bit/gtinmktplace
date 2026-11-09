// Leitura persistida da etiqueta por campo (R1.3), entrada de `lerFicha` → `aplicarEtiqueta`.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { AnuncioGaleria } from './anuncio.ts';
import type { LeituraCampo } from './fatos.ts';

// ponytail: nada produz nem grava a leitura ainda (ruling: Task 6b). Sem leitura = ficha sem conferência.
export function lerLeituraEtiqueta(
  _admin: SupabaseClient, _orgId: string, _a: AnuncioGaleria,
): Promise<Record<string, LeituraCampo>> {
  return Promise.resolve({});
}
