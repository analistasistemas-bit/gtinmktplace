import { buscarFreteVendedor } from './frete.ts';
import type { DimensoesPacote } from './pacote.ts';

export interface FaixaPreco {
  label: string;
  itemPrice: number;
}

export interface FaixaPeso {
  label: string;
  pesoGramas: number;
  dimensoes: DimensoesPacote;
}

export interface TabelaFrete {
  faixasPreco: FaixaPreco[];
  faixasPeso: FaixaPeso[];
  /** [pesoIdx][precoIdx] — frete que o vendedor absorve (R$). */
  celulas: number[][];
}

export const FAIXAS_PRECO: FaixaPreco[] = [
  { label: 'Até R$ 18,99', itemPrice: 15 },
  { label: 'R$ 19 – R$ 48,99', itemPrice: 35 },
  { label: 'R$ 49 – R$ 78,99', itemPrice: 65 },
  { label: '≥ R$ 79', itemPrice: 100 },
];

export const FAIXAS_PESO: FaixaPeso[] = [
  { label: 'Até 300 g', pesoGramas: 300, dimensoes: { altura_cm: 14, largura_cm: 4, comprimento_cm: 4, peso_gramas: 300 } },
  { label: 'Até 1 kg', pesoGramas: 1000, dimensoes: { altura_cm: 10, largura_cm: 10, comprimento_cm: 10, peso_gramas: 1000 } },
  { label: 'Até 2 kg', pesoGramas: 2000, dimensoes: { altura_cm: 13, largura_cm: 13, comprimento_cm: 13, peso_gramas: 2000 } },
  { label: 'Até 5 kg', pesoGramas: 5000, dimensoes: { altura_cm: 17, largura_cm: 17, comprimento_cm: 17, peso_gramas: 5000 } },
  { label: 'Até 10 kg', pesoGramas: 10000, dimensoes: { altura_cm: 22, largura_cm: 22, comprimento_cm: 22, peso_gramas: 10000 } },
  { label: 'Até 20 kg', pesoGramas: 20000, dimensoes: { altura_cm: 27, largura_cm: 27, comprimento_cm: 27, peso_gramas: 20000 } },
  { label: 'Até 30 kg', pesoGramas: 30000, dimensoes: { altura_cm: 31, largura_cm: 31, comprimento_cm: 31, peso_gramas: 30000 } },
];

type FetchFrete = (
  token: string,
  mlUserId: string,
  preco: number,
  categoria: string,
  dim?: DimensoesPacote | null,
) => Promise<number>;

const LOTE = 5;

async function emLotes<T>(tarefas: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tarefas.length; i += LOTE) {
    const fatia = tarefas.slice(i, i + LOTE);
    out.push(...(await Promise.all(fatia.map((fn) => fn()))));
  }
  return out;
}

/**
 * Monta grade 7×4 (peso × preço) consultando shipping_options/free por célula.
 * Valores = frete que o vendedor absorve (0 = comprador paga).
 */
export async function montarTabelaFrete(
  token: string,
  mlUserId: string,
  categoriaId: string,
  fetchFrete: FetchFrete = buscarFreteVendedor,
): Promise<TabelaFrete> {
  const tarefas: (() => Promise<number>)[] = [];
  for (const peso of FAIXAS_PESO) {
    for (const preco of FAIXAS_PRECO) {
      tarefas.push(() => fetchFrete(token, mlUserId, preco.itemPrice, categoriaId, peso.dimensoes));
    }
  }
  const valores = await emLotes(tarefas);

  const celulas: number[][] = [];
  let idx = 0;
  for (let p = 0; p < FAIXAS_PESO.length; p++) {
    const linha: number[] = [];
    for (let c = 0; c < FAIXAS_PRECO.length; c++) {
      linha.push(valores[idx++]);
    }
    celulas.push(linha);
  }

  return { faixasPreco: FAIXAS_PRECO, faixasPeso: FAIXAS_PESO, celulas };
}
