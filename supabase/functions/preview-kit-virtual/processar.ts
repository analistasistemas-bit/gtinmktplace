// ADR-0154 (Kit Virtual). Preview do diálogo de criação: título por template, margem/rateio via
// `_shared/kit-virtual/margem.ts` (Decisões 6/7/15) e descrição por IA só sob pedido (Decisão 4).
// Módulo puro (sem fetch, sem Supabase, sem `jsr:`) para ser testável no vitest sem HTTP;
// `index.ts` injeta ML + banco + IA via `PreviewKitDeps` — mesmo padrão de
// buscar-componentes-kit-virtual/processar.ts.
import { round2 } from '../_shared/dinheiro.ts';
import { calcularMargemKit, type ComponenteKit, type ResultadoMargemKit } from '../_shared/kit-virtual/margem.ts';
import type { Comissao } from '../_shared/preco/sugerir.ts';

export interface ComponenteEntrada {
  ordem: number;
  userProductId: string;
  quantidade: number;
  precoAtualML: number;
  /** `variacoes.custo` — pode faltar para item fora do catálogo local (Decisão 6). */
  custo: number | null;
  origem: 'nacional' | 'importado' | null;
  titulo: string;
  /** ADR-0151/D-9: não-null quando este componente é ele mesmo um kit vinculado. */
  kitMultiplicador: number | null;
}

export interface PreviewKitInput {
  componentes: ComponenteEntrada[];
  /** `automatic_price.discount` do ML: decimal 0..1 — vem PRONTO do operador, nunca reescalado
   * (armadilha real: `configuracoes.desconto_concorrencia_pct` e afins estão em 0..100; este
   * campo não tem relação nenhuma com aquela escala). */
  descontoPct: number;
  /** Categoria ML do componente principal (`ordem===0`) — é dela que sai a comissão (Decisão 15:
   * qual categoria tarifa o kit é uma das três incógnitas que só a 1ª venda real resolve; a v1
   * assume a do principal). */
  categoriaMlIdPrincipal: string;
  /** Decisão 4: descrição por IA só quando o request pedir — nunca no caminho quente de
   * recalcular desconto. */
  gerarDescricao: boolean;
  /** Frete grátis absorvido pelo vendedor (R$). Sem dado de pacote de kit ainda, default 0. */
  frete?: number;
}

export interface PreviewKitDeps {
  /** Tarifa da categoria do principal, no preço estimado do kit (`gold_special`/Clássico —
   * mesmo modo usado pelo grosso da precificação do app, ver `PRECO_REF_COMISSAO` em
   * `process-familia/index.ts`). `null` = ML não devolveu comissão utilizável. */
  buscarComissao: (categoriaMlId: string, precoKitEstimado: number) => Promise<Comissao | null>;
  /** Alíquotas confirmadas da org (ADR-0055/0086). `null` = não confirmadas — vira `faltando`. */
  lerAliquotasOrg: () => Promise<{ nacional: number; importado: number } | null>;
  /** Só chamada quando `gerarDescricao` é true. */
  gerarDescricaoKit?: (componentes: ComponenteEntrada[], tituloKit: string) => Promise<string>;
}

export interface PreviewKitResultado {
  titulo: string;
  descontoPct: number;
  descricao: string | null;
  descricaoGeradaPorIA: boolean;
  /** Decisão 9: cadeia de estoque de três níveis (base → kit vinculado → kit virtual). */
  avisoKitVinculado: boolean;
  /** Decisão 15: sempre true — rótulo obrigatório até a 1ª venda real reconciliar o `sale_fee`. */
  margemEstimativa: true;
  margem: ResultadoMargemKit;
}

/**
 * Teto do template de título (Decisão 4) = o teto real do ML (`TITULO_MAX = 60`,
 * `_shared/ai/titulo-montar.ts`).
 *
 * Era 40, reservando 1/3 para a expansão que o exemplo da doc oficial sugere (ela troca
 * *"1 Motosserra"* por *"1 Motosserra Elétrica 2200w 16 Pol"*). **Medido no kit real
 * `MLB5194783047` em 2026-09-06: essa expansão não acontece** — o ML devolveu `title` idêntico ao
 * `family_name` enviado, só capitalizado. A folga não protegia de nada e custava caro: o anúncio
 * publicado saiu como *"Kit 2 Itens: 1 Gel De Sobrancelhas - Me"*, cortado no meio de "Melu".
 */
export const LIMITE_TITULO_KIT = 60;

/**
 * Template determinístico, sem IA (Decisão 4): `Kit N itens: <título A> + <título B>`.
 * Trunca na última palavra inteira que cabe — cortar no meio de uma palavra vai direto para o
 * anúncio, já que o ML não reescreve o que recebe.
 */
export function gerarTituloKit(componentes: Pick<ComponenteEntrada, 'ordem' | 'titulo' | 'quantidade'>[]): string {
  const ordenados = [...componentes].sort((a, b) => a.ordem - b.ordem);
  const titulo = `Kit ${ordenados.length} itens: ${ordenados.map((c) => `${c.quantidade} ${c.titulo}`).join(' + ')}`;
  if (titulo.length <= LIMITE_TITULO_KIT) return titulo;
  const corte = titulo.slice(0, LIMITE_TITULO_KIT);
  const ultimoEspaco = corte.lastIndexOf(' ');
  // Só recua até o espaço se isso não jogar fora metade do título (palavra gigante no fim).
  const base = ultimoEspaco > LIMITE_TITULO_KIT * 0.6 ? corte.slice(0, ultimoEspaco) : corte;
  return base.replace(/[\s\-+]+$/, '');
}

function paraComponenteKit(c: ComponenteEntrada): ComponenteKit {
  return { ordem: c.ordem, precoAtualML: c.precoAtualML, quantidade: c.quantidade, custo: c.custo, origem: c.origem };
}

export async function montarPreviewKit(deps: PreviewKitDeps, input: PreviewKitInput): Promise<PreviewKitResultado> {
  const titulo = gerarTituloKit(input.componentes);
  const avisoKitVinculado = input.componentes.some((c) => c.kitMultiplicador != null);
  const frete = input.frete ?? 0;

  // Mesma fórmula de `calcularMargemKit` (soma × (1 − desconto)) — precisa existir ANTES da
  // chamada de tarifa, porque a comissão do ML varia com o preço. `calcularMargemKit` recalcula
  // o mesmo valor internamente; duplicar a fórmula aqui é mais barato que separar precoKit dela.
  const soma = input.componentes.reduce((t, c) => t + c.precoAtualML * c.quantidade, 0);
  const precoKitEstimado = round2(soma * (1 - input.descontoPct));

  const [comissao, aliquotas] = await Promise.all([
    deps.buscarComissao(input.categoriaMlIdPrincipal, precoKitEstimado),
    deps.lerAliquotasOrg(),
  ]);

  const margem = calcularMargemKit({
    componentes: input.componentes.map(paraComponenteKit),
    descontoPct: input.descontoPct,
    comissao,
    frete,
    aliquotas,
  });

  let descricao: string | null = null;
  if (input.gerarDescricao) {
    if (!deps.gerarDescricaoKit) throw new Error('gerar_descricao=true exige gerarDescricaoKit injetado');
    descricao = await deps.gerarDescricaoKit(input.componentes, titulo);
  }

  return {
    titulo,
    descontoPct: input.descontoPct,
    descricao,
    descricaoGeradaPorIA: input.gerarDescricao,
    avisoKitVinculado,
    margemEstimativa: true,
    margem,
  };
}
