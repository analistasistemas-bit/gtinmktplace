import { supabase } from './supabase';

export interface TarifaTipo {
  comissao: number;
  percentual: number;
  fixa: number;
  /** Imposto por origem (ADR-0055): preço × alíquota, já descontado de `recebe`. */
  imposto: number;
  recebe: number;
}

export interface Tarifa {
  classico: TarifaTipo;
  premium: TarifaTipo;
  /** Frete que o vendedor absorve (frete grátis ao comprador). 0 quando o comprador paga. */
  frete: number;
}

/** Dimensões/peso da variação representativa — entram no cálculo do frete do vendedor. */
export interface DimensoesFrete {
  alturaCm: number | null;
  larguraCm: number | null;
  comprimentoCm: number | null;
  pesoGramas: number | null;
}

/**
 * Calcula a tarifa ML (Clássico/Premium) para preço+categoria, com o `recebe` já líquido do
 * frete que o vendedor paga. null em falha/indisponível. `dim` opcional: sem dimensões válidas
 * o frete vem 0 (o ML estimaria no anúncio).
 */
/** Desconta o imposto (preço × alíquota%) do `recebe` de um tipo e registra o valor. */
function comImposto(t: TarifaTipo, imposto: number): TarifaTipo {
  return { ...t, imposto, recebe: Math.round((t.recebe - imposto) * 100) / 100 };
}

export async function calcularTarifaML(
  preco: number,
  categoriaMlId: string,
  dim?: DimensoesFrete | null,
  aliquotaPct = 0,
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
      body: JSON.stringify({
        preco,
        categoria_ml_id: categoriaMlId,
        dimensoes: dim
          ? {
              altura_cm: dim.alturaCm,
              largura_cm: dim.larguraCm,
              comprimento_cm: dim.comprimentoCm,
              peso_gramas: dim.pesoGramas,
            }
          : null,
      }),
    },
  );
  if (!r.ok) return null;
  const data = await r.json();
  if (data?.erro) return null;
  const t = data as Tarifa;
  if (aliquotaPct <= 0) return t;
  const imposto = Math.round(preco * (aliquotaPct / 100) * 100) / 100;
  return { ...t, classico: comImposto(t.classico, imposto), premium: comImposto(t.premium, imposto) };
}
