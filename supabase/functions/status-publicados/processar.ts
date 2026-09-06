// Miolo de status-publicados, com dependências injetadas — sem isso o teste não roda sem
// bater na rede real (resolverConexao/getValidAccessTokenConexao são específicos do ML e
// getConnector/lerStatus dependem do registry).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { lerPrecoKitML, lerEstoqueKitML } from '../_shared/ml/kit-virtual.ts';
import type { StatusCanal } from '../_shared/canais/contrato.ts';

export interface DepsStatusPublicados {
  admin: SupabaseClient;
  resolverConexao: typeof resolverConexao;
  getConnector: typeof getConnector;
  getValidAccessTokenConexao: typeof getValidAccessTokenConexao;
  lerPrecoKit: typeof lerPrecoKitML;
  lerEstoqueKit: typeof lerEstoqueKitML;
}

export interface ItemStatusPublicados extends Partial<StatusCanal> {
  ml_item_id: string;
  canal: string;
  /** ADR-0154 D-14: marca a linha como Kit Virtual — o frontend usa para badge e para NÃO
   *  oferecer Pausar/Reativar (fora da v1, a doc do ML não lista `status` como editável em kit). */
  kitVirtual?: true;
  kitId?: string;
}

export interface RespostaStatusPublicados {
  itens: ItemStatusPublicados[];
  semCredencialML?: boolean;
}

/**
 * Enriquece, EM LUGAR, as linhas de kit já presentes em `itens` com preço (`/sale_price`) e
 * estoque (`/user-products/{id}/stock`) — as duas únicas fontes corretas (D-14; o `GET /items`
 * em lote que preencheu `itens` não traz preço/estoque certos para kit). Só roda para os ids
 * que são kit; anúncio comum nunca paga estas duas chamadas extras. Falha de UM kit não derruba
 * os outros nem o resto da resposta — cada kit é isolado pelo próprio Promise.all.
 */
async function enriquecerKits(
  deps: DepsStatusPublicados,
  itens: ItemStatusPublicados[],
  idsDeKit: string[],
  kitPorMlItemId: Map<string, { id: string; ml_user_product_id: string | null }>,
  token: string,
): Promise<void> {
  await Promise.all(idsDeKit.map(async (id) => {
    const kit = kitPorMlItemId.get(id);
    const item = itens.find((it) => it.ml_item_id === id && it.canal === 'mercado_livre');
    if (!kit || !item) return;
    item.kitVirtual = true;
    item.kitId = kit.id;
    const [preco, estoque] = await Promise.all([
      deps.lerPrecoKit(token, id),
      kit.ml_user_product_id ? deps.lerEstoqueKit(token, kit.ml_user_product_id) : Promise.resolve(null),
    ]);
    item.preco = preco?.preco ?? null;
    item.estoque = estoque;
  }));
}

export async function montarStatusPublicados(
  deps: DepsStatusPublicados, orgId: string,
): Promise<RespostaStatusPublicados> {
  const { admin } = deps;
  // Escopo da organização (E7): a lista de anúncios é compartilhada dentro da org
  // (RLS org_id, D-E7.3), então o status ao vivo cobre os anúncios de toda a org.
  const { data: familias } = await admin.from('familias')
    .select('ml_item_id').eq('org_id', orgId).not('ml_item_id', 'is', null);
  // Split (ADR-0048): anúncios de partições >0 vivem só em anuncios_externos; inclui seus ids
  // para o status ao vivo cobrir TODOS os anúncios do produto, não só a partição 0.
  const { data: extras } = await admin.from('anuncios_externos')
    .select('item_externo_id, canal').eq('org_id', orgId).not('item_externo_id', 'is', null);
  // ADR-0088 §2: itens filhos User Products (cores 2..N, 1 item ML por SKU) da org — sem essa
  // união, status ao vivo mostra só a 1ª cor/partição 0. Sempre canal mercado_livre (único valor
  // do enum canal_externo hoje, mesma leitura do bloco de agrupamento abaixo).
  const { data: itensUP } = await admin.from('anuncios_externos_itens')
    .select('item_externo_id').eq('org_id', orgId).not('item_externo_id', 'is', null);
  // ADR-0154 D-2/D-14: kits virtuais publicados — 4ª fonte de ids. Tabela própria (o kit não é
  // `familias` nem `anuncios_externos`, ver D-2 do ADR), só os `publicado` (erro/encerrado não
  // aparecem em Publicados).
  const { data: kits } = await admin.from('kits_virtuais')
    .select('id, ml_item_id, ml_user_product_id')
    .eq('org_id', orgId).eq('status', 'publicado').not('ml_item_id', 'is', null);

  // E6 (ADR-0061): agrupa os ids por canal — familias.ml_item_id é sempre ML (dual-write);
  // anuncios_externos carrega o canal de cada linha. Hoje só existe 'mercado_livre', então o
  // agrupamento devolve exatamente o mesmo grupo único de antes.
  const idsPorCanal = new Map<string, Set<string>>();
  const addId = (canal: string, id: string) => {
    if (!idsPorCanal.has(canal)) idsPorCanal.set(canal, new Set());
    idsPorCanal.get(canal)!.add(id);
  };
  for (const f of familias ?? []) addId('mercado_livre', f.ml_item_id as string);
  for (const e of extras ?? []) addId(e.canal, e.item_externo_id as string);
  for (const i of itensUP ?? []) addId('mercado_livre', i.item_externo_id as string);
  // Kit é sempre ML — D-2 não previu (nem existe hoje) outro canal para Kit Virtual.
  for (const k of kits ?? []) addId('mercado_livre', k.ml_item_id as string);

  const kitPorMlItemId = new Map<string, { id: string; ml_user_product_id: string | null }>();
  for (const k of kits ?? []) {
    kitPorMlItemId.set(k.ml_item_id as string, {
      id: k.id as string,
      ml_user_product_id: k.ml_user_product_id as string | null,
    });
  }

  const totalIds = [...idsPorCanal.values()].reduce((n, s) => n + s.size, 0);
  if (totalIds === 0) return { itens: [] };

  // Leitura de status em lote por canal, via conector (ADR-0024). Canal sem conexão (ou cuja
  // leitura falha — getToken sem credencial válida) fica de fora do lote; para 'mercado_livre'
  // preserva o fallback semCredencialML de antes (hoje o único canal com dados reais).
  const itens: ItemStatusPublicados[] = [];
  let semCredencialML = false;
  for (const [canal, idsSet] of idsPorCanal) {
    const ids = [...idsSet];
    const conexao = await deps.resolverConexao(admin, orgId, canal);
    if (!conexao) {
      if (canal === 'mercado_livre') semCredencialML = true;
      continue;
    }
    const conn = deps.getConnector(canal);
    const ctx = { getToken: () => deps.getValidAccessTokenConexao(conexao) };
    try {
      const statusPorId = await conn.lerStatus(ctx, ids);
      for (const id of ids) itens.push({ ml_item_id: id, canal, ...statusPorId[id] });
    } catch {
      if (canal === 'mercado_livre') semCredencialML = true;
      continue;
    }

    // D-14: as duas chamadas extras, só para os ids de kit deste canal.
    if (canal === 'mercado_livre' && kitPorMlItemId.size > 0) {
      const idsDeKit = ids.filter((id) => kitPorMlItemId.has(id));
      if (idsDeKit.length > 0) {
        try {
          const token = await ctx.getToken();
          await enriquecerKits(deps, itens, idsDeKit, kitPorMlItemId, token);
        } catch (e) {
          // Token falhou depois do lerStatus já ter passado (raro): kits ficam sem
          // preço/estoque ao vivo, mas o resto da resposta (famílias, outros anúncios) sobrevive.
          console.warn('status_publicados_enriquecer_kits_falhou', { orgId, erro: String(e) });
        }
      }
    }
  }

  if (semCredencialML && itens.length === 0) return { itens: [], semCredencialML: true };
  return { itens };
}
