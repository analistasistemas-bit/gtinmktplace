// Pulse (ADR-0119): coletor server-side. 6 passos — ver plano Task 3.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { ConexaoCanal } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mlGet } from '../_shared/ml/http.ts';
import { paginarTudo } from '../_shared/pagina.ts';
import { pool } from '../_shared/concorrencia/pool.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { extrairNossaOferta, ofertasNaoLidas, parseOfertasProduto, parsePriceToWin } from '../_shared/pulse/parse.ts';
import { diffOfertas } from '../_shared/pulse/diff.ts';
import { deveGravarVendedor } from '../_shared/pulse/vendedor.ts';
import type { OfertaAnterior } from '../_shared/pulse/tipos.ts';

const API = 'https://api.mercadolibre.com';
const CONCORRENCIA = 6;

export interface ResultadoColeta { produtos: number; gravadas: number; alertas: number; }

interface AnuncioPublicadoRow {
  codigo_pai: string;
  variacoes_externas: Record<string, { catalog_product_id?: string }> | null;
}

interface PulseProdutoRow {
  id: string;
  catalog_product_id: string;
  codigo_pai: string | null;
  origem: 'auto' | 'manual';
  titulo: string | null;
}

// 1) sincronizarRadar (só tier completo): espelha anuncios_externos publicados em pulse_produtos
// e arquiva os que saíram da lista de publicados.
async function sincronizarRadar(admin: SupabaseClient, orgId: string): Promise<void> {
  const publicados = await paginarTudo<AnuncioPublicadoRow>((de, ate) =>
    admin.from('anuncios_externos')
      .select('codigo_pai, variacoes_externas')
      .eq('org_id', orgId).eq('canal', 'mercado_livre').eq('status', 'publicado')
      .range(de, ate),
  );

  const codigosPaiVistos = new Set(publicados.map((a) => a.codigo_pai));
  // Dedupe por catalog_product_id (Map): duas SKUs/anúncios podem apontar pra mesma ficha de
  // catálogo. Sem isso, o upsert em lote manda o MESMO (org_id, catalog_product_id) duas vezes
  // na mesma instrução e o Postgres recusa com "cannot affect row a second time" — a sincronia
  // inteira da org falharia em silêncio (só console.warn). Último anúncio visto vence.
  const porCpid = new Map<string, { org_id: string; catalog_product_id: string; codigo_pai: string; origem: 'auto' }>();
  for (const anuncio of publicados) {
    for (const v of Object.values(anuncio.variacoes_externas ?? {})) {
      if (!v?.catalog_product_id) continue;
      porCpid.set(v.catalog_product_id, {
        org_id: orgId, catalog_product_id: v.catalog_product_id,
        codigo_pai: anuncio.codigo_pai, origem: 'auto',
      });
    }
  }
  // GTIN por ficha: cada catalog_product_id corresponde a UMA variação (uma cor), então o EAN sai
  // de `variacoes.catalog_product_id`, não do código da família — que agrupa várias fichas.
  const cpids = [...porCpid.keys()];
  const gtinPorCpid = new Map<string, string>();
  const statusPorCpid = new Map<string, string>();
  if (cpids.length > 0) {
    const { data: vars } = await admin.from('variacoes')
      .select('catalog_product_id, gtin, catalog_status')
      .eq('org_id', orgId).in('catalog_product_id', cpids);
    for (const v of (vars ?? []) as { catalog_product_id: string; gtin: string | null; catalog_status: string | null }[]) {
      if (v.gtin && !gtinPorCpid.has(v.catalog_product_id)) gtinPorCpid.set(v.catalog_product_id, v.gtin);
      // 'vinculado' vence qualquer outro status: basta UMA variação vinculada para o nosso anúncio
      // estar competindo naquela ficha (e o price-to-win existir).
      const atual = statusPorCpid.get(v.catalog_product_id);
      if (v.catalog_status && (atual == null || v.catalog_status === 'vinculado')) {
        statusPorCpid.set(v.catalog_product_id, v.catalog_status);
      }
    }
  }

  const rows = [...porCpid.values()].map((r) => ({
    ...r,
    ...(gtinPorCpid.has(r.catalog_product_id) ? { gtin: gtinPorCpid.get(r.catalog_product_id) } : {}),
    ...(statusPorCpid.has(r.catalog_product_id) ? { catalogo_status: statusPorCpid.get(r.catalog_product_id) } : {}),
  }));
  if (rows.length > 0) {
    // Sem 'status' nem 'titulo' no payload: o merge do PostgREST só sobrescreve as colunas
    // enviadas. Status preserva o ciclo de vida do operador; o título vem do ML (nome da ficha,
    // resolvido na coleta) — mandá-lo daqui apagaria o nome bom toda madrugada, porque
    // `anuncios_externos.titulo` está vazio na maioria dos anúncios.
    const { error } = await admin.from('pulse_produtos').upsert(rows, { onConflict: 'org_id,catalog_product_id' });
    if (error) console.warn('pulse-coletar: sincronizarRadar upsert falhou:', error.message);
  }

  const { data: ativosAuto } = await admin.from('pulse_produtos')
    .select('id, codigo_pai').eq('org_id', orgId).eq('origem', 'auto').neq('status', 'arquivado');
  const arquivar = (ativosAuto ?? [])
    .filter((p) => !codigosPaiVistos.has(p.codigo_pai as string))
    .map((p) => p.id as string);
  if (arquivar.length > 0) {
    await admin.from('pulse_produtos').update({ status: 'arquivado' }).in('id', arquivar);
  }
}

export async function processarColetaOrg(
  admin: SupabaseClient, conexao: ConexaoCanal, orgId: string,
  tier: 'completo' | 'quente', maxProdutos: number,
): Promise<ResultadoColeta> {
  const token = await getValidAccessTokenConexao(conexao);
  // Nossa conta no ML: a lista de ofertas do catálogo inclui o NOSSO anúncio, que não é
  // concorrente de si mesmo (valor não-numérico → NaN → nada é filtrado, comportamento seguro).
  const proprioSellerId = conexao.contaExternaId ? Number(conexao.contaExternaId) : null;

  if (tier === 'completo') await sincronizarRadar(admin, orgId);

  // 2) selecionar
  let query = admin.from('pulse_produtos')
    .select('id, catalog_product_id, codigo_pai, origem, titulo')
    .eq('org_id', orgId).eq('status', 'ativo')
    .order('ultimo_snapshot_em', { ascending: true, nullsFirst: true })
    .limit(maxProdutos);
  if (tier === 'quente') query = query.eq('origem', 'auto');
  const { data: produtosRaw } = await query;
  const produtos = (produtosRaw ?? []) as PulseProdutoRow[];

  let gravadas = 0;
  let alertasTotal = 0;
  const sellerIdsColetados = new Set<number>();

  // 3) coletar por produto — pool(6): ofertas do catálogo → diff → grava/desativa idempotente.
  await pool(CONCORRENCIA, produtos, async (produto) => {
    // limit=100 explícito (é o default do ML, mas default não é contrato).
    const json = await mlGet(`${API}/products/${produto.catalog_product_id}/items?limit=100`, token);
    // Falha de LEITURA não é "sem ofertas" (mesma trava de monitorar-moderados/catalogo.ts):
    // json===null viraria diffOfertas([...], []) e fabricaria concorrente_saiu para todo mundo.
    if (json === null) return;
    const naoLidas = ofertasNaoLidas(json);
    if (naoLidas > 0) {
      console.warn(
        `pulse-coletar: ficha ${produto.catalog_product_id} tem ${naoLidas} oferta(s) além da página lida — radar parcial`,
      );
    }
    const atuais = parseOfertasProduto(json, proprioSellerId);
    for (const o of atuais) sellerIdsColetados.add(o.seller_id);

    // View `pulse_ofertas_atual`: já é 1 linha por item (distinct on … order by dia desc). Ler o
    // histórico bruto com um teto de linhas fazia um item antigo cair fora da janela e voltar
    // como "novo concorrente" no diff — alerta falso.
    const { data: anterioresRaw } = await admin.from('pulse_ofertas_atual')
      .select('item_id, seller_id, preco, tier, frete_gratis, loja_oficial, ativo')
      .eq('produto_id', produto.id);
    const anteriores = ((anterioresRaw ?? []) as OfertaAnterior[]).map((o) => ({ ...o, preco: Number(o.preco) }));

    const diff = diffOfertas(anteriores, atuais);

    if (diff.gravar.length > 0) {
      // SEM ignoreDuplicates (desvio do plano, ver relatório): o tier quente roda a cada 6h e
      // pode achar um 2º preço no MESMO dia (unique é produto_id,item_id,dia). Com
      // ignoreDuplicates, a linha de hoje ficava travada no 1º valor visto — o próximo diff
      // comparava sempre contra esse valor velho e reemitia preco_caiu a cada execução do dia.
      // Merge (default) sobrescreve a linha de hoje com o valor atual e continua idempotente
      // numa re-execução com o mesmo payload (mesmos valores → no-op efetivo). ativo:true
      // explícito porque a linha pode ter sido desativada mais cedo no mesmo dia (oferta voltou).
      const { error } = await admin.from('pulse_ofertas').upsert(
        diff.gravar.map((o) => ({ org_id: orgId, produto_id: produto.id, ...o, ativo: true })),
        { onConflict: 'produto_id,item_id,dia' },
      );
      if (error) console.warn(`pulse-coletar: gravar ofertas do produto ${produto.id} falhou:`, error.message);
      else gravadas += diff.gravar.length;
    }
    if (diff.desativar.length > 0) {
      // Mesmo motivo do gravar acima: merge (sem ignoreDuplicates) garante que um sumiço
      // detectado numa 2ª execução do mesmo dia realmente marque ativo=false na linha de hoje.
      const { error } = await admin.from('pulse_ofertas').upsert(
        diff.desativar.map((o) => ({ org_id: orgId, produto_id: produto.id, ...o, ativo: false })),
        { onConflict: 'produto_id,item_id,dia' },
      );
      if (error) console.warn(`pulse-coletar: desativar ofertas do produto ${produto.id} falhou:`, error.message);
    }
    if (diff.alertas.length > 0) {
      const { error } = await admin.from('pulse_alertas').insert(
        diff.alertas.map((a) => ({ org_id: orgId, produto_id: produto.id, tipo: a.tipo, payload: a.payload })),
      );
      if (!error) alertasTotal += diff.alertas.length;
      else console.warn(`pulse-coletar: alertas do produto ${produto.id} falharam:`, error.message);
    }
    // Nome da ficha: uma vez por produto, direto do ML. `anuncios_externos.titulo` está vazio na
    // maioria dos anúncios, e sem nome a lista mostra só o id da ficha ("MLB18407878"), que não
    // diz nada ao operador. Falha aqui não é fatal — tenta de novo no próximo ciclo.
    // Preço VIVO do nosso anúncio, da mesma resposta das concorrentes (Errata 4 do ADR-0119).
    // Escrito sempre — inclusive como null: se o anúncio saiu da ficha (pausado, sem estoque,
    // vínculo perdido), manter o último preço conhecido faria a tela afirmar uma posição de
    // mercado que não existe mais. Só chegamos aqui com a leitura da ficha bem-sucedida.
    const nossa = extrairNossaOferta(json, proprioSellerId);
    const agora = new Date().toISOString();
    const patch: Record<string, string | number | null> = {
      ultimo_snapshot_em: agora,
      meu_item_id: nossa?.item_id ?? null,
      meu_preco: nossa?.preco ?? null,
      // Carimba a LEITURA, não o achado. Só assim `meu_preco = null` distingue "olhamos a ficha e
      // não estamos nela" de "ainda não olhamos desde a atualização" — e a tela não afirma
      // "pausado ou sem estoque" sobre produto que a coleta nem chegou a alcançar (o teto de
      // produtos por execução deixa uma sobra para o ciclo seguinte).
      meu_preco_em: agora,
    };
    if (!produto.titulo) {
      const ficha = await mlGet(`${API}/products/${produto.catalog_product_id}`, token);
      const nome = (ficha as { name?: string } | null)?.name;
      if (typeof nome === 'string' && nome.trim()) patch.titulo = nome.trim();
    }
    await admin.from('pulse_produtos').update(patch).eq('id', produto.id);
  });

  // 4) vendedores (só tier completo): 1 snapshot por seller_id, só se transactions_total mudou.
  if (tier === 'completo') {
    await pool(CONCORRENCIA, [...sellerIdsColetados], async (sellerId) => {
      const { data: ultima } = await admin.from('pulse_vendedores')
        .select('dia, transactions_total')
        .eq('org_id', orgId).eq('seller_id', sellerId)
        .order('dia', { ascending: false }).limit(1).maybeSingle();
      const hojeSP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      if (ultima?.dia === hojeSP) return; // já processado hoje (re-execução no mesmo dia)

      const json = await mlGet(`${API}/users/${sellerId}`, token);
      const u = json as {
        nickname?: string; power_seller_status?: string | null; level_id?: string | null;
        seller_reputation?: { transactions?: { total?: number } };
      } | null;
      if (!u) return;
      const total = typeof u.seller_reputation?.transactions?.total === 'number' ? u.seller_reputation.transactions.total : null;
      const anterior = ultima ? { transactions_total: ultima.transactions_total as number | null } : null;
      if (!deveGravarVendedor(anterior, total)) return;

      const { error } = await admin.from('pulse_vendedores').upsert(
        {
          org_id: orgId, seller_id: sellerId, nickname: u.nickname ?? null,
          power_seller: u.power_seller_status ?? null, nivel: u.level_id ?? null, transactions_total: total,
        },
        { onConflict: 'org_id,seller_id,dia', ignoreDuplicates: true },
      );
      if (error) console.warn(`pulse-coletar: vendedor ${sellerId} falhou:`, error.message);
    });
  }

  // 5) price-to-win (só tier completo, só produtos origem='auto'): não sobrescreve com null.
  if (tier === 'completo') {
    const produtosAuto = produtos.filter((p) => p.origem === 'auto' && p.codigo_pai);
    await pool(CONCORRENCIA, produtosAuto, async (produto) => {
      const { data: anuncio } = await admin.from('anuncios_externos')
        .select('item_externo_id')
        .eq('org_id', orgId).eq('codigo_pai', produto.codigo_pai!).eq('canal', 'mercado_livre')
        .not('item_externo_id', 'is', null)
        .order('particao', { ascending: true }).limit(1).maybeSingle();
      const itemId = anuncio?.item_externo_id as string | undefined;
      if (!itemId) return;

      const json = await mlGet(`${API}/suggestions/items/${itemId}/details`, token);
      const ptw = parsePriceToWin(json);
      if (!ptw) return;
      await admin.from('pulse_produtos').update({
        ptw_status: ptw.status, ptw_preco_sugerido: ptw.preco_sugerido, ptw_custos: ptw.custos,
        ptw_atualizado_em: new Date().toISOString(),
      }).eq('id', produto.id);
    });
  }

  // 6) alertas: 1 notificação agregada por org por execução.
  if (alertasTotal > 0) {
    await notificarCategoria(admin, orgId, 'pulse', `Pulse: ${alertasTotal} alerta(s) de mercado — abra o menu Pulse para agir.`);
  }

  return { produtos: produtos.length, gravadas, alertas: alertasTotal };
}
