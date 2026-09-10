import { supabase } from '@/lib/supabase';
import { erroDaEdge } from '@/lib/edge-erro';

/** Anúncio vivo na conta do ML que o PubliAI não conhece (incidente 2026-09-10, adendo ADR-0088). */
export interface AnuncioOrfao {
  mlItemId: string;
  titulo: string | null;
  status: string | null;
  permalink: string | null;
  estoque: number | null;
  /** `seller_custom_field` do ML: quando vem preenchido, o anúncio SAIU daqui e perdeu o vínculo. */
  sku: string | null;
}

export interface ResultadoVarredura {
  orfaos: AnuncioOrfao[];
  totalNoMl: number;
  /** A conta tem mais anúncios do que o search do ML entrega (teto de 1000): varredura parcial. */
  truncado: boolean;
}

/** Sob demanda: cada execução gasta ~1 chamada ao ML por 100 anúncios. Nunca em intervalo. */
export async function varrerAnunciosOrfaos(): Promise<ResultadoVarredura> {
  const { data, error } = await supabase.functions.invoke('varrer-anuncios-orfaos', { body: {} });
  if (error) throw await erroDaEdge(error);
  const r = data as {
    orfaos?: Array<{ ml_item_id: string; titulo: string | null; status: string | null; permalink: string | null; estoque: number | null; sku: string | null }>;
    total_no_ml?: number;
    truncado?: boolean;
    error?: string;
  } | null;
  if (typeof r?.error === 'string') throw new Error(r.error);
  return {
    orfaos: (r?.orfaos ?? []).map((o) => ({
      mlItemId: o.ml_item_id, titulo: o.titulo, status: o.status,
      permalink: o.permalink, estoque: o.estoque, sku: o.sku,
    })),
    totalNoMl: r?.total_no_ml ?? 0,
    truncado: r?.truncado === true,
  };
}
