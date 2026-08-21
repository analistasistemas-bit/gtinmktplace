// Pulse (ADR-0119): coletor server-side. 6 passos — ver plano Task 3.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { ConexaoCanal } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mlGet } from '../_shared/ml/http.ts';
import { buscarPerfilVendedor } from '../_shared/ml/perfil-vendedor.ts';
import { buscarVisitas30d } from '../_shared/ml/visitas-item.ts';
import { paginarTudo } from '../_shared/pagina.ts';
import { pool } from '../_shared/concorrencia/pool.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import {
  extrairNossaOferta, ofertasNaoLidas, parseComissao, parseOfertasProduto, parsePriceToWin,
  parseStatusAnuncios, type AnuncioMultiget,
} from '../_shared/pulse/parse.ts';
import { enrichPulsePermalinks } from '../_shared/pulse/permalink.ts';
import { diffOfertas, entradaDiffRelevante, type OfertaQualificavelDiff } from '../_shared/pulse/diff.ts';
import { deveGravarVendedor } from '../_shared/pulse/vendedor.ts';
import type { OfertaAnterior, OfertaColetada } from '../_shared/pulse/tipos.ts';

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

type OfertaAnteriorComVisitas = OfertaAnterior & { visitas_30d: number | null };
interface AlertaPendente {
  produtoId: string;
  anteriores: OfertaAnteriorComVisitas[];
  atuais: OfertaColetada[];
  estadoGravado: boolean;
}
interface PerfilVendedorAtual {
  seller_id: number;
  transactions_total: number | null;
  nivel: string | null;
  dia: string;
  perfil_coletado_em: string | null;
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

const chaveOferta = (produtoId: string, itemId: string) => `${produtoId}\u0000${itemId}`;

async function perfisAtuaisParaAlertas(
  admin: SupabaseClient, orgId: string, pendentes: AlertaPendente[],
): Promise<Map<number, PerfilVendedorAtual>> {
  const ids = [...new Set(pendentes.flatMap((p) => [
    ...p.anteriores.map((o) => o.seller_id), ...p.atuais.map((o) => o.seller_id),
  ]))];
  const porVendedor = new Map<number, PerfilVendedorAtual>();
  for (let inicio = 0; inicio < ids.length; inicio += 100) {
    const lote = ids.slice(inicio, inicio + 100);
    const perfis = await paginarTudo<PerfilVendedorAtual>((de, ate) =>
      admin.from('pulse_vendedores')
        .select('seller_id, transactions_total, nivel, dia, perfil_coletado_em')
        .eq('org_id', orgId).in('seller_id', lote)
        .order('seller_id', { ascending: true })
        .order('perfil_coletado_em', { ascending: false, nullsFirst: false })
        .order('dia', { ascending: false })
        .range(de, ate)
    );
    for (const perfil of perfis) {
      const atual = porVendedor.get(perfil.seller_id);
      const leituraAtual = atual?.perfil_coletado_em ?? atual?.dia;
      const leituraNova = perfil.perfil_coletado_em ?? perfil.dia;
      if (!atual || leituraNova >= leituraAtual!) porVendedor.set(perfil.seller_id, perfil);
    }
  }
  return porVendedor;
}

async function visitasAtuaisParaAlertas(
  admin: SupabaseClient, orgId: string, pendentes: AlertaPendente[],
): Promise<Map<string, number | null>> {
  const produtoIds = [...new Set(pendentes.map((p) => p.produtoId))];
  const porOferta = new Map<string, number | null>();
  for (let inicio = 0; inicio < produtoIds.length; inicio += 50) {
    const lote = produtoIds.slice(inicio, inicio + 50);
    const linhas = await paginarTudo<{ produto_id: string; item_id: string; visitas_30d: number | null }>((de, ate) =>
      admin.from('pulse_ofertas_atual')
        .select('produto_id, item_id, visitas_30d')
        .eq('org_id', orgId).in('produto_id', lote)
        .order('produto_id', { ascending: true }).order('item_id', { ascending: true })
        .range(de, ate),
    );
    for (const linha of linhas) porOferta.set(chaveOferta(linha.produto_id, linha.item_id), linha.visitas_30d);
  }
  return porOferta;
}

function ofertaParaDiffRelevante<T extends OfertaColetada>(
  oferta: T,
  perfil: PerfilVendedorAtual | undefined,
  visitas30d: number | null,
): T & OfertaQualificavelDiff {
  return {
    ...oferta,
    transactions_total: perfil?.transactions_total ?? null,
    visitas_30d: visitas30d,
    nivel: perfil?.nivel ?? null,
  };
}

async function gravarAlertasRelevantes(
  admin: SupabaseClient, orgId: string, pendentes: AlertaPendente[],
): Promise<number> {
  if (pendentes.length === 0) return 0;
  const [perfis, visitasAtuais] = await Promise.all([
    perfisAtuaisParaAlertas(admin, orgId, pendentes),
    visitasAtuaisParaAlertas(admin, orgId, pendentes),
  ]);
  let total = 0;
  for (const pendente of pendentes) {
    const anteriores = entradaDiffRelevante(pendente.anteriores.map((oferta) =>
      ofertaParaDiffRelevante(oferta, perfis.get(oferta.seller_id), oferta.visitas_30d),
    ));
    const atuais = entradaDiffRelevante(pendente.atuais.map((oferta) =>
      ofertaParaDiffRelevante(
        oferta,
        perfis.get(oferta.seller_id),
        visitasAtuais.get(chaveOferta(pendente.produtoId, oferta.item_id)) ?? null,
      ),
    ));
    const { alertas } = diffOfertas(anteriores, atuais);
    if (alertas.length === 0) continue;
    if (!pendente.estadoGravado) {
      console.warn(
        `pulse-coletar: ${alertas.length} alerta(s) do produto ${pendente.produtoId} adiados — ofertas não gravadas`,
      );
      continue;
    }
    const { error } = await admin.from('pulse_alertas').insert(
      alertas.map((a) => ({ org_id: orgId, produto_id: pendente.produtoId, tipo: a.tipo, payload: a.payload })),
    );
    if (!error) total += alertas.length;
    else console.warn(`pulse-coletar: alertas do produto ${pendente.produtoId} falharam:`, error.message);
  }
  return total;
}

export async function processarColetaOrg(
  admin: SupabaseClient, conexao: ConexaoCanal, orgId: string,
  tier: 'completo' | 'quente', maxProdutos: number,
  // `baseline` é a varredura agendada da madrugada, e NÃO se deduz de `tier`: o botão "Atualizar
  // agora" do operador também roda em tier completo. Passos caros que medem algo de janela longa
  // (visitas 30d) só entram aqui — senão cada clique no botão dispararia a varredura inteira.
  baseline = false,
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
  const alertasPendentes: AlertaPendente[] = [];
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
    // View `pulse_ofertas_atual`: já é 1 linha por item (distinct on … order by dia desc). Ler o
    // histórico bruto com um teto de linhas fazia um item antigo cair fora da janela e voltar
    // como "novo concorrente" no diff — alerta falso.
    const { data: anterioresRaw } = await admin.from('pulse_ofertas_atual')
      // `permalink` entra aqui porque `mudou()` o compara: sem lê-lo, o guardado chegaria sempre
      // como undefined e toda oferta pareceria mudada em toda execução.
      .select('item_id, seller_id, preco, tier, frete_gratis, loja_oficial, ativo, permalink, visitas_30d')
      .eq('org_id', orgId).eq('produto_id', produto.id);
    const anteriores = ((anterioresRaw ?? []) as OfertaAnteriorComVisitas[])
      .map((o) => ({ ...o, preco: Number(o.preco) }));
    const permalinksAnteriores = new Map<string, string>();
    for (const oferta of anteriores) {
      if (typeof oferta.permalink === 'string' && /^https?:\/\//.test(oferta.permalink)) {
        permalinksAnteriores.set(oferta.item_id, oferta.permalink);
      }
    }
    const atuais = enrichPulsePermalinks(parseOfertasProduto(json, proprioSellerId), permalinksAnteriores);
    for (const o of atuais) sellerIdsColetados.add(o.seller_id);

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
    // A persistência conserva TODAS as ofertas. O diff que gera alerta só será calculado depois
    // dos perfis e das visitas desta execução, quando já há dados para qualificar cada lado.
    alertasPendentes.push({ produtoId: produto.id, anteriores, atuais, estadoGravado });
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

  // 4) vendedores (só tier completo): novo snapshot quando o perfil muda ou completa 24h.
  if (tier === 'completo') {
    await pool(CONCORRENCIA, [...sellerIdsColetados], async (sellerId) => {
      const { data: ultima } = await admin.from('pulse_vendedores')
        .select('transactions_total, uf, perfil_coletado_em')
        .eq('org_id', orgId).eq('seller_id', sellerId)
        .order('dia', { ascending: false }).limit(1).maybeSingle();
      const perfil = await buscarPerfilVendedor(token, sellerId);
      if (!perfil) return;
      const anterior = ultima
        ? {
          transactions_total: ultima.transactions_total as number | null,
          uf: ultima.uf as string | null,
          perfil_coletado_em: ultima.perfil_coletado_em as string | null,
        }
        : null;
      if (!deveGravarVendedor(anterior, perfil, Date.now())) return;

      // SEM `ignoreDuplicates`: o snapshot renovado precisa sobrescrever a linha de hoje.
      const { error } = await admin.from('pulse_vendedores').upsert(
        {
          org_id: orgId, seller_id: sellerId, nickname: perfil.nickname,
          power_seller: perfil.power_seller, nivel: perfil.nivel,
          transactions_total: perfil.transactions_total, uf: perfil.uf,
          reputacao_detalhe: perfil.detalhe, perfil_coletado_em: new Date().toISOString(),
        },
        { onConflict: 'org_id,seller_id,dia' },
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
        ptw_aplicavel: ptw.aplicavel,
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

  // 6) visitas dos últimos 30 dias de cada oferta viva (ADR-0120). É a ÚNICA medida de demanda por
  // anúncio de terceiro que a API oficial entrega — a Errata 9 do ADR-0119 mediu o endpoint vivo
  // para item de concorrente, ao contrário de `/items/{id}`, que segue 403.
  //
  // Só no baseline: é uma chamada por oferta (a janela não tem multiget), o número é de 30 dias e
  // não se move a cada 6h — repetir no tier quente multiplicaria o custo por 4 pelo mesmo valor.
  //
  // Roda antes do diff de alertas: a qualificação usa a última leitura disponível, inclusive a
  // atualização deste baseline.
  if (baseline && produtos.length > 0) {
    const linhas: { id: string; item_id: string; visitas_30d: number | null }[] = [];
    // Lotes de 50 ids: `.in()` vai na query string e 200 UUIDs dariam ~7,6 KB de request line —
    // território de 414 no gateway. Os outros `.in()` desta função carregam chaves curtas.
    for (let i = 0; i < produtos.length; i += 50) {
      const lote = produtos.slice(i, i + 50).map((p) => p.id);
      linhas.push(...await paginarTudo<{ id: string; item_id: string; visitas_30d: number | null }>((de, ate) =>
        admin.from('pulse_ofertas_atual')
          .select('id, item_id, visitas_30d')
          .eq('org_id', orgId).in('produto_id', lote)
          .eq('ativo', true)
          .order('id', { ascending: true }) // ordem estável: sem ela a paginação repete/pula linha
          .range(de, ate),
      ));
    }
    // Menos visitas primeiro (e nunca medido antes de todos) para o teto de tempo abaixo cortar
    // sempre a mesma ponta da fila — sem ordem, a cauda ficaria eternamente sem medida. Ordena aqui
    // e não no banco porque a lista vem em lotes: só depois de juntar existe a ordem global.
    // ponytail: o critério é "menor número", não "medida mais velha". `visitas_30d_em` carimba a
    // leitura bem-sucedida, mas mudar a prioridade exigiria decidir como equilibrar demanda e idade.
    linhas.sort((a, b) => (a.visitas_30d ?? -1) - (b.visitas_30d ?? -1));

    // Teto de tempo próprio: o worker inteiro morre com WORKER_RESOURCE_LIMIT perto dos 150s e este
    // passo é o mais longo da execução (~1 chamada por oferta viva). Cortar aqui é melhor do que
    // derrubar a execução das orgs seguintes.
    //
    // O que a tela mostra para quem não couber: a linha MAIS RECENTE daquela oferta, que nem sempre
    // é a que já tem número. Se o passo 3 gravou uma linha nova hoje (preço mudou), ela nasce com
    // `visitas_30d` null e a view `distinct on … order by dia desc` passa a devolver esse null — o
    // número da véspera continua no banco, mas fora do alcance da view. Na prática a janela é curta:
    // quem cria linha nova antes do baseline é a rodada quente das 03:00 BRT, e o baseline das 06:00
    // remede primeiro exatamente essas linhas (null vai para a frente da fila acima).
    // ponytail: carry-forward do valor da véspera na linha nova resolveria de vez, e foi adiado pelo
    // controller — o upgrade é copiar `visitas_30d` da linha anterior no upsert do passo 3.
    const ateVisitas = Date.now() + 30_000;
    let estourou = false;
    await pool(CONCORRENCIA, linhas, async (linha) => {
      if (Date.now() > ateVisitas) { estourou = true; return; }
      const visitas = await buscarVisitas30d(token, linha.item_id);
      // Só grava com leitura BOA, e o zero legítimo do ML é gravado como zero. Leitura que falhou
      // (403, 429, timeout) não escreve nada: apagar uma medida boa com null por causa de uma falha
      // transitória seria pior do que exibir o número de ontem, e o mesmo critério vale para quem o
      // teto de tempo acima deixou de fora — as duas pontas preservam.
      if (visitas === null) return;
      const { error } = await admin.from('pulse_ofertas')
        .update({ visitas_30d: visitas, visitas_30d_em: new Date().toISOString() })
        .eq('org_id', orgId).eq('id', linha.id);
      if (error) console.warn(`pulse-coletar: visitas do item ${linha.item_id} falharam:`, error.message);
    });
    if (estourou) {
      console.warn(`pulse-coletar: teto de tempo das visitas 30d atingido na org ${orgId} — resto fica para amanhã`);
    }
  }

  // 7) Alertas usam somente ofertas relevantes, avaliadas depois de perfis e visitas. A coleta
  // continua persistindo o mercado bruto acima para auditoria e para uma qualificação futura.
  alertasTotal = await gravarAlertasRelevantes(admin, orgId, alertasPendentes);

  // Uma notificação agregada por org por execução — SÓ para org com o módulo habilitado.
  if (alertasTotal > 0) {
    const { data: org } = await admin.from('organizations')
      .select('modulos_habilitados').eq('id', orgId).maybeSingle();
    const moduloAtivo = ((org?.modulos_habilitados as string[] | null) ?? []).includes('pulse');
    if (!moduloAtivo) {
      console.warn(`pulse-coletar: ${alertasTotal} alerta(s) da org ${orgId} sem notificação — módulo pulse desabilitado`);
    } else {
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
  }

  return { produtos: produtos.length, gravadas, alertas: alertasTotal };
}
