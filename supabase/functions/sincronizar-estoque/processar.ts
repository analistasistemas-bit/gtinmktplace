// E6b (ADR-0094): push de estoque por VALOR ABSOLUTO para os canais publicados.
// Chamado pela fila serial estoque-{orgId} (parallelism=1), então a ordem é garantida
// e repetir é sempre seguro.
//
// O miolo vive aqui, com dependências injetadas: sem isso o teste com o conector
// `fake` não roda — resolverConexao devolveria null para um canal sem credencial real
// e getValidAccessTokenConexao é específico do ML.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { resolverAlvosPush, type AlvoPush } from '../_shared/estoque/alvos.ts';
import { listarKitsVivos, saldoDoKit } from '../_shared/estoque/kit.ts';
import type { SincronizarEstoqueJob } from '../_shared/queue.ts';
import type { ChannelConnector, ContextoCanal } from '../_shared/canais/contrato.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import {
  montarMensagemEstoqueZerado, montarMensagemVoltaAoAr, type VariacaoZerada,
} from '../_shared/notificacoes/estoque.ts';

/**
 * Obtenção de token POR CANAL. Hoje só o ML existe; a Shopee entra aqui no E5.
 * Um mapa explícito impede que a semântica de refresh rotativo do ML seja aplicada
 * silenciosamente a outro canal quando ele chegar.
 */
export function fabricarTokenPadrao(
  canal: string, conexao: unknown,
): (() => Promise<string>) | null {
  if (canal === 'mercado_livre') {
    return () => getValidAccessTokenConexao(conexao as Parameters<typeof getValidAccessTokenConexao>[0]);
  }
  return null;
}

export interface DepsSincronizacao {
  admin: SupabaseClient;
  resolverConexao: typeof resolverConexao;
  getConnector: typeof getConnector;
  /** OBRIGATORIAMENTE injetável — ver comentário no topo. */
  fabricarToken: (canal: string, conexao: unknown) => (() => Promise<string>) | null;
  /** Injetável para o teste ver o texto do alerta sem Telegram nem tabela (ADR-0134). */
  notificar?: typeof notificarCategoria;
}

export interface RespostaSincronizacao { status: number; body: Record<string, unknown> }

/**
 * ADR-0111 — devolve o anúncio de `pausado` para `ativo` depois de uma reposição.
 *
 * O status é LIDO antes de escrever, por dois motivos. Idempotência: o QStash reentrega o job e a
 * reconciliação repete o push, então agir às cegas viraria N escritas para o mesmo fim. E porque
 * só `pausado` é reversível sem decisão humana — `moderado`, `encerrado`, `inativo` e
 * `indisponivel` ficam intocados (forçar `active` num anúncio moderado é a escrita que fez o ML
 * cancelar um anúncio em 2026-08-06).
 *
 * 'retentavel' = quem chama devolve 500 e o QStash tenta de novo. Erro definitivo é só logado: o
 * saldo já chegou ao canal e é a verdade; a reativação tenta de novo na próxima reposição.
 */
async function reativarSePausado(
  conn: ChannelConnector, ctx: ContextoCanal, canal: string, itemExternoId: string,
): Promise<'ok' | 'retentavel' | 'reativado'> {
  const vivo = await conn.lerStatus(ctx, [itemExternoId]);
  if (vivo[itemExternoId]?.status !== 'pausado') return 'ok';

  const r = await conn.atualizarStatus(ctx, itemExternoId, 'ativo');
  if (r.ok) {
    console.log('estoque_reativou_anuncio', canal, itemExternoId);
    // 'reativado' só sai na transição real (leu pausado + PUT ok) — é a própria dedup do aviso de
    // volta ao ar (ADR-0134): na reentrega do QStash o anúncio já está ativo e nada é enviado.
    return 'reativado';
  }
  if (r.erro?.retentavel) return 'retentavel';
  console.error('estoque_reativar_definitivo', canal, itemExternoId, r.erro);
  return 'ok';
}

interface ContextoAlerta {
  orgId: string;
  codigoPai: string;
  produto: string | null;
  permalink: string | null;
  /** Rótulo de cada SKU do produto, para nomear a variação zerada na mensagem. */
  rotuloPorSku: Map<string, { nome: string | null; cor: string | null }>;
  estoquePorSku: Record<string, number>;
  /**
   * Existe anúncio publicado do produto — NÃO é "este push tem alvos". Na venda, o job carrega o
   * canal onde ela ocorreu e `resolverAlvosPush` exclui esse canal (já se decrementou sozinho);
   * com um canal só, `alvos` fica vazio justamente quando o anúncio acabou de ser pausado por
   * falta de estoque. Sem anúncio nenhum não há "anúncio pausado" a anunciar: marca e não envia.
   */
  temAnuncio: boolean;
}

/**
 * ADR-0134 — avisa que o estoque zerou (e que, se tudo zerou, o anúncio saiu do ar).
 *
 * A transição vem de `estoque_movimentos` (>0 → 0), não do saldo atual: `variacoes.estoque = 0`
 * não diz QUANDO zerou e re-alertaria a cada push. A dedup é a marca `alertado_em`, gravada com
 * `is('alertado_em', null)` + `select()` — só o que a marcação devolve é notificado, então a
 * reentrega do QStash (push idempotente, repete de propósito) não duplica o aviso.
 *
 * Best-effort: falha aqui é logada e não derruba o push, que já cumpriu seu papel.
 */
async function alertarEstoqueZerado(
  admin: SupabaseClient, notificar: typeof notificarCategoria, ctx: ContextoAlerta,
): Promise<void> {
  try {
    const { data: candidatos } = await admin.from('estoque_movimentos')
      .select('id, codigo')
      .eq('org_id', ctx.orgId).eq('codigo_pai', ctx.codigoPai)
      .eq('estoque_resultante', 0).gt('estoque_anterior', 0)
      .is('alertado_em', null);
    const ids = (candidatos ?? []).map((m) => m.id as string);
    if (ids.length === 0) return;

    const { data: marcados } = await admin.from('estoque_movimentos')
      .update({ alertado_em: new Date().toISOString() })
      .in('id', ids).is('alertado_em', null)
      .select('codigo');
    const codigos = [...new Set((marcados ?? []).map((m) => m.codigo as string))];
    if (codigos.length === 0) return;
    // Marcado mas não enviado: publicar um produto velho não pode despejar a história inteira de
    // zeradas de uma vez (mesmo erro do primeiro run do alerta de cancelamento, ADR-0121).
    if (!ctx.temAnuncio) return;

    const zeradas: VariacaoZerada[] = codigos.map((codigo) => ({
      codigo,
      nome: ctx.rotuloPorSku.get(codigo)?.nome ?? null,
      cor: ctx.rotuloPorSku.get(codigo)?.cor ?? null,
    }));
    const totais = Object.values(ctx.estoquePorSku);
    await notificar(admin, ctx.orgId, 'estoque', montarMensagemEstoqueZerado({
      produto: ctx.produto,
      codigoPai: ctx.codigoPai,
      zeradas,
      produtoInteiroZerado: totais.length > 0 && totais.every((q) => q <= 0),
      permalink: ctx.permalink,
    }));
  } catch (e) {
    console.error('estoque_alerta_zerado_falhou', ctx.codigoPai, String(e));
  }
}

/** Identifica de quem (base ou qual kit) um alvo de push veio, só para o aviso de reativação. */
type Origem = { codigoPai: string; produto: string | null; permalink: string | null };
type AlvoComOrigem = AlvoPush & { origem: Origem };

interface FamiliaComSaldo {
  familiaId: string;
  codigoPai: string;
  nome: string | null;
  permalink: string | null;
  estoquePorSku: Record<string, number>;
  rotuloPorSku: Map<string, { nome: string | null; cor: string | null }>;
}

/** Família canônica de um `codigo_pai` + o mapa de saldos das variações dela. */
async function lerFamiliaComSaldo(
  admin: SupabaseClient, orgId: string, codigoPai: string,
): Promise<FamiliaComSaldo | null> {
  const { data: familia } = await admin.from('familias')
    .select('id, nome_pai, ml_permalink').eq('org_id', orgId).eq('codigo_pai', codigoPai)
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();
  if (!familia) return null;

  const { data: variacoes } = await admin.from('variacoes')
    .select('codigo, estoque, nome, cor').eq('familia_id', familia.id);
  const estoquePorSku: Record<string, number> = {};
  const rotuloPorSku = new Map<string, { nome: string | null; cor: string | null }>();
  for (const v of variacoes ?? []) {
    estoquePorSku[v.codigo as string] = (v.estoque as number) ?? 0;
    rotuloPorSku.set(v.codigo as string, {
      nome: (v.nome as string | null) ?? null, cor: (v.cor as string | null) ?? null,
    });
  }
  return {
    familiaId: familia.id as string, codigoPai,
    nome: (familia.nome_pai as string | null) ?? null,
    permalink: (familia.ml_permalink as string | null) ?? null,
    estoquePorSku, rotuloPorSku,
  };
}

/** Alvos de push de UMA família. `resolverAlvosPush` roda com o mapa só dela. */
async function alvosDaFamilia(
  admin: SupabaseClient, orgId: string, codigoPai: string,
  estoquePorSku: Record<string, number>, canalOrigem: string | null,
): Promise<{ alvos: AlvoPush[]; temAnuncio: boolean }> {
  const { data: anuncios } = await admin.from('anuncios_externos')
    .select('id, canal, item_externo_id, variacoes_externas')
    .eq('org_id', orgId).eq('codigo_pai', codigoPai).eq('status', 'publicado');
  const idsAnuncio = (anuncios ?? []).map((a) => a.id as string);
  const { data: itensUP } = idsAnuncio.length > 0
    ? await admin.from('anuncios_externos_itens')
      .select('anuncio_externo_id, sku, item_externo_id, retirado, status')
      .eq('org_id', orgId).in('anuncio_externo_id', idsAnuncio)
    : { data: [] };
  const alvos = resolverAlvosPush(
    (anuncios ?? []) as never, (itensUP ?? []) as never, estoquePorSku, canalOrigem,
  );
  return { alvos, temAnuncio: (anuncios ?? []).length > 0 };
}

export async function processarSincronizacao(
  deps: DepsSincronizacao, job: SincronizarEstoqueJob,
): Promise<RespostaSincronizacao> {
  const { org_id, codigo_pai, canal_origem } = job;
  const admin = deps.admin;

  // 1) Base: família canônica + saldo real das variações.
  //
  // Defensivo: se o job veio com o `codigo_pai` de um KIT, redireciona para a base. Nenhum
  // caminho grava o `codigo_pai` de um kit no ledger hoje (a baixa resolve para a base, e
  // entrada/ajuste em SKU de kit são recusados no banco), mas se acontecesse, o kit seria
  // tratado como produto e o push mandaria a coluna crua `estoque = 0` para um anúncio vivo.
  let codigoPaiBase = codigo_pai;
  const { data: familiaDoJob } = await admin.from('familias')
    .select('kit_base_codigo_pai, kit_multiplicador')
    .eq('org_id', org_id).eq('codigo_pai', codigo_pai)
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();
  if (familiaDoJob?.kit_multiplicador != null && familiaDoJob.kit_base_codigo_pai) {
    console.log('estoque_push_job_de_kit_redirecionado', codigo_pai, '->', familiaDoJob.kit_base_codigo_pai);
    codigoPaiBase = familiaDoJob.kit_base_codigo_pai as string;
  }

  const base = await lerFamiliaComSaldo(admin, org_id, codigoPaiBase);
  if (!base) return { status: 200, body: { ok: true, skip: 'produto sem família' } };
  if (Object.keys(base.estoquePorSku).length === 0) {
    return { status: 200, body: { ok: true, skip: 'sem variações' } };
  }

  const kits = await listarKitsVivos(admin, org_id, codigoPaiBase);

  // ADR-0151 D-7 (revisada) — com kit vinculado, a exclusão por canal de origem NÃO se
  // aplica: reempurra base + todos os tamanhos, sempre. Base e kits dividem o mesmo canal em
  // anúncios diferentes, e a exclusão por canal pularia todos eles. Identificar e pular só o
  // anúncio de origem foi DESCARTADO pelo Diego: o push é ABSOLUTO e recalculado do zero,
  // então o resultado final é idêntico — custa 1-2 chamadas de API a mais por evento, e
  // poupa uma coluna no ledger mais plumbing por todo o outbox. Não "otimize" isto de volta.
  //
  // Produto sem kit segue com o comportamento de hoje, intocado.
  const exclusao = kits.length > 0 ? null : canal_origem;

  // 2) Alvos da base + de CADA kit, um `resolverAlvosPush` por família.
  //
  // ATENÇÃO: NÃO junte os SKUs de base e kits num mapa só. Quando `variacoes_externas` é
  // vazio (anúncio de kit é item plano de 1 SKU), `resolverAlvosPush` cai no fallback
  // "manda o produto inteiro" (alvos.ts:57-58) e o anúncio do kit receberia os SKUs da base.
  const { alvos: alvosBase, temAnuncio: baseTemAnuncio } =
    await alvosDaFamilia(admin, org_id, codigoPaiBase, base.estoquePorSku, exclusao);
  // Cada alvo carrega a origem (base ou kit) de quem o gerou — sem isto, o aviso de "voltou ao
  // ar" (ADR-0111) não teria como saber, no laço de push abaixo, se quem reativou foi a base ou
  // um kit específico (AlvoPush não carrega codigo_pai — ver alvos.ts).
  const origemBase: Origem = { codigoPai: codigoPaiBase, produto: base.nome, permalink: base.permalink };
  const alvos: AlvoComOrigem[] = alvosBase.map((a) => ({ ...a, origem: origemBase }));
  let temAnuncio = baseTemAnuncio;

  // O saldo do kit é sempre floor(estoque_base / N), calculado ao vivo (ADR-0151 D-6). A
  // coluna `variacoes.estoque` do kit fica em 0 para sempre e NUNCA é lida aqui.
  //
  // A UMA variação da base — nunca a soma das variações. O ledger (`baixar_estoque`) resolve
  // UMA variação por `(org_id, codigo)` e decrementa AQUELA linha; derivar de uma soma faria
  // o kit e o ledger falarem de números diferentes no dia em que a trava de "só produto sem
  // cor" (D-10) for afrouxada. Com mais de uma variação, falha LOUD em vez de inventar um
  // número plausível.
  const skusBase = Object.keys(base.estoquePorSku);
  const estoqueBaseUnico = skusBase.length === 1 ? base.estoquePorSku[skusBase[0]] : null;

  for (const kit of kits) {
    if (estoqueBaseUnico === null) {
      console.error('kit_com_base_multivariacao', { org_id, codigoPaiBase, skus: skusBase.length });
      continue;   // não empurra saldo inventado para o ML
    }
    const kitComSaldo = await lerFamiliaComSaldo(admin, org_id, kit.codigo_pai);
    if (!kitComSaldo) continue;
    const derivado: Record<string, number> = {};
    for (const sku of Object.keys(kitComSaldo.estoquePorSku)) {
      derivado[sku] = saldoDoKit(estoqueBaseUnico, kit.kit_multiplicador);
    }
    // `exclusao` aqui é sempre null (só chegamos neste laço com kits.length > 0).
    const r = await alvosDaFamilia(admin, org_id, kit.codigo_pai, derivado, exclusao);
    const origemKit: Origem = {
      codigoPai: kit.codigo_pai, produto: kitComSaldo.nome, permalink: kitComSaldo.permalink,
    };
    alvos.push(...r.alvos.map((a) => ({ ...a, origem: origemKit })));
    temAnuncio = temAnuncio || r.temAnuncio;
  }

  const notificar = deps.notificar ?? notificarCategoria;
  const ctxAlerta: ContextoAlerta = {
    orgId: org_id,
    codigoPai: codigoPaiBase,
    produto: base.nome,
    permalink: base.permalink,
    rotuloPorSku: base.rotuloPorSku,
    estoquePorSku: base.estoquePorSku,
    temAnuncio,
  };
  if (alvos.length === 0) {
    // Sem canal publicado o saldo não pausa anúncio nenhum: fecha os movimentos sem avisar.
    await alertarEstoqueZerado(admin, notificar, ctxAlerta);
    return { status: 200, body: { ok: true, alvos: 0 } };
  }

  // 3) Push absoluto, um alvo por vez. Falha de um canal nunca afeta outro.
  const retentaveis: string[] = [];
  // Chave = codigo_pai de quem reativou (base ou kit) — Map dedupa User Products (N filhos da
  // MESMA família reativando no mesmo run geram 1 entrada só, ADR-0088).
  const reativados = new Map<string, Origem>();
  const tokenPorCanal = new Map<string, () => Promise<string>>();

  for (const alvo of alvos) {
    // try/catch por ALVO: resolverConexao, getConnector e atualizarEstoque podem
    // lançar. Sem isto, uma exceção num canal aborta o laço inteiro e "falha de um
    // canal nunca afeta outro" seria mentira.
    try {
      let getToken = tokenPorCanal.get(alvo.canal);
      if (!getToken) {
        const conexao = await deps.resolverConexao(admin, org_id, alvo.canal);
        if (!conexao) continue;                     // canal desconectado: nada a fazer
        const fabricado = deps.fabricarToken(alvo.canal, conexao);
        if (!fabricado) {
          console.error('estoque_push_sem_fabrica_de_token', alvo.canal);
          continue;
        }
        getToken = fabricado;
        tokenPorCanal.set(alvo.canal, getToken);
      }
      const conn = deps.getConnector(alvo.canal);
      if (!conn.capabilities.atualizarEstoque) {
        console.log('estoque_push_nao_suportado', alvo.canal);
        continue;
      }
      const r = await conn.atualizarEstoque({ getToken }, alvo.itemExternoId, alvo.estoques);
      if (!r.ok && r.erro?.retentavel) retentaveis.push(`${alvo.canal}:${alvo.itemExternoId}`);
      if (!r.ok && !r.erro?.retentavel) {
        console.error('estoque_push_definitivo', alvo.canal, alvo.itemExternoId, r.erro);
      }
      // ADR-0111 — reposição reativa o anúncio pausado. Só depois do push OK: publicar com o
      // canal defasado seria pior que continuar pausado. Saldo zero não reativa nada.
      if (r.ok && job.reativar && alvo.estoques.some((e) => e.estoque > 0)) {
        const reativacao = await reativarSePausado(conn, { getToken }, alvo.canal, alvo.itemExternoId);
        if (reativacao === 'retentavel') retentaveis.push(`${alvo.canal}:${alvo.itemExternoId}:status`);
        // Uma família user products reativa N itens filhos no mesmo run (ADR-0088); o aviso é
        // sobre a FAMÍLIA (base ou kit) que reativou, então sai uma vez por família, depois do
        // laço — não uma vez por alvo, e sempre com o contexto de quem de fato reativou.
        if (reativacao === 'reativado') reativados.set(alvo.origem.codigoPai, alvo.origem);
      }
    } catch (e) {
      // Exceção inesperada é tratada como RETENTÁVEL: melhor o QStash tentar de novo
      // (push absoluto é idempotente) do que perder a propagação em silêncio.
      console.error('estoque_push_excecao', alvo.canal, alvo.itemExternoId, String(e));
      retentaveis.push(`${alvo.canal}:${alvo.itemExternoId}`);
    }
  }

  // A reativação já aconteceu de fato (PUT ok), então o aviso sai antes do eventual 500: na
  // retentativa o anúncio já está `ativo`, ninguém reativa nada e o aviso se perderia.
  for (const o of reativados.values()) {
    await notificar(admin, org_id, 'estoque', montarMensagemVoltaAoAr({
      produto: o.produto, codigoPai: o.codigoPai, permalink: o.permalink,
    })).catch((e) => console.error('estoque_alerta_volta_falhou', o.codigoPai, String(e)));
  }

  // Push é absoluto: repetir é seguro, então 500 para o QStash re-tentar.
  // O alerta fica para a retentativa: dizer "anúncio pausado" antes de o canal ter recebido o
  // zero seria mentira (ADR-0134).
  if (retentaveis.length > 0) return { status: 500, body: { retry: retentaveis } };

  await alertarEstoqueZerado(admin, notificar, ctxAlerta);
  return { status: 200, body: { ok: true, alvos: alvos.length } };
}
