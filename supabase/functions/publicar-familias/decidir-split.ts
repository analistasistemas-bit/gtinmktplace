// Roteamento publish/update × split (ADR-0048 + ADR-0078 F2). Puro e idempotente.
import { MAX_VARIACOES_ML } from '../_shared/split/particionar.ts';

export function decidirSplit(p: {
  qtdCores: number;
  precosCentavos: Array<number | null>;
  qtdParticoes: number;
}): boolean {
  if (p.qtdCores > MAX_VARIACOES_ML) return true; // ADR-0048 (comportamento atual)
  if (p.qtdParticoes > 1) return true; // já dividido: só o split worker conhece as N partições
  const distintos = new Set(p.precosCentavos.filter((c): c is number => c != null));
  return distintos.size > 1; // ADR-0078 F2: divergência de preço
}
