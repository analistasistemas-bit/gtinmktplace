// ADR-0166: FONTE ÚNICA dos valores canônicos de tipo de produto e de tamanho/numeração.
//
// ATENÇÃO: este arquivo só pode importar outros módulos FOLHA relativos (sem nenhum import
// próprio, como `../ml/medidas-valores.ts`) — nunca `jsr:`/`npm:`, nem `import type`. Ele é
// importado tanto pelo Deno (edges) quanto pelo Vite (`src/lib/tipos-produto.ts`,
// `src/lib/tamanhos.ts`), e o Vite não resolve especificador `jsr:`. Mesmo contrato de
// `_shared/platform-admin/sales-costs.ts`, que `src/lib/custos.ts` já importa.
//
// Antes desta consolidação a whitelist estava redigitada em três arquivos e as listas de
// tamanho só existiam no frontend — o que deixava a edge sem como validar o valor recebido.
import { COMPRIMENTO_PE_CM } from '../ml/medidas-valores.ts';

export type TipoProduto = 'roupa' | 'calcado';

/** Ordem canônica: toda saída saneada respeita esta ordem, não a do payload. */
export const TIPOS_PRODUTO_VALIDOS = ['roupa', 'calcado'] as const;

/** Conjunto fechado decidido no grilling de 2026-09-18. "Tamanho Único" saiu em 2026-09-19:
 *  o Spike 051 §12 confirmou, com 3 chamadas reais, que o ML não tem guia de tamanhos para esse
 *  valor nos domínios de vestuário suportados — publicar com ele falha sempre. Sair daqui é sair
 *  da whitelist que a edge `cadastrar-produto` valida, não só da tela. */
export const TAMANHOS_ROUPA = ['P', 'M', 'G', 'GG'] as const;

/** Numeração adulta brasileira + os pares de meio-número que o ML usa. A seção 10 do spike 051
 *  confirma a lista contra a categoria real; ajustar é editar UMA linha, aqui.
 *
 *  Achado real (§13, 2026-09-19): os pares ("33/34" etc.) e as numerações femininas 45/46 são
 *  válidos para CADASTRO (o operador pode escolher), mas não têm guia de tamanhos possível no ML
 *  hoje — `_shared/ml/size-chart.ts` (`COMPRIMENTO_PE_CM`) cobre só números isolados, 33-48
 *  masculino/unissex e 33-44 feminino (dado real do chart STANDARD do próprio ML). Uma família
 *  nesses valores cadastra normal e falha alto só na hora de publicar, com mensagem explicando o
 *  motivo real — não é bug, é limite confirmado do catálogo. */
export const NUMERACOES_CALCADO = [
  '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46',
  '33/34', '35/36', '37/38', '39/40', '41/42', '43/44', '45/46',
] as const;

/** Todos os valores de tamanho aceitáveis para uma org, dados os tipos habilitados.
 *  Org sem tipo → lista vazia → nenhum tamanho é aceitável (INV-1). */
export function tamanhosValidosParaTipos(tipos: readonly string[]): string[] {
  const valores: string[] = [];
  if (tipos.includes('roupa')) valores.push(...TAMANHOS_ROUPA);
  if (tipos.includes('calcado')) valores.push(...NUMERACOES_CALCADO);
  return valores;
}

export function tamanhosDoTipo(tipo: TipoProduto): readonly string[] {
  return tipo === 'roupa' ? TAMANHOS_ROUPA : NUMERACOES_CALCADO;
}

/** Tipo de uma grade JÁ PUBLICADA, inferido dos tamanhos dela (as listas são disjuntas).
 *  `null` se vazio, misto ou com valor desconhecido — quem chama recusa, nunca adivinha. */
export function tipoDaGrade(tamanhos: readonly string[]): TipoProduto | null {
  if (tamanhos.length === 0) return null;
  for (const tipo of TIPOS_PRODUTO_VALIDOS) {
    const lista = tamanhosDoTipo(tipo);
    if (tamanhos.every((t) => lista.includes(t))) return tipo;
  }
  return null;
}

/** FONTE ÚNICA da regra "é grade" (Codex r4 #1): só as variações INCLUÍDAS contam — uma excluída
 *  não publica e não pode decidir o que o anúncio é. Todas sem tamanho → `simples`; todas com →
 *  `grade`; mistura → `mista` (estado que nenhum fluxo deveria produzir; quem chama recusa). */
export function classificarFamilia(
  vivas: Array<{ tamanho: string | null; excluida_da_publicacao: boolean }>,
): 'simples' | 'grade' | 'mista' {
  const incluidas = vivas.filter((v) => !v.excluida_da_publicacao);
  const comTamanho = incluidas.filter((v) => v.tamanho?.trim()).length;
  if (comTamanho === 0) return 'simples';
  return comTamanho === incluidas.length ? 'grade' : 'mista';
}

/** `false` = a numeração cadastra normal, mas hoje NÃO tem guia de tamanhos possível no ML para
 *  esse gênero (pares de meio-número; 45/46 no feminino). Valor fora de `NUMERACOES_CALCADO`
 *  (tamanho de roupa) não é assunto desta função e devolve `true`.
 *
 *  Unissex reaproveita a tabela masculina (Spike 051 §13 — o ML não publica STANDARD "Sem
 *  gênero"), exatamente como `tabelaComprimentoPe` faz em `_shared/ml/size-chart.ts`.
 *  O front (`src/lib/tamanhos.ts`) delega para cá e acrescenta só o caso "gênero ainda vazio". */
export function numeracaoPublicavel(
  numeracao: string,
  genero: 'masculino' | 'feminino' | 'unissex',
): boolean {
  if (!(NUMERACOES_CALCADO as readonly string[]).includes(numeracao)) return true;
  const tabela = genero === 'feminino' ? COMPRIMENTO_PE_CM.feminino : COMPRIMENTO_PE_CM.masculino;
  return numeracao in tabela;
}
