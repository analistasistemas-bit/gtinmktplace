// ADR-0104 — adoção de uma família que o Mercado Livre migrou para User Products SOZINHO.
//
// O ML migra categorias para UP de forma automática e gradual: uma família publicada como Legacy
// (`variations[]` povoado) vira item PLANO (`variations: []` + family_name/family_id na raiz), com
// as demais cores vivendo como ITENS IRMÃOS sob o mesmo family_id. Localmente não existe nenhuma
// linha em `anuncios_externos_itens` (a família nasceu Legacy), então o roteamento UP do UPDATE
// não a enxerga e o conector falha alto (MIGRADO_PARA_UP).
//
// Este módulo faz a ponte: descobre os irmãos por SKU, valida, e devolve o conjunto pronto para
// ser gravado. SÓ LEITURA REMOTA — nenhum POST/PUT no ML. A adoção não muda o anúncio; ela ensina
// o banco local a enxergar o que o ML já fez. A reposição de estoque acontece depois, pelo
// caminho normal da saga UP.
//
// Distinto do reconciliador de BACKFILL (reconciliar-backfill.ts): aquele é administrativo, varre
// a org com `listarFamiliasSemFilho()`, adota UM filho por família e grava `skus_esperados` de um
// elemento. Este roda INLINE no worker, para UMA família, com N SKUs (ADR-0104 §5).

import type { BuscaSku } from '../ml/buscar-item.ts';

/** Estado remoto de um item irmão candidato (GET /items/{id}). */
export interface IrmaoRemoto {
  familyId: string | null;
  familyName: string | null;
  userProductId: string | null;
  permalink: string | null;
  /** status cru do ML ('active' | 'paused' | 'closed' | ...). */
  status: string | null;
  sellerId: string | null;
  /** true = tem variations reais → Legacy, não é irmão UP válido. */
  temVariacoes: boolean;
}

export interface FilhoAdotado {
  sku: string;
  itemExternoId: string;
  familyId: string;
  userProductId: string;
  permalink: string | null;
  status: 'ativo' | 'pausado';
}

export interface PortasAdocao {
  /** Busca por seller_custom_field (GET /users/{seller}/items/search?sku=). */
  buscarPorSku(sku: string): Promise<BuscaSku>;
  /** GET /items/{id} completo. `null` quando o GET falha. */
  confirmar(itemExternoId: string): Promise<IrmaoRemoto | null>;
  /** Grava raiz (partição 0 + skus_esperados) + N filhos + ml_variation_id=null + ml_item_id
   *  re-apontado, TUDO numa transação (RPC). Só é chamada com o conjunto completo. */
  adotar(dados: { filhos: FilhoAdotado[]; familyId: string; familyName: string; mlItemId: string }): Promise<void>;
}

export interface EntradaAdocao {
  /** Todos os SKUs da família (variações incluídas). A adoção é tudo-ou-nada sobre este conjunto. */
  skus: string[];
  /** seller_id da conexão da org — um irmão de outro vendedor nunca é adotado. */
  sellerEsperado: string;
  /** `familias.ml_item_id` atual, para a regra determinística de re-apontamento. */
  mlItemIdAtual: string;
  /** family_name observado no GET ao vivo do item migrado. */
  familyNameObservado: string;
}

export type ResultadoAdocao =
  | { tipo: 'adotada'; filhos: FilhoAdotado[]; familyId: string }
  | { tipo: 'incompleta'; mensagem: string };

/** Status remoto → status do filho. Nunca default silencioso: qualquer outro valor (closed,
 *  under_review, ou algo futuro do ML) aborta a adoção — mesma regra do reconciliar-backfill. */
function mapearStatus(bruto: string | null): 'ativo' | 'pausado' | null {
  return bruto === 'active' ? 'ativo' : bruto === 'paused' ? 'pausado' : null;
}

export async function adotarFamiliaMigrada(
  portas: PortasAdocao,
  entrada: EntradaAdocao,
): Promise<ResultadoAdocao> {
  const { skus, sellerEsperado, mlItemIdAtual, familyNameObservado } = entrada;

  const filhos: FilhoAdotado[] = [];
  const naoEncontrados: string[] = [];
  const ambiguos: string[] = [];
  const rejeitados: string[] = [];
  const familyIds = new Set<string>();

  for (const sku of skus) {
    const busca = await portas.buscarPorSku(sku);
    if (busca.tipo === 'nenhum') { naoEncontrados.push(sku); continue; }
    // 'ambiguo' (>1 match) e 'truncado' (não cobrimos toda a paginação) nunca viram adoção:
    // escolher um seria adivinhar qual item recebe o estoque da cor.
    if (busca.tipo !== 'um') { ambiguos.push(sku); continue; }

    const item = await portas.confirmar(busca.itemExternoId);
    // Fail-closed em cada validação — as mesmas do reconciliar-backfill, pelas mesmas razões:
    // GET falhou; Legacy (tem variations); não é UP genuíno (sem family_id/user_product_id);
    // item de outro vendedor; status remoto desconhecido.
    if (
      !item || item.temVariacoes || !item.familyId || !item.userProductId
      || item.sellerId == null || item.sellerId !== sellerEsperado
    ) {
      rejeitados.push(sku);
      continue;
    }
    const status = mapearStatus(item.status);
    if (!status) { rejeitados.push(sku); continue; }

    familyIds.add(item.familyId);
    filhos.push({
      sku,
      itemExternoId: busca.itemExternoId,
      familyId: item.familyId,
      userProductId: item.userProductId,
      permalink: item.permalink,
      status,
    });
  }

  // Tudo-ou-nada: qualquer SKU que não resolveu para exatamente um irmão válido aborta a adoção
  // INTEIRA. Adotar parcialmente gravaria `skus_esperados` menor que a realidade — a agregação do
  // ADR-0088 daria `ativo` sobre um conjunto incompleto e a família viraria `publicado` com cores
  // fora do controle do PubliAI. É a classe de falso-sucesso que a igualdade de conjunto combate.
  if (filhos.length !== skus.length) {
    const partes = [
      `Migração para User Products detectada no Mercado Livre (family_name "${familyNameObservado}")`,
      `, mas só ${filhos.length} de ${skus.length} cores foram localizadas de forma inequívoca.`,
    ];
    if (naoEncontrados.length) partes.push(` Não encontradas: ${naoEncontrados.join(', ')}.`);
    if (ambiguos.length) partes.push(` Busca ambígua: ${ambiguos.join(', ')}.`);
    if (rejeitados.length) partes.push(` Recusadas na validação: ${rejeitados.join(', ')}.`);
    partes.push(' Nada foi alterado no anúncio. Confira as cores no painel do Mercado Livre.');
    return { tipo: 'incompleta', mensagem: partes.join('') };
  }

  // Um único family_id em todo o conjunto — mesma exigência da saga de criação (ADR-0088 passo 7).
  // Irmãos em family_ids diferentes não formam um produto; ativar/atualizar seria publicar num
  // grupo quebrado.
  if (familyIds.size !== 1) {
    return {
      tipo: 'incompleta',
      mensagem: `Migração para User Products detectada, mas as ${filhos.length} cores estão em `
        + `${familyIds.size} family_id diferentes (${[...familyIds].join(', ')}) — não formam um `
        + 'único produto. Nada foi alterado no anúncio. Confira no painel do Mercado Livre.',
    };
  }
  const [familyId] = [...familyIds];

  // ADR-0104 §3 — regra determinística de re-apontamento do `familias.ml_item_id`: o filho cujo
  // item_externo_id É o ml_item_id atual (a migração normalmente preserva o item original como um
  // dos irmãos); senão o filho do menor SKU. O ADR-0088 §5 define esse campo como "o primeiro item
  // técnico da partição 0" e enumera os consumidores de frontend que o leem como "o anúncio da
  // família" — deixá-lo apontando para um item dissolvido pela migração quebraria todos em silêncio.
  const sobrevivente = filhos.find((f) => f.itemExternoId === mlItemIdAtual);
  const mlItemId = sobrevivente
    ? sobrevivente.itemExternoId
    : [...filhos].sort((a, b) => a.sku.localeCompare(b.sku))[0].itemExternoId;

  await portas.adotar({ filhos, familyId, familyName: familyNameObservado, mlItemId });

  return { tipo: 'adotada', filhos, familyId };
}
