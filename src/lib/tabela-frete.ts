import { supabase } from './supabase';

export interface FaixaPreco {
  label: string;
  itemPrice: number;
}

export interface FaixaPeso {
  label: string;
  pesoGramas: number;
  dimensoes: {
    altura_cm: number;
    largura_cm: number;
    comprimento_cm: number;
    peso_gramas: number;
  };
}

export interface TabelaFrete {
  faixasPreco: FaixaPreco[];
  faixasPeso: FaixaPeso[];
  celulas: number[][];
}

export interface TabelaFreteIndisponivel {
  indisponivel: true;
  motivo: 'sem_me2';
}

export type RespostaTabelaFrete = TabelaFrete | TabelaFreteIndisponivel | { erro: true };

export function isTabelaFrete(r: RespostaTabelaFrete): r is TabelaFrete {
  return r != null && 'celulas' in r && Array.isArray(r.celulas);
}

export async function fetchTabelaFrete(categoriaMlId: string): Promise<RespostaTabelaFrete> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');

  const r = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tabela-frete-ml`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ categoria_ml_id: categoriaMlId }),
    },
  );
  if (!r.ok) throw new Error('Falha ao carregar tabela de frete');
  return r.json() as Promise<RespostaTabelaFrete>;
}
