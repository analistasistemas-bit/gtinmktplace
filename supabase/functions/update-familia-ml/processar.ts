// Miolo testável do worker `update-familia-ml` (extraído do Deno.serve). Atualiza UMA família já
// publicada no Mercado Livre. ADR-0088 Fase 2: famílias User Products (com linhas em
// `anuncios_externos_itens`) roteiam para a mini-saga de composição (`atualizarFamiliaUP`) ANTES da
// lógica Legacy de casadas/novas/conn.atualizarAnuncio. O caminho Legacy (incluindo o item-plano de
// 1 variação do ADR-0084, que NÃO tem linhas filhas) fica EXATAMENTE como antes.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import type { ChannelConnector } from '../_shared/canais/contrato.ts';
import { enfileirarVinculacaoCatalogo } from '../_shared/queue.ts';
import { pctEfetivo } from '../_shared/preco/desconto.ts';
import type { FaixaAtacado } from '../_shared/ml/atacado.ts';
import { espelharAnuncioExterno } from '../_shared/anuncios/espelhar.ts';
import { decidirRetryTransitorio, mensagemErroFotoRecuperavel } from '../_shared/publicacao/retry.ts';
import { ehCorIndefinida } from '../_shared/cor/indefinida.ts';
import { precoAConfirmar } from '../_shared/preco/preco-confirmado.ts';
import { garantirPrecoUniforme } from '../_shared/preco/grupos.ts';
import { atualizarFamiliaUP, type AtualizarFamiliaUPArgs, type ResultadoAtualizarUP } from '../_shared/user-products/atualizar-familia-up.ts';
import {
  adotarFamiliaMigrada, type PortasAdocao, type EntradaAdocao, type ResultadoAdocao,
} from '../_shared/user-products/adotar-familia-migrada.ts';
import { criarPortasAdocao, criarPortasRevinculo } from '../_shared/user-products/portas-supabase.ts';
import {
  descobrirFamiliaUP, type CriteriosDescoberta, type ResultadoDescoberta,
} from '../_shared/ml/descobrir-familia-up.ts';
import type { FetchLike } from '../_shared/ml/buscar-item.ts';
import { talvezFinalizarLote } from '../_shared/lote/finalizar.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';

const CANAL = 'mercado_livre';

export interface Job { familia_id: string; lote_id: string; somenteEstoque?: boolean; }

export type ResultadoProcessar =
  | { tipo: 'familia_inexistente' }
  | { tipo: 'skip'; status: string }
  | { tipo: 'ok'; itemExternoId: string; novas: number }
  | { tipo: 'erro'; mensagem: string }
  | { tipo: 'retry'; mensagem: string };

export interface ProcessarDeps {
  admin: SupabaseClient;
  conn: ChannelConnector;
  /** Injetáveis em teste; produção usa os reais. */
  atualizarUP?: (args: AtualizarFamiliaUPArgs) => Promise<ResultadoAtualizarUP>;
  /** ADR-0104: adoção de família migrada pelo ML para User Products. */
  adotarUP?: (portas: PortasAdocao, entrada: EntradaAdocao) => Promise<ResultadoAdocao>;
  /** ADR-0105: descoberta da família UP que substituiu um anúncio Legacy dissolvido. */
  descobrirUP?: (fetchLike: FetchLike, crit: CriteriosDescoberta) => Promise<ResultadoDescoberta>;
  finalizarLote?: (loteId: string) => Promise<void>;
}
export interface ProcessarOpts { tentativas: number }

/** ADR-0128 D-11: texto do sino de notificação ao concluir (sucesso) ou errar o UPDATE do lote
 * "Adicionar variação". `erro` (se informado) entra entre parênteses na mensagem de falha. */
export function mensagemNotificacaoAddVariacao(
  resultado: 'sucesso' | 'erro', nomePai: string, erro?: string,
): string {
  if (resultado === 'sucesso') return `Variações adicionadas: "${nomePai}" atualizado no Mercado Livre.`;
  return `Variações adicionadas: falha ao atualizar "${nomePai}" no Mercado Livre${erro ? ` (${erro})` : ''}.`;
}

/** ADR-0128 D-11 — só o fluxo "adicionar variação" (lote origem='manual' + família
 * operacao='UPDATE') dispara o sino; reposição por planilha continua silenciosa como sempre foi.
 * Best-effort: chamado de dentro de um try/catch, nunca deve derrubar o worker. */
async function notificarConclusaoAddVariacao(
  admin: SupabaseClient, job: Job, resultado: Extract<ResultadoProcessar, { tipo: 'ok' } | { tipo: 'erro' }>,
): Promise<void> {
  const { data: familia } = await admin.from('familias')
    .select('operacao, nome_pai, org_id').eq('id', job.familia_id).maybeSingle();
  if (!familia || familia.operacao !== 'UPDATE') return;
  const { data: lote } = await admin.from('lotes').select('origem').eq('id', job.lote_id).maybeSingle();
  if (lote?.origem !== 'manual') return;
  const texto = resultado.tipo === 'ok'
    ? mensagemNotificacaoAddVariacao('sucesso', String(familia.nome_pai))
    : mensagemNotificacaoAddVariacao('erro', String(familia.nome_pai), resultado.mensagem);
  await notificarCategoria(admin, familia.org_id as string, 'integracao', texto);
}

/** Ponto único de entrada: roda o UPDATE (Legacy ou UP) e, no desfecho final (ok/erro), dispara o
 * sino do ADR-0128 D-11 quando elegível — cobre os dois caminhos (Legacy e mini-saga UP) sem
 * duplicar a checagem de elegibilidade em cada `return` interno. */
export async function processarAtualizacaoFamilia(deps: ProcessarDeps, job: Job, opts: ProcessarOpts): Promise<ResultadoProcessar> {
  const resultado = await executarAtualizacaoFamilia(deps, job, opts);
  if (resultado.tipo === 'ok' || resultado.tipo === 'erro') {
    try {
      await notificarConclusaoAddVariacao(deps.admin, job, resultado);
    } catch (e) {
      console.error('notificação (add-variação) falhou:', e instanceof Error ? e.message : String(e));
    }
  }
  return resultado;
}

async function executarAtualizacaoFamilia(deps: ProcessarDeps, job: Job, opts: ProcessarOpts): Promise<ResultadoProcessar> {
  const { admin, conn } = deps;
  const atualizarUP = deps.atualizarUP ?? atualizarFamiliaUP;
  const adotar = deps.adotarUP ?? adotarFamiliaMigrada;
  const descobrir = deps.descobrirUP ?? descobrirFamiliaUP;
  const finalizarLote = deps.finalizarLote ?? ((loteId: string) => talvezFinalizarLote(admin, loteId));
  const { tentativas } = opts;

  const { data: familia } = await admin.from('familias').select('*').eq('id', job.familia_id).single();
  if (!familia) return { tipo: 'familia_inexistente' };

  const conexao = await resolverConexao(admin, familia.org_id, 'mercado_livre');
  const ctx = {
    getToken: () => conexao
      ? getValidAccessTokenConexao(conexao)
      : Promise.reject(new Error('Organização sem conexão com o Mercado Livre')),
  };

  // Idempotência: só processa o claim ativo ('publicando'). Re-entrega do QStash após
  // o lote já ter sido finalizado (status 'publicado'/'erro') é ignorada sem reprocessar.
  if (familia.status !== 'publicando') {
    return { tipo: 'skip', status: familia.status };
  }

  // Caches de foto efêmeros subidos NESTE attempt: se a publicação falhar, são limpos
  // no catch para o retry re-subir (upload de foto não anexado a um item expira no ML
  // → "Picture id ... does not exist" no retry). Declarados fora do try p/ visibilidade no catch.
  let capa2SubidaAgora = false;
  let capa3SubidaAgora = false;

  try {
    if (!familia.ml_item_id) {
      const err = new Error('Família UPDATE sem ml_item_id herdado (400)') as Error & { status?: number };
      err.status = 400;
      throw err;
    }

    // Cores incluídas: casadas (têm ml_variation_id) repõem estoque; novas (sem
    // ml_variation_id) são criadas como variação. Excluídas ficam de fora.
    const { data: variacoes } = await admin.from('variacoes')
      .select('codigo, cor, estoque, preco_publicacao, gtin, imagem_path, ml_picture_id, ml_variation_id, peso_gramas, altura_cm, largura_cm, comprimento_cm')
      .eq('familia_id', job.familia_id)
      .eq('excluida_da_publicacao', false);
    if (!variacoes || variacoes.length === 0) {
      const err = new Error('Nenhuma cor incluída para atualizar (400)') as Error & { status?: number };
      err.status = 400;
      throw err;
    }

    // ADR-0078 F2 (invariante #1): em "atualizar tudo" o precoFamilia propagaria o 1º preço a
    // TODAS as cores em silêncio se houvesse divergência — LOUD em vez disso. Em "somente
    // estoque" nenhum preço é empurrado (invariante #3), então divergência recalculada é inócua.
    if (!job.somenteEstoque) garantirPrecoUniforme(variacoes, 'UPDATE');

    // ── ADR-0088 Fase 2: roteamento User Products ────────────────────────────────────────────
    // Família UP tem N itens técnicos em `anuncios_externos_itens` (todas as `variacoes` com
    // ml_variation_id=null). Detecta pela presença dessas linhas (raiz partição 0) e roteia para a
    // mini-saga de composição ANTES da lógica Legacy. Família Legacy (inclusive item-plano-1-variação
    // do ADR-0084, que NÃO tem linhas filhas) segue EXATAMENTE como antes.
    const { data: raizUP, error: raizErr } = await admin.from('anuncios_externos')
      .select('id, titulo, criado_em')
      .eq('org_id', familia.org_id).eq('codigo_pai', familia.codigo_pai).eq('canal', CANAL).eq('particao', 0)
      .maybeSingle();
    // Fail-closed: erro na query de roteamento NUNCA pode virar "não é UP" em silêncio (cairia no
    // Legacy sobre uma família UP e a corromperia). Lança → o catch retenta (mesmo fix de vinculacao.ts).
    if (raizErr) throw new Error(`roteamento UP (raiz): ${raizErr.message}`);

    // Entrega a família à mini-saga de composição. Usada por DOIS caminhos: o atalho local (linhas
    // filhas já existem) e, depois da adoção, o caminho de família migrada pelo ML (ADR-0104).
    const rodarUP = async (raiz: { id: string; titulo: string | null }): Promise<ResultadoProcessar> => {
      if (!conexao) throw new Error('Organização sem conexão com o Mercado Livre');
      const r = await atualizarUP({
        admin, conn, ctx, conexao, familia, raiz: raiz as never, variacoes: variacoes as never,
        somenteEstoque: !!job.somenteEstoque, tentativas,
      });
      if (r.estado === 'retry') return { tipo: 'retry', mensagem: r.mensagem };
      await finalizarLote(job.lote_id);
      if (r.estado === 'ok') return { tipo: 'ok', itemExternoId: familia.ml_item_id, novas: r.adicionadas };
      return { tipo: 'erro', mensagem: r.mensagem };
    };

    if (raizUP) {
      const { data: itensUP, error: itensErr } = await admin.from('anuncios_externos_itens')
        .select('id').eq('anuncio_externo_id', (raizUP as { id: string }).id).limit(1);
      if (itensErr) throw new Error(`roteamento UP (itens): ${itensErr.message}`);
      if (itensUP && itensUP.length > 0) {
        return await rodarUP(raizUP as { id: string; titulo: string | null });
      }
    }

    let desconto: { pct: number; precoPorCodigo: Record<string, number | null> } | null = null;
    if (familia.exibir_com_desconto) {
      const { data: cfg } = await admin.from('configuracoes')
        .select('desconto_pct').eq('org_id', familia.org_id).maybeSingle();
      const global = cfg?.desconto_pct != null ? Number(cfg.desconto_pct) : 15;
      const fam = familia.desconto_pct != null ? Number(familia.desconto_pct) : null;
      const precoPorCodigo: Record<string, number | null> = {};
      for (const v of variacoes) precoPorCodigo[v.codigo] = v.preco_publicacao != null ? Number(v.preco_publicacao) : null;
      desconto = { pct: pctEfetivo(fam, global), precoPorCodigo };
    }

    const casadas = variacoes.filter((v) => v.ml_variation_id);
    const novas = variacoes.filter((v) => !v.ml_variation_id);

    const BUCKET = 'imagens';
    const TTL_SIGNED = 60 * 60 * 2;
    const signed = async (path: string): Promise<string> => {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, TTL_SIGNED);
      if (error || !data) throw new Error(`Signed URL falhou para ${path}`);
      return data.signedUrl;
    };

    // Sobe a foto das cores novas (idempotente via ml_picture_id).
    const novasComFoto: Array<typeof novas[number] & { ml_picture_id: string | null }> = [];
    for (const v of novas) {
      let picId = v.ml_picture_id as string | null;
      if (!picId && v.imagem_path) {
        picId = await conn.subirFoto(ctx, await signed(v.imagem_path));
        await admin.from('variacoes').update({ ml_picture_id: picId }).eq('familia_id', job.familia_id).eq('codigo', v.codigo);
      }
      novasComFoto.push({ ...v, ml_picture_id: picId });
    }

    let capa2Pic = (familia.capa2_ml_picture_id as string | null) ?? null;
    if (!capa2Pic && familia.capa2_storage_path) {
      capa2Pic = await conn.subirFoto(ctx, await signed(familia.capa2_storage_path as string));
      await admin.from('familias').update({ capa2_ml_picture_id: capa2Pic }).eq('id', job.familia_id);
      capa2SubidaAgora = true;
    }

    let capa3Pic = (familia.capa3_ml_picture_id as string | null) ?? null;
    if (!capa3Pic && familia.capa3_storage_path) {
      capa3Pic = await conn.subirFoto(ctx, await signed(familia.capa3_storage_path as string));
      await admin.from('familias').update({ capa3_ml_picture_id: capa3Pic }).eq('id', job.familia_id);
      capa3SubidaAgora = true;
    }

    // Preço de publicação da família (todas as cores incluídas compartilham o mesmo).
    // Propagado a TODAS as variações existentes (adendo ADR-0016): o ML exige preço
    // único entre variações e o operador quer que a alteração de preço alcance a
    // família já publicada. Idempotente quando o preço não mudou.
    const precoFamiliaRaw = variacoes.find((v) => v.preco_publicacao != null)?.preco_publicacao;
    const precoFamilia = precoFamiliaRaw != null ? Number(precoFamiliaRaw) : null;
    // ADR-0016 (adendo 2026-06-05): sincroniza só o BRAND no UPDATE a partir do fornecedor,
    // preservando os demais atributos. Sem fornecedor → não envia (não sobrescreve com "Avil").
    // ADR-0018: também sincroniza dimensões/peso (SELLER_PACKAGE_*) da variação representativa
    // (principal, ou 1ª) — inválido → omite (ML mantém o que tiver). Corrige frete pós-publicação.
    const marca = (familia.fornecedor as string | null)?.trim() || null;
    const repUpd = variacoes.find((v) => v.codigo === familia.variacao_principal_codigo) ?? variacoes[0];
    const dimensoesUpd = repUpd ? {
      altura_cm: repUpd.altura_cm != null ? Number(repUpd.altura_cm) : null,
      largura_cm: repUpd.largura_cm != null ? Number(repUpd.largura_cm) : null,
      comprimento_cm: repUpd.comprimento_cm != null ? Number(repUpd.comprimento_cm) : null,
      peso_gramas: repUpd.peso_gramas != null ? Number(repUpd.peso_gramas) : null,
    } : null;

    // O conector encapsula o GET estado → montar variações/novas → PUT → refetch → casar
    // (reenviar TODAS as variações: o ML deleta as omitidas; comuns capa2/capa3 aplicadas a
    // todas; foto da cor nova também em item.pictures). Não lança: erro vira ResultadoCanal.
    const res = await conn.atualizarAnuncio(ctx, {
      itemExternoId: familia.ml_item_id,
      existentes: casadas.map((v) => ({ sku: v.codigo, estoque: v.estoque, cor: v.cor })),
      novas: novasComFoto.map((v) => ({
        sku: v.codigo, cor: v.cor, estoque: v.estoque,
        preco: v.preco_publicacao, gtin: v.gtin, fotoId: v.ml_picture_id,
      })),
      capaFotoId: (familia.capa_ml_picture_id as string | null) ?? null,
      capa2FotoId: capa2Pic,
      capa3FotoId: capa3Pic,
      categoriaId: familia.categoria_ml_id as string | null,
      marca,
      dimensoes: dimensoesUpd,
      desconto: desconto ?? null,
      precoFamilia,
      somenteEstoque: job.somenteEstoque,
    });
    if (!res.ok) {
      const e = res.erro!;
      // ── ADR-0104: o GET ao vivo revelou que o ML migrou esta família para User Products ───────
      // Ela foi publicada como Legacy, então não tem linhas filhas locais e o atalho de roteamento
      // lá em cima não a enxergou. Adota os itens irmãos por SKU (SÓ leitura remota) e entrega à
      // saga UP no MESMO attempt — sem pedir nada ao operador.
      if (e.codigo === 'MIGRADO_PARA_UP') {
        if (!conexao?.contaExternaId) throw new Error('Organização sem conexão com o Mercado Livre');
        // ── ADR-0105: o ML DISSOLVEU a família (fechou o item Legacy e criou N itens novos) ──────
        // Não há family_id/family_name no item morto e os irmãos não têm SKU: descobre a família
        // pelo título e casa cada SKU pela COR (dados autorais do ML dos dois lados). A adoção em
        // si — validações, tudo-ou-nada, RPC — é a mesma do ADR-0104.
        const dissolvido = e.up?.dissolvido;
        const comum = {
          admin, getToken: ctx.getToken, orgId: familia.org_id, userId: familia.user_id,
          familiaId: job.familia_id, codigoPai: familia.codigo_pai,
          mlItemIdAntigo: familia.ml_item_id as string,
        };

        let portas: PortasAdocao;
        let familyName: string;

        if (dissolvido) {
          const descoberta = await descobrir(
            (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>,
            {
              getToken: ctx.getToken,
              sellerId: conexao.contaExternaId,
              titulo: dissolvido.titulo ?? '',
              categoriaId: dissolvido.categoriaId ?? '',
              itemMortoId: familia.ml_item_id,
            },
          );
          // Nenhuma família sucessora → o anúncio foi mesmo encerrado. Lança a mensagem ORIGINAL
          // do guard de anúncio morto (lote #45), palavra por palavra: nada mudou para esse caso.
          if (descoberta.tipo === 'nenhuma') {
            const err = new Error(dissolvido.motivoFallback) as Error & { status?: number };
            err.status = 400;
            throw err;
          }
          if (descoberta.tipo === 'truncada') {
            const err = new Error(
              `Anúncio encerrado e a busca no Mercado Livre não cobriu todos os anúncios `
              + `(${descoberta.observados} de ${descoberta.total}) — um conjunto parcial poderia `
              + 'apontar para a família errada. Nada foi alterado. (400)',
            ) as Error & { status?: number };
            err.status = 400;
            throw err;
          }
          if (descoberta.tipo === 'ambigua') {
            const err = new Error(
              `Anúncio encerrado e mais de uma família User Products candidata no Mercado Livre `
              + `(family_id ${descoberta.familyIds.join(', ')}) — não dá para escolher sem adivinhar. `
              + 'Nada foi alterado. Confira no painel do Mercado Livre. (400)',
            ) as Error & { status?: number };
            err.status = 400;
            throw err;
          }
          // SKU → COR (variações do item morto) → irmão. Os dois lados do casamento são dados
          // autorais do ML; `variacoes.cor` do nosso banco NUNCA entra aqui (ADR-0105 §2).
          const itemPorSku = new Map<string, string>();
          for (const [sku, cor] of Object.entries(dissolvido.corPorSku)) {
            const item = descoberta.familia.itemPorCor.get(cor);
            if (item) itemPorSku.set(sku, item);
          }
          familyName = descoberta.familia.familyName;
          portas = criarPortasRevinculo({ ...comum, itemPorSku });
        } else {
          const nome = e.up?.familyName;
          // Sem family_name a busca por SKU não tem como validar os irmãos — nunca adivinha.
          if (!nome) {
            const err = new Error(
              'Anúncio no modelo User Products sem family_name — não é possível localizar as cores '
              + 'automaticamente. Confira o anúncio no painel do Mercado Livre. (400)',
            ) as Error & { status?: number };
            err.status = 400;
            throw err;
          }
          familyName = nome;
          portas = criarPortasAdocao({
            ...comum, sellerId: conexao.contaExternaId,
            categoriaId: familia.categoria_ml_id ?? '', familyName,
          });
        }

        // Adota só as cores JÁ PUBLICADAS (casadas): uma cor genuinamente nova ainda não existe no
        // ML e faria a busca abortar sempre. As novas ficam para a saga de composição criar depois
        // (em "somente estoque" são ignoradas, ADR-0104 §4).
        const adocao = await adotar(portas, {
          skus: casadas.map((v) => v.codigo),
          sellerEsperado: conexao.contaExternaId,
          mlItemIdAtual: familia.ml_item_id,
          familyNameObservado: familyName,
        });
        if (adocao.tipo === 'incompleta') {
          // 400 (definitivo): retentar não muda o estado do ML e ocuparia a fila serial
          // (parallelism=1, ADR-0034) por 10 retries × 30s à toa.
          const err = new Error(`${adocao.mensagem} (400)`) as Error & { status?: number };
          err.status = 400;
          throw err;
        }
        const { data: raizAdotada, error: raizAdotErr } = await admin.from('anuncios_externos')
          .select('id, titulo, criado_em')
          .eq('org_id', familia.org_id).eq('codigo_pai', familia.codigo_pai)
          .eq('canal', CANAL).eq('particao', 0)
          .maybeSingle();
        if (raizAdotErr || !raizAdotada) {
          throw new Error(`adoção UP: raiz não encontrada após adotar (${raizAdotErr?.message ?? 'sem linha'})`);
        }
        return await rodarUP(raizAdotada as { id: string; titulo: string | null });
      }
      const err = new Error(e.mensagemOperador);
      // Repassa status + retentavel p/ o catch: 5xx/429 ou foto ainda propagando → retenta.
      (err as { status?: number }).status = e.status;
      (err as { retentavel?: boolean }).retentavel = e.retentavel;
      throw err;
    }

    // Casa o ml_variation_id das cores novas (idempotente). variacoesExternas: sku → id externo.
    const persistidas = new Set<string>();
    for (const [codigo, variationId] of Object.entries(res.valor!.variacoesExternas)) {
      if (novasComFoto.some((v) => v.codigo === codigo)) {
        await admin.from('variacoes').update({ ml_variation_id: variationId })
          .eq('familia_id', job.familia_id).eq('codigo', codigo);
        persistidas.add(codigo);
      }
    }
    // Se ainda assim alguma cor nova não tem vínculo, NÃO marca publicado (evita duplicar
    // no próximo UPDATE). Falha explícita para o operador conferir antes de republicar.
    const novasSemVinculo = novasComFoto.filter((v) => !persistidas.has(v.codigo));
    if (novasSemVinculo.length > 0) {
      const err = new Error(`ML não vinculou as cores novas ${novasSemVinculo.map((v) => v.codigo).join(', ')} (sem seller_custom_field). Elas podem ter sido criadas no anúncio — confira no ML antes de republicar para não duplicar (400)`) as Error & { status?: number };
      err.status = 400;
      throw err;
    }

    // ADR-0078 F1: grava o preço confirmado por SKU (base do badge "preço alterado"). Só no
    // sucesso do PUT; em "somente estoque" confirma o preço vivo (não o recalculado). Chaveia
    // pelos SKUs que o ML confirmou no anúncio (variacoesExternas) — existentes + novas.
    const confirmado = precoAConfirmar({
      somenteEstoque: !!job.somenteEstoque,
      precoVivo: res.valor!.precoVivo ?? null,
      precoEnviado: precoFamilia,
    });
    if (confirmado != null) {
      await admin.from('variacoes')
        .update({ preco_publicado_ml: confirmado })
        .eq('familia_id', job.familia_id)
        .in('codigo', Object.keys(res.valor!.variacoesExternas));
    }

    // Sincroniza a descrição do anúncio (ADR-0016 adendo 2026-06-07): cor nova (seção de cores
    // muda) ou descrição corrigida/regenerada (texto muda). Reposição pura → não reenvia. O
    // conector resolve contra a descrição ao vivo e devolve a nova a persistir (ou null).
    if (familia.descricao_ml) {
      // Exclui cor indefinida ('Outra' do Vision, ADR-0044/lote #31) — não é cor real,
      // não pode entrar na lista de cores da descrição (mesmo guard do CREATE).
      const cores = [...new Set(variacoes.map((v) => v.cor).filter((c): c is string => !ehCorIndefinida(c)))];
      const nova = await conn.sincronizarDescricao(ctx, familia.ml_item_id, familia.descricao_ml as string, cores);
      if (nova) {
        await admin.from('familias').update({ descricao_ml: nova }).eq('id', job.familia_id);
      }
    }

    await admin.from('familias').update({
      status: 'publicado',
      publicado_em: new Date().toISOString(),
    }).eq('id', job.familia_id);

    // Atacado (PxQ): sincroniza com o preço atual. Com faixas → reaplica; sem faixas mas já
    // aplicado antes → limpa (envia só a base). Best-effort, não derruba o update.
    // Base do PxQ = precoFamilia (cores incluídas compartilham o mesmo preço, ADR-0041).
    // ADR-0078 F1: em "somente estoque" NÃO reaplica — aplicarAtacado recalcula amount a partir
    // de precoFamilia, empurrando B2B a um preço que o operador escolheu NÃO publicar. O PxQ vivo
    // no ML é preservado (coerente com não mexer em preço).
    if (!job.somenteEstoque) {
      try {
        const faixasAtacado = Array.isArray(familia.atacado) ? (familia.atacado as FaixaAtacado[]) : [];
        const jaAplicado = familia.atacado_status === 'aplicado';
        const aplicandoFaixas = faixasAtacado.length > 0;
        if (aplicandoFaixas || jaAplicado) {
          if (aplicandoFaixas && precoFamilia == null) {
            const m = 'Atacado sem preço-base: sem preço novo nem preço vivo conhecido';
            await admin.from('familias').update({ atacado_status: 'erro', atacado_erro: m }).eq('id', job.familia_id);
          } else {
            // Limpar (faixas vazias) não precisa de preço-base real: montarFaixasPxQ ignora
            // precoBase quando faixas=[] (o POST vira {prices:[]} de qualquer forma).
            try {
              await conn.aplicarAtacado(ctx, familia.ml_item_id, precoFamilia ?? 0, faixasAtacado);
              await admin.from('familias')
                .update({ atacado_status: aplicandoFaixas ? 'aplicado' : null, atacado_erro: null })
                .eq('id', job.familia_id);
            } catch (e) {
              const m = e instanceof Error ? e.message : String(e);
              console.error(`atacado (update) falhou para ${familia.ml_item_id}:`, m);
              await admin.from('familias').update({ atacado_status: 'erro', atacado_erro: m }).eq('id', job.familia_id);
            }
          }
        }
      } catch (e) {
        console.error('atacado (bloco update) falhou inesperadamente:', e instanceof Error ? e.message : String(e));
      }
    }

    // Catálogo (ADR-0021): reconcilia o vínculo das cores de forma DEFERIDA (mesmo motivo do
    // CREATE: a elegibilidade de cor nova leva minutos). Enfileira o job com delay/retry;
    // variações já vinculadas são puladas (idempotente). Best-effort.
    try {
      await enfileirarVinculacaoCatalogo(job.familia_id);
    } catch (e) {
      console.error(`enfileirar catálogo (update) falhou para ${familia.ml_item_id}:`, e);
    }

    // E2 (ADR-0025): espelha o estado atualizado em anuncios_externos (best-effort).
    const { data: varsEspelho } = await admin.from('variacoes')
      .select('codigo, ml_variation_id, catalog_product_id, catalog_listing_id, catalog_status')
      .eq('familia_id', job.familia_id);
    await espelharAnuncioExterno(admin, {
      user_id: familia.user_id,
      org_id: familia.org_id,
      codigo_pai: familia.codigo_pai,
      ml_item_id: familia.ml_item_id,
      ml_permalink: familia.ml_permalink ?? null,
      publicado_em: new Date().toISOString(),
    }, varsEspelho ?? []);

    await finalizarLote(job.lote_id);
    return { tipo: 'ok', itemExternoId: familia.ml_item_id, novas: novasComFoto.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retentavelFoto = (err as { retentavel?: boolean }).retentavel === true;
    // 5xx/429 ou foto ainda propagando (item.pictures.unavailable): reusa as fotos já subidas e
    // retenta via QStash (o retryDelay cobre a propagação, ADR-0033). NÃO limpa aqui — re-subir
    // reinicia o relógio de propagação (lote #31).
    if (decidirRetryTransitorio(err, tentativas) === 'retentar') {
      return { tipo: 'retry', mensagem: msg };
    }
    await admin.from('familias').update({
      status: 'erro',
      erro_mensagem: retentavelFoto ? mensagemErroFotoRecuperavel(msg) : msg,
    }).eq('id', job.familia_id);
    // Esgotou os retries: limpa os caches de foto efêmeros p/ o próximo attempt manual re-subir
    // fresco (cobre picture id inválido/expirado — "Picture id does not exist"): cores novas ainda
    // não anexadas (ml_variation_id null) e as capas subidas neste attempt.
    await admin.from('variacoes').update({ ml_picture_id: null })
      .eq('familia_id', job.familia_id).is('ml_variation_id', null);
    const limparCapas: Record<string, null> = {};
    if (capa2SubidaAgora) limparCapas.capa2_ml_picture_id = null;
    if (capa3SubidaAgora) limparCapas.capa3_ml_picture_id = null;
    if (Object.keys(limparCapas).length > 0) {
      await admin.from('familias').update(limparCapas).eq('id', job.familia_id);
    }
    await finalizarLote(job.lote_id);
    return { tipo: 'erro', mensagem: msg };
  }
}
