import type { FamiliaParaBusca } from '../concorrencia/identificador.ts';
import type { ResultadoConcorrencia, OfertaVendedor } from '../concorrencia/tipos.ts';
import { comissaoDe } from '../ml/listing-prices.ts';
import { dimensoesValidas, type DimensoesPacote } from '../ml/pacote.ts';
import type { ListingPriceML } from '../ml/tarifa.ts';
import type { VariacaoSalvaResumo } from './variacao-salva.ts';
import type { ItemAnalise, ItemAnalisado, Mercado } from './tipos.ts';

type BuscarListingPrice = (
  token: string,
  preco: number,
  categoria: string,
  listingType: string,
) => Promise<ListingPriceML>;

type BuscarFreteVendedor = (
  token: string,
  mlUserId: string,
  preco: number,
  categoria: string,
  dimensoes?: DimensoesPacote | null,
) => Promise<number>;

export interface AnalisarItemViabilidadeDependencias {
  buscarConcorrencia: (familia: FamiliaParaBusca) => Promise<ResultadoConcorrencia>;
  buscarVariacaoSalva: (gtin: string) => Promise<VariacaoSalvaResumo>;
  obterToken: () => Promise<string | null>;
  resolverMercado: (productId: string, ofertas: OfertaVendedor[]) => Promise<Mercado>;
  buscarListingPrice: BuscarListingPrice;
  buscarFreteVendedor: BuscarFreteVendedor;
}

export interface AnalisarItemViabilidadeArgs {
  item: ItemAnalise;
  contaExternaId: string | null;
  deps: AnalisarItemViabilidadeDependencias;
}

/** Orquestra um item sem acoplar a regra de negócio ao handler Deno. */
export async function analisarItemViabilidade({
  item,
  contaExternaId,
  deps,
}: AnalisarItemViabilidadeArgs): Promise<ItemAnalisado> {
  const base: ItemAnalisado = {
    gtin: item.gtin,
    nome: item.nome,
    unidade: item.unidade,
    minimo: item.minimo,
    custo: item.custo,
    origem: item.origem,
    existeNoML: false,
  };
  try {
    const conc = await deps.buscarConcorrencia({
      nome_pai: item.nome,
      variacoes: [{ gtin: item.gtin }],
    });
    if (!conc.product_id) return base;

    const categoria = conc.ofertas?.category_id ?? null;
    const dimensoesInformadas = item.dimensoes != null && dimensoesValidas(item.dimensoes);
    const salva = await deps.buscarVariacaoSalva(item.gtin);
    const token = await deps.obterToken();
    const mercado = await deps.resolverMercado(conc.product_id, conc.ofertas?.ofertas_detalhe ?? []);
    const resultado: ItemAnalisado = {
      ...base,
      nome: item.nome && item.nome !== item.gtin ? item.nome : (conc.product_name ?? item.gtin),
      existeNoML: true,
      mercado,
      descricaoCatalogo: conc.descricao_catalogo ?? null,
      categoriaMlId: categoria,
      jaCadastrado: salva.jaCadastrado,
    };
    if (mercado.menor == null || !categoria || !token) return resultado;

    const dimensoes = dimensoesInformadas ? item.dimensoes! : salva.dimensoes;
    const mlUserId = contaExternaId || 'me';
    const [classicoML, premiumML, frete] = await Promise.all([
      deps.buscarListingPrice(token, mercado.menor, categoria, 'gold_special'),
      deps.buscarListingPrice(token, mercado.menor, categoria, 'gold_pro'),
      deps.buscarFreteVendedor(token, mlUserId, mercado.menor, categoria, dimensoes),
    ]);
    return {
      ...resultado,
      classico: { saleFeeAmount: classicoML.sale_fee_amount ?? 0, ...comissaoDe(classicoML) },
      premium: { saleFeeAmount: premiumML.sale_fee_amount ?? 0, ...comissaoDe(premiumML) },
      frete,
      dimensoesEncontradas: dimensoes != null,
    };
  } catch (e) {
    console.warn(`analisarItem ${item.gtin} falhou: ${(e as Error).message}`);
    return { ...base, erro: true };
  }
}
