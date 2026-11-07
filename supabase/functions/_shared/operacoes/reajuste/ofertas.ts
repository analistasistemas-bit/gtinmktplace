// ADR-0196 — ofertas vigentes de um anúncio, unidas entre as fontes (ML ao vivo e banco). Na dúvida, o maior preço:
// baixar o base até a oferta a remove, e restaurar o base não a traz de volta.
import { centavos, reais } from './alvo.ts';
import type { OfertaVigente } from './tipos.ts';

export function oferta(o: Omit<OfertaVigente, 'chave'>): OfertaVigente {
  return { ...o, chave: o.offer_id ?? `${o.promocao_id}:${o.inicio ?? o.status}` };
}

const vence = (nova: OfertaVigente, atual: OfertaVigente) =>
  atual.preco !== null && (nova.preco === null || centavos(nova.preco) > centavos(atual.preco));

/** null se alguma fonte é inconclusiva. Mesma chave: o maior preço; preço nulo vence. */
export function unirOfertas(fontes: (OfertaVigente[] | null)[]): OfertaVigente[] | null {
  const porChave = new Map<string, OfertaVigente>();
  for (const fonte of fontes) {
    if (fonte === null) return null;
    for (const o of fonte) {
      const atual = porChave.get(o.chave);
      if (!atual || vence(o, atual)) porChave.set(o.chave, o);
    }
  }
  return [...porChave.values()];
}

/** null se alguma oferta não tem preço (ou a lista é vazia: quem chama distingue pelo tamanho). */
export function maiorOferta(ofertas: OfertaVigente[]): number | null {
  if (!ofertas.length || ofertas.some((o) => o.preco === null)) return null;
  return reais(Math.max(...ofertas.map((o) => centavos(o.preco!))));
}
