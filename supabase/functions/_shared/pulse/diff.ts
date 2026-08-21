import type { AlertaNovo, DiffOfertas, OfertaAnterior, OfertaColetada } from './tipos.ts';
import { qualificarOferta } from '../concorrencia/qualificacao.ts';

export interface OfertaQualificavelDiff extends OfertaColetada {
  transactions_total: number | null;
  visitas_30d: number | null;
  nivel: string | null;
}

/** Entrada de alertas: a persistência continua usando todas as ofertas, mas o diff decisório só
 * recebe as relevantes. `full` ainda não é coletado no snapshot Pulse e não altera a regra. */
export function entradaDiffRelevante<T extends OfertaQualificavelDiff>(ofertas: T[]): T[] {
  return ofertas.filter((oferta) => qualificarOferta({
    item_id: oferta.item_id,
    seller_id: oferta.seller_id,
    preco: oferta.preco,
    frete_gratis: oferta.frete_gratis,
    full: false,
    transactions_total: oferta.transactions_total,
    visitas_30d: oferta.visitas_30d,
    nivel: oferta.nivel,
  }).status === 'relevante');
}

// `permalink` entra na comparação de propósito: sem ele, o snapshot só-se-mudou deixaria uma
// oferta de preço estável para sempre sem link, esperando uma mudança de preço que pode não vir.
// Incluí-lo faz um backfill único (o guardado é null, o novo não é) e depois se estabiliza — se a
// ficha não expuser permalink, os dois lados ficam null e nada é regravado.
const mudou = (a: OfertaAnterior, b: OfertaColetada) =>
  a.preco !== b.preco || a.tier !== b.tier || a.frete_gratis !== b.frete_gratis
  || a.loja_oficial !== b.loja_oficial || a.permalink !== b.permalink;

/**
 * Snapshot só-se-mudou (ADR-0119 §2). `anteriores` = estado atual por item
 * (última linha por item_id). Primeiro snapshot (anteriores vazio) grava tudo
 * e NÃO alerta — evita spam no dia em que o produto entra no radar.
 */
export function diffOfertas(
  anteriores: OfertaAnterior[],
  atuais: OfertaColetada[],
  opcoes?: { primeiraColeta?: boolean },
): DiffOfertas {
  const antesPorItem = new Map(anteriores.map((o) => [o.item_id, o]));
  const primeiraColeta = opcoes?.primeiraColeta ?? anteriores.length === 0;
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
