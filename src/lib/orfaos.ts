import { supabase } from '@/lib/supabase';
import { erroDaEdge } from '@/lib/edge-erro';

/**
 * Como classificar o achado. Sem isto a lista mistura o caso acionável com centenas de anúncios que
 * nunca foram do PubliAI — e, pior, com anúncios de CATÁLOGO saudáveis, que foi o falso alarme de
 * 2026-09-10 (o ML cria um item próprio a partir do anúncio do app, herdando o mesmo código).
 */
export type ClasseOrfao = 'perdido_do_app' | 'catalogo_sem_vinculo' | 'externo';

/** Anúncio vivo na conta do ML que o PubliAI não conhece (incidente 2026-09-10, adendo ADR-0088). */
export interface AnuncioOrfao {
  mlItemId: string;
  titulo: string | null;
  status: string | null;
  permalink: string | null;
  estoque: number | null;
  /** `seller_custom_field` do ML: quando vem preenchido, o anúncio SAIU daqui e perdeu o vínculo. */
  sku: string | null;
  classe: ClasseOrfao;
  /** Pausado + código do app: quase sempre é o resultado esperado de "Remover", não uma pendência. */
  provavelRemocaoPeloApp: boolean;
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
    orfaos?: Array<{
      ml_item_id: string; titulo: string | null; status: string | null; permalink: string | null;
      estoque: number | null; sku: string | null; classe?: ClasseOrfao; provavel_remocao_pelo_app?: boolean;
    }>;
    total_no_ml?: number;
    truncado?: boolean;
    error?: string;
  } | null;
  if (typeof r?.error === 'string') throw new Error(r.error);
  return {
    orfaos: (r?.orfaos ?? []).map((o) => ({
      mlItemId: o.ml_item_id, titulo: o.titulo, status: o.status,
      permalink: o.permalink, estoque: o.estoque, sku: o.sku,
      classe: o.classe ?? 'externo',
      provavelRemocaoPeloApp: o.provavel_remocao_pelo_app === true,
    })),
    totalNoMl: r?.total_no_ml ?? 0,
    truncado: r?.truncado === true,
  };
}
