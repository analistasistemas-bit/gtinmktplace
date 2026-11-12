// ADR-0200 (adendo 12/11): galeria do anúncio do kit com as fotos das peças. Puro, sem import: a edge de leitura e a
// de criação usam a mesma regra, e a tela só mostra o que o servidor propôs.

export interface FotoPeca { id: string; item: string }
/** Fotos de uma cor, na ordem do anúncio da peça no ML; a posição 0 é a capa da peça e nunca entra. */
export interface CorFotos { cor: string; fotos: FotoPeca[] }

/**
 * Anúncio da peça que serve de fonte para a cor: a variação da base com menor código que tenha item no ML. Depende só da
 * base (não do tamanho pedido), então a prévia e a criação escolhem a mesma peça e os ids batem.
 */
export function pecaDaCor(
  variacoes: Array<{ codigo: string; cor: string }>, vinculos: Array<{ sku: string; item_externo_id: string | null }>, cor: string,
): string | null {
  const codigos = variacoes.filter((v) => v.cor === cor).map((v) => v.codigo).sort();
  for (const codigo of codigos) {
    const item = vinculos.find((x) => x.sku === codigo)?.item_externo_id;
    if (item) return item;
  }
  return null;
}

/**
 * Foto k da galeria (k = 0, 1, 2…) = imagem k+2 da peça da cor `cores[k % n]` (a imagem 1 é a capa da peça). Peça sem
 * a imagem daquele slot, ou foto já usada, pula a vez; a vez das outras cores não muda. O total com a foto do kit
 * (posição 1 do anúncio) não passa de `limite`, que vem da categoria no ML: `limite` ilegível ou menor que 2 não
 * deixa espaço e devolve vazio.
 */
export function montarGaleriaKit(
  e: { fotoKit?: string | null; cores: CorFotos[]; limite: number },
): FotoPeca[] {
  const vagas = Number.isInteger(e.limite) ? e.limite - 1 : 0;
  const n = e.cores.length;
  if (vagas < 1 || n === 0) return [];
  const usadas = new Set<string>(e.fotoKit ? [e.fotoKit] : []);
  const maior = Math.max(...e.cores.map((c) => c.fotos.length));
  const galeria: FotoPeca[] = [];
  for (let k = 0; k + 1 < maior && galeria.length < vagas; k++) {
    const foto = e.cores[k % n].fotos[k + 1];
    if (!foto || usadas.has(foto.id)) continue;
    usadas.add(foto.id);
    galeria.push({ id: foto.id, item: foto.item });
  }
  return galeria;
}
