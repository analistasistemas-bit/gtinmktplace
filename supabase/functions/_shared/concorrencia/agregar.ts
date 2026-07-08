import type { DadosOfertas, ResultadoConcorrencia } from './tipos.ts';
import { classificarConcorrencia } from './classificar.ts';

/** Uma cor (produto de catálogo do ML) já resolvida, pronta pra entrar na agregação da família. */
export interface ProdutoConcorrencia {
  product_id: string;
  product_name: string | null;
  ofertas: DadosOfertas;
}

/**
 * Agrega a concorrência de todas as cores (produtos de catálogo distintos) de uma família
 * num único resultado por família — lote #28: antes a busca parava no 1º GTIN que casasse
 * no catálogo e reportava o preço de UMA cor como se fosse o da família inteira.
 * `produtos` não deve vir vazio (o chamador trata a ausência de resultados antes de chamar).
 */
export function agregarConcorrencia(produtos: ProdutoConcorrencia[]): ResultadoConcorrencia {
  if (produtos.length === 0) {
    throw new Error('agregarConcorrencia: lista vazia (o chamador deve tratar antes)');
  }

  const seller_ids = [...new Set(produtos.flatMap((p) => p.ofertas.seller_ids))];

  let preco_min: number | null = null;
  let preco_max: number | null = null;
  let total_ofertas = 0;
  let frete_gratis = 0;
  let full = 0;
  let category_id: string | null = null;
  let vendedoresSoma = 0;

  // representativo = cor com o menor preco_min não-nulo; sem nenhum preço, fica o 1º da lista.
  let representativo = produtos[0];
  let menorPrecoRepresentativo = Infinity;

  for (const p of produtos) {
    const o = p.ofertas;
    if (o.preco_min != null) {
      preco_min = preco_min == null ? o.preco_min : Math.min(preco_min, o.preco_min);
      if (o.preco_min < menorPrecoRepresentativo) {
        menorPrecoRepresentativo = o.preco_min;
        representativo = p;
      }
    }
    if (o.preco_max != null) {
      preco_max = preco_max == null ? o.preco_max : Math.max(preco_max, o.preco_max);
    }
    total_ofertas += o.total_ofertas;
    frete_gratis += o.frete_gratis;
    full += o.full;
    vendedoresSoma += o.vendedores;
    if (category_id == null) category_id = o.category_id;
  }

  // Fallback: se nenhuma cor trouxe seller_ids, usa a soma de `ofertas.vendedores`. Aproximação
  // aceita — quando só ALGUMAS cores trazem seller_ids, os vendedores não-atribuídos das cores
  // sem seller_ids não entram na união (o ML quase sempre retorna seller_id; impacto é só na
  // CONTAGEM/classe, nunca no preço).
  const vendedores = seller_ids.length > 0 ? seller_ids.length : vendedoresSoma;

  const ofertas: DadosOfertas = {
    vendedores, preco_min, preco_max, total_ofertas, frete_gratis, full, seller_ids, category_id,
  };

  return {
    vendedores,
    preco_min,
    origem: 'gtin',
    classe: classificarConcorrencia(vendedores),
    product_id: representativo.product_id,
    product_name: representativo.product_name,
    ofertas,
  };
}
