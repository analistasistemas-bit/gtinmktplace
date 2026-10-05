// ADR-0174, emenda 2026-10-05 — par normal/catálogo do mesmo User Product vira uma linha: a do catálogo (o ML
// só aceita a promoção por ele), com a cara do normal. Os dois lados avaliam o mesmo predicado → simétrico
// mesmo com o par em lotes/mensagens diferentes.
import { ehParticipando } from './projecao.ts';
import type { ItemML, ItemPromocaoML } from './tipos.ts';

export type PapelNoPar = { papel: 'normal_escondido' } | { papel: 'catalogo'; normal: ItemML } | { papel: 'solto' };
const SOLTO: PapelNoPar = { papel: 'solto' };

// ponytail: só o par 1↔1 (cada lado aponta só para o outro); relação múltipla fica como está, sem esconder nada.
const parUP = (n: ItemML, c: ItemML) => !n.catalogo && c.catalogo
  && n.relacionados.length === 1 && n.relacionados[0] === c.id
  && c.relacionados.length === 1 && c.relacionados[0] === n.id;

/** Normal já participando (inscrição antiga via API, invisível no Seller Center) continua visível para poder sair. */
export function papelNoPar(id: string, ml: Map<string, ItemML>, campanha: Map<string, ItemPromocaoML>): PapelNoPar {
  const eu = ml.get(id);
  const outro = eu?.relacionados.length === 1 ? ml.get(eu.relacionados[0]) : undefined;
  if (!eu || !outro || !campanha.has(outro.id)) return SOLTO;
  const [n, c] = eu.catalogo ? [outro, eu] : [eu, outro];
  if (!parUP(n, c) || ehParticipando(campanha.get(n.id)!.status)) return SOLTO;
  return eu.catalogo ? { papel: 'catalogo', normal: n } : { papel: 'normal_escondido' };
}

/** Relacionados que estão na campanha mas fora do multiget do lote (o par caiu em outro lote). */
export function relacionadosFaltando(ids: string[], ml: Map<string, ItemML>, campanha: Map<string, ItemPromocaoML>): string[] {
  const rel = ids.flatMap((id) => ml.get(id)?.relacionados ?? []);
  return [...new Set(rel)].filter((id) => campanha.has(id) && !ml.has(id));
}
