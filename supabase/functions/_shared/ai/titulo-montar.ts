import { tituloCase } from './titulo-case.ts';
import { ORDEM_CORTE, ORDEM_LEITURA, type SlotTitulo, type TituloSlots } from './titulo-slots.ts';

export const TITULO_MAX = 60;

/**
 * O conjunto obrigatório de slots não cabe em 60 chars e não há corte legítimo restante.
 *
 * Falhar alto aqui é deliberado. As alternativas seriam truncar (produz título inválido) ou
 * remover um discriminador (funde dois produtos num anúncio só, e o ML derruba por duplicado) —
 * ambas silenciosas. O projeto já aplica essa regra a dado de negócio: nunca defaultar em
 * silêncio.
 *
 * ATENÇÃO ao capturar: gerarCopy é a única etapa de IA sem fallback resiliente (ADR-0030), então
 * este erro derruba a família. Cada call site DEVE traduzi-lo em mensagem acionável nomeando os
 * slots que não couberam — família morta com stack opaco trocaria um defeito silencioso por outro.
 */
export class TituloInviavelError extends Error {
  constructor(
    readonly slotsObrigatorios: Partial<TituloSlots>,
    readonly comprimento: number,
  ) {
    // comprimento === 0 é o caso IMPORTANT-2: `produto` (o único slot que o contrato promete
    // nunca vazio) chegou aqui zerado — RUIDO, ADJETIVOS_VAZIOS ou removerMarketingNaoAncorado
    // consumiram tudo (ex.: a IA devolveu só "Premium", banido em termos absolutos). Mensagem
    // distinta porque "excede 60 caracteres: 0" seria falsa e confusa.
    super(comprimento === 0
      ? 'Título ficou vazio: produto foi zerado pelos guards (adjetivo vazio/marketing/ruído sem outro dado)'
      : `Título obrigatório excede ${TITULO_MAX} caracteres: ${comprimento}`);
    this.name = 'TituloInviavelError';
  }
}

/**
 * Mensagem acionável para o operador. Fica aqui, e não duplicada nos call sites, porque é a
 * única parte testável do tratamento — as pastas de edge function não têm suíte.
 */
export function mensagemTituloInviavel(e: TituloInviavelError): string {
  if (e.comprimento === 0) {
    return 'Título ficou vazio depois da limpeza de adjetivo vazio/marketing (o campo NOME provavelmente só tinha marketing sem dado de produto). Revise o NOME na planilha.';
  }
  const campos = Object.entries(e.slotsObrigatorios).map(([k, v]) => `${k}="${v}"`).join(', ');
  return `Título obrigatório não cabe em 60 caracteres (${e.comprimento}). Encurte o nome do produto na planilha. Campos: ${campos}`;
}

export interface ContextoCorte {
  /**
   * `variacao` identifica unicamente esta família perante as irmãs. Hoje isso vale quando
   * nCores === 1 (a planilha separou as cores em PAI distintos), mas a regra é sobre a FUNÇÃO
   * do dado, não sobre o tipo — amanhã pode ser tamanho ou espessura.
   */
  variacaoDiscrimina: boolean;
}

/**
 * Reduções determinísticas, aplicadas ANTES de remover qualquer slot. Cada uma preserva a
 * identidade da informação e só encurta a forma — ao contrário da remoção, que a elimina.
 */
const REDUCOES: Partial<Record<SlotTitulo, (v: string) => string>> = {
  // "100% Poliéster" → "Poliéster": mantém o material, larga o percentual.
  material: (v) => v.replace(/^\d+%\s*/, ''),
  // "Número 6" → "N.6"
  modelo: (v) => v.replace(/^N[úu]mero\s+/i, 'N.'),
  // "10 Unidades" → "10un" (rede: normalizarSlots já canoniza, isto pega o que escapou)
  quantidade: (v) => v.replace(/^(\d+)\s*unidades?$/i, '$1un').replace(/^(\d+)\s*pe[çc]as?$/i, '$1pc'),
};

function slotsIncortaveis(ctx: ContextoCorte): Set<SlotTitulo> {
  // `produto` é a identidade e `medida` distingue SKUs (10m ≠ 100m; 1kg ≠ 500g) — é a razão de
  // existir do garantirMetragemTitulo, cujo histórico registra a IA descartando a metragem sob
  // o teto de 60. `variacao` entra só quando discrimina.
  const base: SlotTitulo[] = ['produto', 'medida'];
  if (ctx.variacaoDiscrimina) base.push('variacao');
  return new Set(base);
}

function render(slots: TituloSlots, presentes: Set<SlotTitulo>): string {
  const partes: string[] = [];
  for (const slot of ORDEM_LEITURA) {
    const valor = slots[slot]?.trim();
    if (!valor || !presentes.has(slot)) continue;
    partes.push(tituloCase(valor, partes.length === 0));
  }
  return partes.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Monta o título final a partir dos slots. É o ÚNICO ponto onde slots viram string, e roda
 * depois de todos os guards — se algum guard injetasse dado depois daqui, injeção e corte
 * voltariam a disputar a mesma ponta do texto, que é o bug que este desenho elimina.
 *
 * Estratégia: renderiza; se estourar, aplica reduções; se ainda estourar, remove slots na ordem
 * de corte, pulando os incortáveis; esgotado tudo, lança TituloInviavelError.
 */
export interface TituloMontado {
  titulo: string;
  /** Slots que sobreviveram ao corte — a lista que o diagnóstico compara (ADR-0116). */
  presentes: SlotTitulo[];
}

/** `montarTitulo` sem perder a informação de QUAIS slots entraram no texto final. */
export function montarTitulo(slots: TituloSlots, ctx: ContextoCorte): string {
  return montarTituloDetalhado(slots, ctx).titulo;
}

export function montarTituloDetalhado(slots: TituloSlots, ctx: ContextoCorte): TituloMontado {
  // IMPORTANT-2: `produto` é o único slot que o contrato promete nunca vazio (titulo-slots.ts).
  // Se chegou aqui zerado, o título inteiro é inviável — devolver '' terminaria em
  // `title: ''` no publish (_shared/ml/publicar.ts:207) e um 400 do ML longe da causa real.
  // produto é protegido de remoção (slotsIncortaveis) e sempre entra em `presentes` quando
  // não-vazio, então esta checagem é necessária E suficiente: nenhum outro caminho zera o
  // render final sem também zerar `produto`.
  if (!slots.produto?.trim()) throw new TituloInviavelError({}, 0);

  const protegidos = slotsIncortaveis(ctx);
  let atual: TituloSlots = { ...slots };
  const presentes = new Set<SlotTitulo>(ORDEM_LEITURA.filter((s) => slots[s]?.trim()));

  const saida = (): TituloMontado => ({ titulo: render(atual, presentes), presentes: [...presentes] });

  if (render(atual, presentes).length <= TITULO_MAX) return saida();

  // 1. Reduções — preservam a informação, só encurtam a forma.
  for (const [slot, reduzir] of Object.entries(REDUCOES) as Array<[SlotTitulo, (v: string) => string]>) {
    if (!presentes.has(slot)) continue;
    const novo = reduzir(atual[slot]);
    if (!novo.trim()) continue; // redução que zera o slot é pior que não reduzir: o dado sumiria sem remoção e sem erro
    atual = { ...atual, [slot]: novo };
    if (render(atual, presentes).length <= TITULO_MAX) return saida();
  }

  // 2. Remoção de slots inteiros, do menos prioritário ao mais. Nunca corta token.
  for (const slot of ORDEM_CORTE) {
    if (protegidos.has(slot) || !presentes.has(slot)) continue;
    presentes.delete(slot);
    if (render(atual, presentes).length <= TITULO_MAX) return saida();
  }

  // 3. Só restaram incortáveis e ainda não cabe.
  const obrigatorios: Partial<TituloSlots> = {};
  for (const slot of protegidos) if (atual[slot]?.trim()) obrigatorios[slot] = atual[slot];
  throw new TituloInviavelError(obrigatorios, render(atual, presentes).length);
}
