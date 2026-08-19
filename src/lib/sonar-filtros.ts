// Filtros client-side da tabela do Sonar (ADR-0125/D13/D14): os anúncios já estão em memória
// (react-query), então filtrar é um `filter` puro ANTES do DataTable ordenar — zero chamada nova.
import type { ItemVendasSonar, VisitasAnuncio } from './sonar';

// --- v2 (ADR-0127): filtros sobre a unidade ANÚNCIO. maxVendedores morreu com as fichas. -------

export interface FiltrosAnuncios {
  minVendas: number | null;
  minVisitas: number | null;
  precoMin: number | null;
  precoMax: number | null;
  minNota: number | null;
  soFull: boolean;
  soComDesconto: boolean;
  esconderPatrocinados: boolean;
  esconderLojaOficial: boolean;
}

export const FILTROS_ANUNCIOS_VAZIOS: FiltrosAnuncios = {
  minVendas: null, minVisitas: null, precoMin: null, precoMax: null, minNota: null,
  soFull: false, soComDesconto: false, esconderPatrocinados: false, esconderLojaOficial: false,
};

export function temFiltroAnunciosAtivo(f: FiltrosAnuncios): boolean {
  return (
    f.minVendas != null || f.minVisitas != null || f.precoMin != null || f.precoMax != null
    || f.minNota != null || f.soFull || f.soComDesconto || f.esconderPatrocinados || f.esconderLojaOficial
  );
}

/**
 * Mesmas regras D14 do antigo, sobre o anúncio: filtro numérico ativo com campo null EXCLUI e
 * conta em excluidasSemDado. Visitas: total 0 é ZERO MEDIDO e compara normal (D8); item fora do
 * mapa ou com null (falha) é "sem dado". Toggles não contam em excluidasSemDado.
 */
export function aplicarFiltrosAnuncios(
  itens: ItemVendasSonar[],
  visitasPorItem: Map<string, VisitasAnuncio | null>,
  filtros: FiltrosAnuncios,
): { visiveis: ItemVendasSonar[]; excluidasSemDado: number } {
  let excluidasSemDado = 0;

  const visiveis = itens.filter((i) => {
    if (filtros.minVendas != null) {
      if (i.vendidos == null) { excluidasSemDado++; return false; }
      if (i.vendidos < filtros.minVendas) return false;
    }
    if (filtros.minVisitas != null) {
      const v = i.item_id != null ? visitasPorItem.get(i.item_id) ?? null : null;
      if (v == null) { excluidasSemDado++; return false; }
      if (v.total < filtros.minVisitas) return false;
    }
    if (filtros.precoMin != null || filtros.precoMax != null) {
      if (i.preco == null) { excluidasSemDado++; return false; }
      if (filtros.precoMin != null && i.preco < filtros.precoMin) return false;
      if (filtros.precoMax != null && i.preco > filtros.precoMax) return false;
    }
    if (filtros.minNota != null) {
      if (i.avaliacao_nota == null) { excluidasSemDado++; return false; }
      if (i.avaliacao_nota < filtros.minNota) return false;
    }
    if (filtros.soFull && i.full !== true) return false;
    if (filtros.soComDesconto && i.desconto_pct == null) return false;
    if (filtros.esconderPatrocinados && i.patrocinado === true) return false;
    if (filtros.esconderLojaOficial && i.loja_oficial === true) return false;
    return true;
  });

  return { visiveis, excluidasSemDado };
}
