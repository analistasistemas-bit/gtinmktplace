// Proveniência de número financeiro (ADR-0148 D-3, implementa a D-28 da ADR-0141).
//
// Os helpers de dinheiro do ML convertem falha em `0`, o que torna "o comprador paga" (resposta
// legítima) indistinguível de "o ML caiu" (ausência). A DRE precisa recusar o cálculo na ausência
// em vez de exibir lucro inflado, então cada helper ganha uma variante que devolve o valor
// acompanhado de onde ele veio. Função pura, sem I/O.
//
// O tipo espelha `Proveniencia` de `src/lib/calculadora-ml.ts:15`, que já existia no frontend.

export type Proveniencia = 'official' | 'partial' | 'estimated';

export interface ValorComProveniencia<T> {
  valor: T;
  proveniencia: Proveniencia;
  /** Por que não é `official`. Vai para a tela na recusa da DRE (ADR-0148 D-4). */
  motivo?: string;
}

/** Do melhor para o pior. A pior proveniência de um conjunto governa o conjunto. */
const ORDEM: Record<Proveniencia, number> = { official: 0, partial: 1, estimated: 2 };

/**
 * Combina proveniências: o conjunto vale o pior dos seus componentes, e carrega o motivo desse
 * pior. Comissão oficial com frete estimado é um número estimado — não um número oficial.
 */
export function piorProveniencia(
  ...partes: Array<Pick<ValorComProveniencia<unknown>, 'proveniencia' | 'motivo'>>
): { proveniencia: Proveniencia; motivo?: string } {
  let pior = partes[0] ?? { proveniencia: 'official' as Proveniencia };
  for (const parte of partes) {
    if (ORDEM[parte.proveniencia] > ORDEM[pior.proveniencia]) pior = parte;
  }
  return { proveniencia: pior.proveniencia, ...(pior.motivo ? { motivo: pior.motivo } : {}) };
}

/** Só `official` habilita a DRE (ADR-0148 D-3). */
export function podeCalcularDre(p: Proveniencia): boolean {
  return p === 'official';
}
