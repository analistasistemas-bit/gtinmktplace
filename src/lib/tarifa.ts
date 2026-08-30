import { supabase } from './supabase';
import type { CotacoesOficiaisPorModalidade, Proveniencia } from './calculadora-ml';

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
  /** De onde vieram comissão e frete (ADR-0148 D-3). Ausente = resposta antiga, tratada como
   *  não-oficial pela DRE. */
  proveniencia?: Proveniencia;
  /** Por que não é `official` — vai para a tela na recusa da DRE. */
  motivo_proveniencia?: string;
}

/**
 * Proveniência da tarifa para a DRE, **falhando fechado** (ADR-0148 D-3): resposta sem o campo é
 * `estimated`, nunca `official`. Só existe uma forma de a DRE calcular, e ela é o ML ter
 * respondido tudo com as dimensões reais.
 *
 * Não use isto para a calculadora da Revisão: ela segue com `cotacoesOficiaisDaTarifa`, cujo
 * comportamento esta fatia não altera (ADR-0148, critério de aceite 1).
 */
export function provenienciaDaTarifa(tarifa: Tarifa): { proveniencia: Proveniencia; motivo?: string } {
  if (tarifa.proveniencia == null) {
    return { proveniencia: 'estimated', motivo: 'a cotação veio sem informar a origem dos números' };
  }
  return {
    proveniencia: tarifa.proveniencia,
    ...(tarifa.motivo_proveniencia ? { motivo: tarifa.motivo_proveniencia } : {}),
  };
}

/**
 * Adapta a resposta oficial sem recomputar comissão, taxa fixa ou frete no cliente.
 *
 * **Ela crava `proveniencia: 'official'` de propósito, e NÃO é o guard.** Quem decide se a cotação
 * merece esse selo é o chamador: `cotacaoOficialComFreteConfirmado`
 * (`src/hooks/useCalculadoraML.ts:85`) só devolve esta adaptação quando `entrada.dimensoes` existe
 * — sem dimensões ele troca por frete manual e marca `partial`.
 *
 * Ler esta função isolada leva a concluir que a Revisão afirma "oficial" sobre qualquer frete.
 * **Não afirma** — e a ADR-0148 chegou a registrar essa dívida maior do que ela é por causa desta
 * leitura (ver a errata de lá). O caso que de fato escapa é dimensão presente porém **abaixo do
 * piso** de `PISO_MEDIDA_CM = 0.2`: a edge function devolve `partial`, o `if (entrada.dimensoes)`
 * passa mesmo assim, e o `partial` é sobrescrito. Decisão de Diego em 2026-08-29: não consertar.
 */
export function cotacoesOficiaisDaTarifa(tarifa: Tarifa): CotacoesOficiaisPorModalidade {
  return {
    origem: 'official',
    classico: {
      percentualComissaoPct: tarifa.classico.percentual,
      taxaFixa: tarifa.classico.fixa,
      comissaoTotal: tarifa.classico.comissao,
      frete: tarifa.frete,
      proveniencia: 'official',
    },
    premium: {
      percentualComissaoPct: tarifa.premium.percentual,
      taxaFixa: tarifa.premium.fixa,
      comissaoTotal: tarifa.premium.comissao,
      frete: tarifa.frete,
      proveniencia: 'official',
    },
  };
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
