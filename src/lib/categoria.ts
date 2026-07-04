import { supabase } from './supabase';
import type { TipoAviamento } from './tipos-dominio';

// Rótulos de exibição dos tipos de aviamento conhecidos (fallback quando categoriaNome vier vazio
// de dados antigos). Não é mais a lista de opções do seletor — isso agora é busca livre (ADR-0057).
export const CATEGORIAS_MANUAIS: { tipo: Exclude<TipoAviamento, 'outro'>; rotulo: string }[] = [
  { tipo: 'linha', rotulo: 'Fios e Cadarços' },
  { tipo: 'fita', rotulo: 'Fita de Cetim' },
  { tipo: 'botao', rotulo: 'Botões' },
  { tipo: 'cola', rotulo: 'Bastões de Cola' },
];

export async function definirCategoriaLivre(
  familiaId: string,
  categoriaMlId: string,
  categoriaNome: string,
): Promise<{ categoria_ml_id: string; categoria_nome: string; tipo_aviamento: TipoAviamento; atributos_faltantes: string[] }> {
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
      body: JSON.stringify({ familia_id: familiaId, categoria_ml_id: categoriaMlId, categoria_nome: categoriaNome }),
    },
  );

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Falha ao definir categoria: ${txt || r.status}`);
  }
  return r.json();
}
