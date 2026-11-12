// ADR-0200 (adendo 12/11): galeria das peças no anúncio do kit. A proposta vem do servidor (edge `fotos-pecas-kit`); a
// tela só remove fotos ou desliga a galeria. O que sai no pedido é a lista de ids mantidos, por combinação.

export interface FotoGaleria { id: string; item: string; url: string | null; cor: string }
export interface GaleriaProposta { fotos: FotoGaleria[]; avisos: string[]; indisponivel: boolean }
/** Escolha do operador por combinação. Ausente = padrão (intercalado ligado, nada removido). */
export interface EscolhaGaleria { ligada: boolean; removidas: string[] }

/** Ids que o pedido leva: vazio quando a galeria está desligada, indisponível ou sem fotos. */
export function idsDaGaleria(proposta: GaleriaProposta | undefined, escolha: EscolhaGaleria | undefined): string[] {
  if (!proposta || proposta.indisponivel || (escolha && !escolha.ligada)) return [];
  const fora = new Set(escolha?.removidas ?? []);
  return proposta.fotos.map((f) => f.id).filter((id) => !fora.has(id));
}

/** Remove a foto, ou a restaura se já estava removida. */
export function alternarFoto(escolha: EscolhaGaleria | undefined, id: string): EscolhaGaleria {
  const atual = escolha ?? { ligada: true, removidas: [] };
  return {
    ligada: atual.ligada,
    removidas: atual.removidas.includes(id) ? atual.removidas.filter((x) => x !== id) : [...atual.removidas, id],
  };
}
