// Pulse (ADR-0119): coletor server-side. 6 passos — ver plano Task 3.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { ConexaoCanal } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mlGet } from '../_shared/ml/http.ts';
import { paginarTudo } from '../_shared/pagina.ts';
import { pool } from '../_shared/concorrencia/pool.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import {
  extrairNossaOferta, ofertasNaoLidas, parseComissao, parseOfertasProduto, parsePriceToWin,
  parseStatusAnuncios, type AnuncioMultiget,
} from '../_shared/pulse/parse.ts';
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
  const comCpidNoJson = new Set(
    publicados
      .filter((a) => Object.values(a.variacoes_externas ?? {}).some((v) => v?.catalog_product_id))
      .map((a) => a.codigo_pai),
  );
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
  // Resgate dos órfãos: anúncio publicado cujo JSON `variacoes_externas` não guardou nenhum
  // `catalog_product_id` ficava INTEIRO fora do radar, mesmo com o vínculo confirmado em
  // `variacoes` (medido: o MLB4982690837 da DSA, `catalog_status='vinculado'`, nunca entrou).
  // O JSON é o espelho da publicação e nem sempre foi preenchido; `variacoes` é onde o vínculo
  // vive de fato. Só os órfãos são consultados — varrer todos os códigos publicados traria
  // fichas de famílias antigas (medido: 434 contra 217 na Avil).
  const orfaos = [...codigosPaiVistos].filter((c) => !comCpidNoJson.has(c));
  if (orfaos.length > 0) {
    const familias = await paginarTudo<{ id: string; codigo_pai: string; criado_em: string }>((de, ate) =>
      admin.from('familias')
        .select('id, codigo_pai, criado_em')
        .in('codigo_pai', orfaos)
        .order('criado_em', { ascending: false })
        .range(de, ate),
    );
    // Família mais recente por código — o PostgREST não tem `distinct on`, e o histórico de
    // re-ingest deixa várias famílias com o mesmo `codigo_pai`.
    const familiaPorCodigo = new Map<string, string>();
    for (const f of familias) if (!familiaPorCodigo.has(f.codigo_pai)) familiaPorCodigo.set(f.codigo_pai, f.id);

    const familiaIds = [...familiaPorCodigo.values()];
    if (familiaIds.length > 0) {
      const codigoPorFamilia = new Map([...familiaPorCodigo].map(([c, id]) => [id, c]));
      const vars = await paginarTudo<{ familia_id: string; catalog_product_id: string | null; catalog_status: string | null }>((de, ate) =>
        admin.from('variacoes')
          .select('familia_id, catalog_product_id, catalog_status')
          .eq('org_id', orgId)
          .in('familia_id', familiaIds)
          .not('catalog_product_id', 'is', null)
          .range(de, ate),
      );
      for (const v of vars) {
        // Só vínculo confirmado: uma ficha que o anúncio não disputa não é produto do radar.
        if (v.catalog_status !== 'vinculado' || !v.catalog_product_id) continue;
        const codigo = codigoPorFamilia.get(v.familia_id);
        if (!codigo || porCpid.has(v.catalog_product_id)) continue;
        porCpid.set(v.catalog_product_id, {
          org_id: orgId, catalog_product_id: v.catalog_product_id, codigo_pai: codigo, origem: 'auto',
        });
      }
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

  // Paginado: o PostgREST trunca em ~1000 linhas sem avisar, e aqui o truncamento é silencioso na
  // pior direção — produto além do teto nunca entraria na lista de candidatos e ficaria no radar
  // para sempre, mesmo depois de o anúncio sair do ar. O Pulse v2 (extensão) existe justamente
  // para multiplicar a contagem de linhas.
  const ativosAuto = await paginarTudo<{ id: string; codigo_pai: string | null }>((de, ate) =>
    admin.from('pulse_produtos')
      .select('id, codigo_pai').eq('org_id', orgId).eq('origem', 'auto').neq('status', 'arquivado')
      .order('id', { ascending: true }).range(de, ate)
  );
  const arquivar = ativosAuto
    .filter((p) => !codigosPaiVistos.has(p.codigo_pai as string))
    .map((p) => p.id);
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
  // Preço EFETIVO da nossa oferta, por item, colhido no passo 3 desta mesma execução. O passo 5b
  // consulta a comissão e só pode confiar no `price` do multiget de `/items` quando não tem isto:
  // aquele campo é o preço BASE, sem promoção (Errata 4), e a faixa da comissão muda com o preço
  // (Errata 7). Chaveado pelo item_id da NOSSA oferta justamente para não casar o preço de um
  // anúncio com a categoria de outro no caso de anúncio publicado por faixa.
  const precoEfetivoPorItem = new Map<string, number>();

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
      // `permalink` entra aqui porque `mudou()` o compara: sem lê-lo, o guardado chegaria sempre
      // como undefined e toda oferta pareceria mudada em toda execução.
      .select('item_id, seller_id, preco, tier, frete_gratis, loja_oficial, ativo, permalink')
      .eq('produto_id', produto.id);
    const anteriores = ((anterioresRaw ?? []) as OfertaAnterior[]).map((o) => ({ ...o, preco: Number(o.preco) }));

    const diff = diffOfertas(anteriores, atuais);

    // Alerta só sai se o estado novo entrou no banco. Os dois upserts abaixo e o insert de alertas
    // não são atômicos: com a gravação falhando, `pulse_ofertas_atual` não avança, o próximo ciclo
    // recomputa o MESMO diff e reemite os mesmos alertas — e o insert de alertas não tem chave de
    // idempotência para segurar isso. Perder um alerta que será recalculado no ciclo seguinte é
    // melhor do que repetir o mesmo alerta a cada 6h até o banco voltar.
    let estadoGravado = true;
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
      if (error) {
        console.warn(`pulse-coletar: gravar ofertas do produto ${produto.id} falhou:`, error.message);
        estadoGravado = false;
      } else gravadas += diff.gravar.length;
    }
    if (diff.desativar.length > 0) {
      // Mesmo motivo do gravar acima: merge (sem ignoreDuplicates) garante que um sumiço
      // detectado numa 2ª execução do mesmo dia realmente marque ativo=false na linha de hoje.
      const { error } = await admin.from('pulse_ofertas').upsert(
        diff.desativar.map((o) => ({ org_id: orgId, produto_id: produto.id, ...o, ativo: false })),
        { onConflict: 'produto_id,item_id,dia' },
      );
      if (error) {
        console.warn(`pulse-coletar: desativar ofertas do produto ${produto.id} falhou:`, error.message);
        estadoGravado = false;
      }
    }
    if (diff.alertas.length > 0 && !estadoGravado) {
      console.warn(
        `pulse-coletar: ${diff.alertas.length} alerta(s) do produto ${produto.id} adiados — ofertas não gravadas`,
      );
    }
    if (diff.alertas.length > 0 && estadoGravado) {
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
    if (nossa) precoEfetivoPorItem.set(nossa.item_id, nossa.preco);
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
        // `status='publicado'` igual ao passo 5b: sem ele um anúncio com status 'erro' de partição
        // menor era eleito e a referência de preço vinha de um item morto.
        .eq('org_id', orgId).eq('codigo_pai', produto.codigo_pai!).eq('canal', 'mercado_livre')
        .eq('status', 'publicado')
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

  // 5b) situação do NOSSO anúncio no ML (só tier completo). Passo próprio e em lote — 20 ids por
  // chamada, ~8 requisições para 150 anúncios contra uma por produto se ficasse no loop acima. E
  // fora do teto de tempo daquele loop: o produto que ficou para o ciclo seguinte também precisa
  // da situação, senão a tela fica sem saber justamente dos atrasados.
  // O id vem de `anuncios_externos`, não de `meu_item_id`: anúncio pausado some da ficha de
  // catálogo, então `meu_item_id` é null exatamente quando a situação mais importa.
  if (tier === 'completo') {
    const comCodigo = produtos.filter((p) => p.codigo_pai);
    const codigos = [...new Set(comCodigo.map((p) => p.codigo_pai!))];
    if (codigos.length > 0) {
      const anuncios = await paginarTudo<{ codigo_pai: string; item_externo_id: string | null }>((de, ate) =>
        admin.from('anuncios_externos')
          .select('codigo_pai, item_externo_id')
          .eq('org_id', orgId).eq('canal', 'mercado_livre').eq('status', 'publicado')
          .in('codigo_pai', codigos)
          .not('item_externo_id', 'is', null)
          .order('particao', { ascending: true })
          .range(de, ate),
      );
      const itemPorCodigo = new Map<string, string>();
      for (const a of anuncios) {
        if (a.item_externo_id && !itemPorCodigo.has(a.codigo_pai)) itemPorCodigo.set(a.codigo_pai, a.item_externo_id);
      }

      const ids = [...new Set(itemPorCodigo.values())];
      const infoPorItem = new Map<string, AnuncioMultiget>();
      for (let i = 0; i < ids.length; i += 20) {
        const lote = ids.slice(i, i + 20);
        const json = await mlGet(
          `${API}/items?ids=${lote.join(',')}&attributes=id,status,sub_status,category_id,listing_type_id,price`,
          token,
        );
        for (const st of parseStatusAnuncios(json)) infoPorItem.set(st.item_id, st);
      }

      // Comissão do ML na FAIXA do preço EFETIVO (Erratas 6 e 7). `listing_prices` não tem
      // multiget, mas é uma chamada por anúncio, no mesmo passo em lote e fora do teto de tempo do
      // loop de ofertas. Sem categoria/tipo/preço não há o que consultar — e comissão não se estima.
      //
      // O preço da consulta vem do passo 3 (nossa oferta na ficha, já com promoção aplicada) e só
      // cai no `price` do multiget quando aquele item não foi visto na coleta desta execução — o
      // campo do multiget é o preço BASE e erra a faixa em anúncio promovido (Errata 4). Nos dois
      // casos gravamos em `comissao_preco` o preço realmente usado, para a tela saber se o número
      // é exato para o preço exibido ou uma estimativa.
      const comissaoPorItem = new Map<string, { pct: number; fixa: number; preco: number }>();
      await pool(CONCORRENCIA, [...infoPorItem.values()], async (info) => {
        if (!info.category_id || !info.listing_type_id) return;
        const preco = precoEfetivoPorItem.get(info.item_id) ?? info.price;
        if (preco == null) return;
        const json = await mlGet(
          `${API}/sites/MLB/listing_prices?price=${preco}&category_id=${info.category_id}&listing_type_id=${info.listing_type_id}`,
          token,
        );
        const c = parseComissao(json);
        if (c) comissaoPorItem.set(info.item_id, { ...c, preco });
      });

      const agora = new Date().toISOString();
      await pool(CONCORRENCIA, comCodigo, async (produto) => {
        const itemId = itemPorCodigo.get(produto.codigo_pai!);
        const st = itemId ? infoPorItem.get(itemId) : undefined;
        // Leitura que falhou não vira "situação desconhecida": preserva a última conhecida em vez
        // de apagá-la, do mesmo jeito que o price-to-win não sobrescreve com null.
        if (!st) return;
        const com = itemId ? comissaoPorItem.get(itemId) : undefined;
        await admin.from('pulse_produtos').update({
          anuncio_status: st.status, anuncio_sub_status: st.sub_status, anuncio_status_em: agora,
          ...(com
            ? { comissao_pct: com.pct, comissao_fixa: com.fixa, comissao_preco: com.preco, comissao_em: agora }
            : {}),
        }).eq('id', produto.id);
      });
    }
  }

  // 6) alertas: 1 notificação agregada por org por execução.
  if (alertasTotal > 0) {
    // A mensagem traz os NOVOS desta execução e o total ainda não lido. Sem o segundo número, a
    // conta nunca fecha com o painel: cada execução avisa o que ela achou, enquanto a tela mostra
    // o acumulado pendente. Três execuções de 5, 3 e 1 viram "9 alertas novos" no app.
    const { count } = await admin.from('pulse_alertas')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('lido', false);
    const pendentes = count ?? 0;
    const sufixo = pendentes > alertasTotal ? ` (${pendentes} aguardando no total)` : '';
    await notificarCategoria(
      admin, orgId, 'pulse',
      `Pulse: ${alertasTotal} alerta(s) novo(s) de mercado${sufixo} — abra o menu Pulse para agir.`,
    );
  }

  return { produtos: produtos.length, gravadas, alertas: alertasTotal };
}
