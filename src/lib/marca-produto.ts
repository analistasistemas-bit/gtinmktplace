// ADR-0188: marca por produto — leitura do estado de sync e chamada da edge "Editar marca".
import { supabase } from '@/lib/supabase';

export interface MarcaProduto {
  /** `familias.marca` da família vigente (null = usa a marca da org). */
  marca: string | null;
  status: 'pendente' | 'ok' | 'erro' | null;
  erro: string | null;
}

/** Marca da família vigente + status de sync da raiz do anúncio ML (`particao=0`). */
export async function fetchMarcaProduto(codigoPai: string): Promise<MarcaProduto> {
  const [fam, raiz] = await Promise.all([
    supabase.from('familias').select('marca').eq('codigo_pai', codigoPai)
      .order('publicado_em', { ascending: false, nullsFirst: false })
      .order('criado_em', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('anuncios_externos').select('marca_sync_status, marca_sync_erro')
      .eq('codigo_pai', codigoPai).eq('canal', 'mercado_livre').eq('particao', 0).maybeSingle(),
  ]);
  if (fam.error) throw fam.error;
  if (raiz.error) throw raiz.error;
  const s = raiz.data?.marca_sync_status;
  return {
    marca: fam.data?.marca ?? null,
    status: s === 'pendente' || s === 'ok' || s === 'erro' ? s : null,
    erro: raiz.data?.marca_sync_erro ?? null,
  };
}

/** `marca: null` = voltar à marca da org. Erros da edge (409/403/...) viram `Error(mensagem)`. */
export async function atualizarMarcaFamilia(codigoPai: string, marca: string | null) {
  const { data, error } = await supabase.functions.invoke('atualizar-marca-familia', {
    body: { codigo_pai: codigoPai, marca },
  });
  if (error) {
    let message = error.message;
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json();
        if (typeof payload?.erro === 'string') message = payload.erro;
      } catch {
        // Corpo não é JSON: mantém a mensagem original.
      }
    }
    throw new Error(message);
  }
  return data as { ok: boolean; publicado: boolean; status: 'pendente' | 'erro' | null };
}
