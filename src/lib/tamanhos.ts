// ADR-0166: listas fixas de Tamanho (roupa) e Numeração (calçado), e o produto cartesiano
// cor × tamanho que alimenta o botão "Gerar variações" do cadastro manual.
//
// São listas de PICK, nunca texto livre: o ML normaliza valor de atributo (o mesmo que já
// acontece com COLOR, onde `Rosa Claro` vira `Rosa-claro` na publicação), e texto livre aqui
// produziria uma linha de tabela de medidas por digitação divergente.
//
// NÃO confundir com `TAMANHOS_KIT` (src/lib/kit.ts), que é quantidade de unidades dentro de um
// Kit vinculado (2 a 6) e não tem relação nenhuma com tamanho de peça.
//
// R7 da revisão do Fable: as LISTAS vêm da fonte única do backend e são só reexportadas aqui.
// Antes elas só existiam no frontend — e por isso a edge não tinha como recusar um valor de
// tamanho fora da lista do tipo da org. Este arquivo guarda apenas o que é de UI.
import {
  TAMANHOS_ROUPA, NUMERACOES_CALCADO,
} from '../../supabase/functions/_shared/produto/tipos-produto-valores';

export { TAMANHOS_ROUPA, NUMERACOES_CALCADO };

export interface GrupoTamanho { grupo: string; valores: readonly string[] }

/** Grupos oferecidos ao operador, conforme os tipos habilitados na org.
 *  Lista vazia = nenhum grupo = o campo Tamanho não é renderizado (INV-1). */
export function opcoesDeTamanho(tipos: readonly string[]): GrupoTamanho[] {
  const grupos: GrupoTamanho[] = [];
  if (tipos.includes('roupa')) grupos.push({ grupo: 'Tamanho', valores: TAMANHOS_ROUPA });
  if (tipos.includes('calcado')) grupos.push({ grupo: 'Numeração', valores: NUMERACOES_CALCADO });
  return grupos;
}

/** Teto de linhas geradas de uma vez. `proximo_codigo_produto` reserva `variacoes.length + 1`
 *  códigos de oito dígitos (D-5 do ADR-0094) e o cartesiano estoura rápido; além disso o ML tem
 *  limite de variações por anúncio. Falha LOUD e acionável em vez de truncar em silêncio ou
 *  deixar o operador descobrir na edge. */
export const LIMITE_VARIACOES_GERADAS = 60;

export interface Combinacao { cor: string; tamanho: string | null }

function limparLista(valores: string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const bruto of valores) {
    const v = bruto.trim();
    if (!v || vistos.has(v)) continue;
    vistos.add(v);
    saida.push(v);
  }
  return saida;
}

/** Produto cartesiano cor × tamanho. Cor é o eixo externo para as linhas saírem agrupadas por
 *  cor na tabela — é como o operador confere a foto, que é por cor. */
export function gerarCombinacoes(cores: string[], tamanhos: string[]): Combinacao[] {
  const c = limparLista(cores);
  const t = limparLista(tamanhos);
  const total = Math.max(c.length, 1) * Math.max(t.length, 1);
  if (c.length === 0 && t.length === 0) return [];
  if (total > LIMITE_VARIACOES_GERADAS) {
    throw new Error(
      `Essa combinação geraria ${total} variações, acima do limite de ${LIMITE_VARIACOES_GERADAS} `
      + 'por cadastro. Cadastre em dois produtos ou reduza as cores/tamanhos.',
    );
  }
  if (t.length === 0) return c.map((cor) => ({ cor, tamanho: null }));
  if (c.length === 0) return t.map((tamanho) => ({ cor: '', tamanho }));
  return c.flatMap((cor) => t.map((tamanho) => ({ cor, tamanho })));
}
