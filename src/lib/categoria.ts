import { supabase } from './supabase';
import type { TipoAviamento } from './tipos-dominio';

export type TipoCategoriaManual = Exclude<TipoAviamento, 'outro'>;

// Tipos com categoria-folha ML mapeada, oferecidos no seletor manual da Revisão.
export const CATEGORIAS_MANUAIS: { tipo: TipoCategoriaManual; rotulo: string }[] = [
  { tipo: 'linha', rotulo: 'Fios e Cadarços' },
  { tipo: 'fita', rotulo: 'Fita de Cetim' },
  { tipo: 'botao', rotulo: 'Botões' },
  { tipo: 'cola', rotulo: 'Bastões de Cola' },
];

export async function definirCategoriaFamilia(
  familiaId: string,
  tipo: TipoCategoriaManual,
): Promise<{ categoria_ml_id: string; tipo_aviamento: TipoAviamento }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');

  const r = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/definir-categoria-familia`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ familia_id: familiaId, tipo }),
    },
  );

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Falha ao definir categoria: ${txt || r.status}`);
  }
  return r.json();
}
