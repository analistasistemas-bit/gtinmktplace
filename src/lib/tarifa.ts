import { supabase } from './supabase';

export interface TarifaTipo {
  comissao: number;
  percentual: number;
  fixa: number;
  recebe: number;
}

export interface Tarifa {
  classico: TarifaTipo;
  premium: TarifaTipo;
}

/** Calcula a comissão ML (Clássico/Premium) para preço+categoria. null em falha/indisponível. */
export async function calcularTarifaML(
  preco: number,
  categoriaMlId: string,
): Promise<Tarifa | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');

  const r = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calcular-tarifa-ml`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ preco, categoria_ml_id: categoriaMlId }),
    },
  );
  if (!r.ok) return null;
  const data = await r.json();
  if (data?.erro) return null;
  return data as Tarifa;
}
