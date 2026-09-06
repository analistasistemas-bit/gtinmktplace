import { round2 } from '../dinheiro.ts';
import { liquidoClassico } from '../preco/liquido.ts';
import type { Comissao } from '../preco/sugerir.ts';

/**
 * Margem estimada de um Kit Virtual do Mercado Livre (ADR-0154, Decisões 6 e 7).
 *
 * Módulo puro e isomórfico (Deno + `src/`): sem I/O, sem Supabase, sem fetch.
 *
 * Decisão 6: o resultado é uma união discriminada. Faltando custo, origem, alíquota confirmada da
 * org ou comissão, devolve `{ok:false, faltando:[...]}` — a tela diz "margem indisponível: falta
 * custo em X" e libera o botão. NUNCA devolve 0, NaN ou "—" disfarçado de resultado (ADR-0107).
 * Margem negativa é resultado válido (`ok:true`) e não bloqueia publicação.
 *
 * Decisão 7: a alíquota de cada componente (ADR-0055) incide sobre a PARCELA dele no rateio, nunca
 * a do principal sobre o kit inteiro.
 *
 * Decisão 15: tudo aqui é estimativa até a primeira venda real reconciliar o `sale_fee`.
 */

export interface ComponenteKit {
  ordem: number;
  /** Preço de venda atual do componente no ML (R$). */
  precoAtualML: number;
  /** 1..10, conforme o ML. */
  quantidade: number;
  /** `variacoes.custo` em R$ — pode faltar para item fora do app. */
  custo: number | null;
  origem: 'nacional' | 'importado' | null;
}

export interface EntradaMargemKit {
  componentes: ComponenteKit[];
  /** `automatic_price.discount` do ML: decimal 0..1 (0.30 = 30% off), igual em todos os componentes. */
  descontoPct: number;
  comissao: Comissao | null;
  /** Frete grátis que o vendedor absorve (R$, 0 se o comprador paga). */
  frete: number;
  /** Alíquotas confirmadas da org em % (ADR-0055). `null` = não confirmadas. */
  aliquotas: { nacional: number; importado: number } | null;
}

export interface RateioComponente {
  ordem: number;
  /** Parcela de UMA unidade do componente no preço do kit (`unit_amount` do ML). */
  unitAmount: number;
  /** `unitAmount × quantidade` (`total_amount` do ML). */
  totalAmount: number;
  /** Imposto do componente: `totalAmount × alíquota da origem dele`. */
  imposto: number;
}

export type CampoFaltante = 'custo' | 'origem' | 'aliquotas' | 'comissao';

export type ResultadoMargemKit =
  | {
    ok: true;
    precoKit: number;
    rateio: RateioComponente[];
    custoTotal: number;
    impostoTotal: number;
    /** Recebido após comissão, frete e imposto — ANTES do custo do produto. */
    liquido: number;
    /** `(liquido − custoTotal) / precoKit × 100`. Pode ser negativa. */
    margemPct: number;
  }
  | { ok: false; faltando: { ordem: number; campo: CampoFaltante }[] };

/** `ordem` sentinela dos campos que não pertencem a um componente (comissão, alíquotas da org). */
const ORDEM_ORG = -1;

/**
 * Arredondamento: `round2` (centavos) de `_shared/dinheiro.ts`, a fonte única de arredondamento
 * monetário do backend. NÃO usa `arredondar5Proximo` — o passo de R$ 0,05 existe para preço que o
 * app publica; aqui quem calcula o preço do kit é o próprio ML, e o exemplo oficial do rateio
 * (114 ÷ 250 = 0,456) é em centavos.
 *
 * A cadeia arredonda em cada degrau — `unitAmount`, depois `totalAmount = unit × qtd`, depois o
 * imposto de cada parcela, depois a soma — para que as colunas do preview multipliquem e somem
 * exatamente como estão na tela. Consequência aceita: `Σ totalAmount` pode diferir de `precoKit`
 * por alguns centavos, do mesmo jeito que o rateio real do ML (Decisão 15: é estimativa).
 */
export function calcularMargemKit(entrada: EntradaMargemKit): ResultadoMargemKit {
  const componentes = [...entrada.componentes].sort((a, b) => a.ordem - b.ordem);

  const faltando: { ordem: number; campo: CampoFaltante }[] = [];
  for (const c of componentes) {
    if (c.custo == null) faltando.push({ ordem: c.ordem, campo: 'custo' });
    if (c.origem == null) faltando.push({ ordem: c.ordem, campo: 'origem' });
  }
  const { comissao, aliquotas } = entrada;
  if (comissao == null) faltando.push({ ordem: ORDEM_ORG, campo: 'comissao' });
  if (aliquotas == null) faltando.push({ ordem: ORDEM_ORG, campo: 'aliquotas' });
  // Os dois testes de nulo repetidos aqui são o que estreita os tipos daqui para baixo.
  if (faltando.length || comissao == null || aliquotas == null) return { ok: false, faltando };

  const soma = componentes.reduce((t, c) => t + c.precoAtualML * c.quantidade, 0);
  const precoKit = round2(soma * (1 - entrada.descontoPct));
  // ponytail: precondição estrutural — o ML só aceita kit de 2..6 componentes publicados, com preço
  // > 0 e desconto < 1. Preço zerado só surge de entrada inválida, e devolver 0/NaN como "margem"
  // é exatamente o que a Decisão 6 proíbe; quem chama valida a composição antes.
  if (!(precoKit > 0)) {
    throw new RangeError('calcularMargemKit: preço do kit precisa ser > 0 (componentes vazios ou desconto de 100%)');
  }

  const fator = precoKit / soma;
  const { nacional, importado } = aliquotas;

  const rateio = componentes.map((c): RateioComponente => {
    const unitAmount = round2(c.precoAtualML * fator);
    const totalAmount = round2(unitAmount * c.quantidade);
    const aliquotaPct = c.origem === 'importado' ? importado : nacional;
    return { ordem: c.ordem, unitAmount, totalAmount, imposto: round2(totalAmount * aliquotaPct / 100) };
  });

  const impostoTotal = round2(rateio.reduce((t, r) => t + r.imposto, 0));
  const custoTotal = round2(componentes.reduce((t, c) => t + (c.custo as number) * c.quantidade, 0));
  // Imposto entra por fora (aliquotaPct = 0): a Decisão 7 proíbe uma alíquota única sobre o kit.
  const liquido = round2(liquidoClassico(precoKit, comissao, entrada.frete, 0) - impostoTotal);
  const margemPct = ((liquido - custoTotal) / precoKit) * 100;

  return { ok: true, precoKit, rateio, custoTotal, impostoTotal, liquido, margemPct };
}
