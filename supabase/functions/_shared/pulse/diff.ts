import type { AlertaNovo, DiffOfertas, OfertaAnterior, OfertaColetada } from './tipos.ts';
import { qualificarOferta } from '../concorrencia/qualificacao.ts';

export interface OpcoesDiff {
  primeiraColeta?: boolean;
  /** Preço da NOSSA oferta no mesmo snapshot das concorrentes (ADR-0133 D-3). `null` = não
   *  vendemos o item; sem preço nosso não há decisão de preço, então tudo vira `info`. */
  meuPreco?: number | null;
  /** Apelido por seller_id, para congelar o nome no payload e não depender de join no render. */
  nicknames?: Map<number, string | null>;
}

/** Só um preço medido abaixo do nosso ameaça a posição. `meuPreco` nulo nunca qualifica. */
const abaixoDeNos = (preco: number, meuPreco: number | null | undefined): boolean =>
  meuPreco != null && Number.isFinite(meuPreco) && preco < meuPreco;

export interface OfertaQualificavelDiff extends OfertaColetada {
  transactions_total: number | null;
  visitas_30d: number | null;
  nivel: string | null;
}

/** Entrada de alertas: a persistência continua usando todas as ofertas, mas o diff decisório só
 * recebe as relevantes. `full` não participa da regra de qualificação (spec só usa `full` para
 * estatística, não para corte). */
export function entradaDiffRelevante<T extends OfertaQualificavelDiff>(ofertas: T[]): T[] {
  return ofertas.filter((oferta) => qualificarOferta({
    item_id: oferta.item_id,
    seller_id: oferta.seller_id,
    preco: oferta.preco,
    frete_gratis: oferta.frete_gratis,
    full: oferta.full_ml,
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
  || a.full_ml !== b.full_ml || a.loja_oficial !== b.loja_oficial || a.permalink !== b.permalink;

/**
 * Snapshot só-se-mudou (ADR-0119 §2). `anteriores` = estado atual por item
 * (última linha por item_id). Primeiro snapshot (anteriores vazio) grava tudo
 * e NÃO alerta — evita spam no dia em que o produto entra no radar.
 */
export function diffOfertas(
  anteriores: OfertaAnterior[],
  atuais: OfertaColetada[],
  opcoes?: OpcoesDiff,
): DiffOfertas {
  const antesPorItem = new Map(anteriores.map((o) => [o.item_id, o]));
  const primeiraColeta = opcoes?.primeiraColeta ?? anteriores.length === 0;
  const gravar: OfertaColetada[] = [];
  const alertas: AlertaNovo[] = [];
  const meuPreco = opcoes?.meuPreco ?? null;
  const apelido = (sellerId: number) => opcoes?.nicknames?.get(sellerId) ?? null;

  for (const atual of atuais) {
    const antes = antesPorItem.get(atual.item_id);
    if (!antes) {
      gravar.push(atual);
      if (!primeiraColeta) {
        alertas.push({
          tipo: 'novo_concorrente',
          payload: {
            item_id: atual.item_id, seller_id: atual.seller_id, preco: atual.preco,
            meu_preco: meuPreco, nickname: apelido(atual.seller_id),
          },
          severidade: abaixoDeNos(atual.preco, meuPreco) ? 'acao' : 'info',
        });
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
    alertas.push({
      tipo: 'preco_caiu',
      payload: { de: minAntes, para: minAtual, meu_preco: meuPreco },
      severidade: abaixoDeNos(minAtual, meuPreco) ? 'acao' : 'info',
    });
  }

  const itensAtuais = new Set(atuais.map((o) => o.item_id));
  const desativar = anteriores.filter((o) => o.ativo && !itensAtuais.has(o.item_id));
  const sellersAtuais = new Set(atuais.map((o) => o.seller_id));
  // A decisão que este alerta habilita é SUBIR preço, e ela depende do mercado DEPOIS da saída:
  // com relevantes a 70 e 71 e nosso preço 75, a saída do de 70 não nos torna o menor. Ficha que
  // ficou sem nenhuma oferta relevante é o caso mais forte — `Math.min` de lista vazia devolve
  // Infinity, não null, então a checagem de finitude tem de vir primeiro e como aprovação.
  const ninguemAbaixoAgora = meuPreco != null && Number.isFinite(meuPreco)
    && (!Number.isFinite(minAtual) || minAtual >= meuPreco);
  for (const d of desativar) {
    if (!sellersAtuais.has(d.seller_id)) {
      alertas.push({
        tipo: 'concorrente_saiu',
        payload: {
          item_id: d.item_id, seller_id: d.seller_id, preco: d.preco,
          meu_preco: meuPreco, nickname: apelido(d.seller_id),
        },
        severidade: abaixoDeNos(d.preco, meuPreco) && ninguemAbaixoAgora ? 'acao' : 'info',
      });
    }
  }
  return { gravar, desativar, alertas };
}
