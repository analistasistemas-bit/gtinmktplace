import type { AlertaNovo, DiffOfertas, OfertaAnterior, OfertaColetada } from './tipos.ts';

const mudou = (a: OfertaAnterior, b: OfertaColetada) =>
  a.preco !== b.preco || a.tier !== b.tier || a.frete_gratis !== b.frete_gratis || a.loja_oficial !== b.loja_oficial;

/**
 * Snapshot só-se-mudou (ADR-0119 §2). `anteriores` = estado atual por item
 * (última linha por item_id). Primeiro snapshot (anteriores vazio) grava tudo
 * e NÃO alerta — evita spam no dia em que o produto entra no radar.
 */
export function diffOfertas(anteriores: OfertaAnterior[], atuais: OfertaColetada[]): DiffOfertas {
  const antesPorItem = new Map(anteriores.map((o) => [o.item_id, o]));
  const primeiraColeta = anteriores.length === 0;
  const gravar: OfertaColetada[] = [];
  const alertas: AlertaNovo[] = [];

  for (const atual of atuais) {
    const antes = antesPorItem.get(atual.item_id);
    if (!antes) {
      gravar.push(atual);
      if (!primeiraColeta) {
        alertas.push({ tipo: 'novo_concorrente', payload: { item_id: atual.item_id, seller_id: atual.seller_id, preco: atual.preco } });
      }
      continue;
    }
    if (antes.ativo && mudou(antes, atual)) gravar.push(atual);
    if (!antes.ativo) gravar.push(atual); // oferta voltou
  }

  // Queda do MENOR preço do produto (é o que muda decisão de repricing).
  const minAntes = Math.min(...anteriores.filter((o) => o.ativo).map((o) => o.preco));
  const minAtual = Math.min(...atuais.map((o) => o.preco));
  if (!primeiraColeta && Number.isFinite(minAntes) && Number.isFinite(minAtual) && minAtual < minAntes) {
    alertas.push({ tipo: 'preco_caiu', payload: { de: minAntes, para: minAtual } });
  }

  const itensAtuais = new Set(atuais.map((o) => o.item_id));
  const desativar = anteriores.filter((o) => o.ativo && !itensAtuais.has(o.item_id));
  const sellersAtuais = new Set(atuais.map((o) => o.seller_id));
  for (const d of desativar) {
    if (!sellersAtuais.has(d.seller_id)) {
      alertas.push({ tipo: 'concorrente_saiu', payload: { item_id: d.item_id, seller_id: d.seller_id } });
    }
  }
  return { gravar, desativar, alertas };
}
