// E6 (ADR-0061 / Task 6): miolo testável do worker genérico `publicar-anuncio`. Publica
// UMA família em UM canal ≠ ML (D-E6.1: o ML segue nos workers dedicados, intocado).
//
// REGRA DE ISOLAMENTO (D-E6.2): os helpers marcarErro/persistirSucesso escrevem SÓ na linha
// (org_id, canal, codigo_pai, particao=0) de anuncios_externos — NUNCA em familias.status
// (canais não se contaminam; familias.status pertence ao fluxo ML).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { PublicarAnuncioJob } from '../_shared/queue.ts';
import { decidirOperacaoCanal } from '../_shared/anuncios/estado.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import {
  montarAnuncioCanonico,
  type FamiliaParaMontar,
  type VariacaoParaMontar,
} from '../_shared/anuncios/montar-canonico.ts';
import { mesclarVariacoesExternas, type VariacaoExterna } from '../_shared/anuncios/espelhar.ts';
import { classificarErroCanal } from '../_shared/canais/mapeamento.ts';
import type { AtualizacaoCanonica, ErroCanal, VariacaoCanonica } from '../_shared/canais/contrato.ts';

export type ResultadoProcessarJob =
  | { tipo: 'skip'; detalhe: string }
  | { tipo: 'ok'; itemExternoId: string }
  | { tipo: 'erro_retentavel'; mensagem: string }
  | { tipo: 'erro_definitivo'; mensagem: string };

interface IdentidadeCanal { orgId: string; canal: string; codigoPai: string }

async function marcarErro(admin: SupabaseClient, id: IdentidadeCanal, mensagem: string): Promise<void> {
  await admin.from('anuncios_externos')
    .update({ status: 'erro', erro_mensagem: mensagem })
    .eq('org_id', id.orgId).eq('canal', id.canal).eq('codigo_pai', id.codigoPai).eq('particao', 0);
}

async function persistirSucesso(admin: SupabaseClient, id: IdentidadeCanal, p: {
  itemExternoId: string; permalink?: string; variacoesExternas: Record<string, string>;
}): Promise<void> {
  const { data: existente } = await admin.from('anuncios_externos')
    .select('variacoes_externas')
    .eq('org_id', id.orgId).eq('canal', id.canal).eq('codigo_pai', id.codigoPai).eq('particao', 0)
    .maybeSingle();
  const novoMapa: Record<string, VariacaoExterna> = Object.fromEntries(
    Object.entries(p.variacoesExternas).map(([sku, variationId]) => [sku, { variation_id: variationId }]),
  );
  const merged = mesclarVariacoesExternas(
    existente?.variacoes_externas as Record<string, VariacaoExterna> | undefined,
    novoMapa,
  );
  await admin.from('anuncios_externos')
    .update({
      status: 'publicado',
      item_externo_id: p.itemExternoId,
      permalink: p.permalink ?? null,
      variacoes_externas: merged,
      publicado_em: new Date().toISOString(),
      erro_mensagem: null,
    })
    .eq('org_id', id.orgId).eq('canal', id.canal).eq('codigo_pai', id.codigoPai).eq('particao', 0);
}

async function tratarErroCanal(admin: SupabaseClient, id: IdentidadeCanal, erro: ErroCanal): Promise<ResultadoProcessarJob> {
  if (erro.retentavel) return { tipo: 'erro_retentavel', mensagem: erro.mensagemOperador };
  await marcarErro(admin, id, erro.mensagemOperador);
  return { tipo: 'erro_definitivo', mensagem: erro.mensagemOperador };
}

/**
 * UPDATE genérico (D-E6.3): sem 2º canal real na Fase E6, o caminho exercitado é o CREATE —
 * este builder é intencionalmente simples (YAGNI): existentes/novas decidido pelo mapa
 * `variacoes_externas` já persistido no CREATE anterior (sku → id externo); marca/dimensões/
 * desconto ficam de fora (o fake não os consome; um canal real que precise deles ganha os
 * campos quando implementado — ver ADR-0053).
 */
function montarAtualizacao(
  familia: FamiliaParaMontar,
  variacoes: VariacaoParaMontar[],
  itemExternoId: string,
  variacoesExternas: Record<string, VariacaoExterna>,
): AtualizacaoCanonica {
  const existentes: Array<{ sku: string; estoque: number }> = [];
  const novas: VariacaoCanonica[] = [];
  for (const v of variacoes) {
    if (variacoesExternas[v.codigo]) {
      existentes.push({ sku: v.codigo, estoque: v.estoque });
    } else {
      novas.push({
        sku: v.codigo, cor: v.cor, estoque: v.estoque,
        preco: v.preco_publicacao as number | null, gtin: v.gtin, fotoId: v.ml_picture_id,
      });
    }
  }
  const precoRaw = variacoes.find((v) => v.preco_publicacao != null)?.preco_publicacao;
  return {
    itemExternoId,
    existentes,
    novas,
    capaFotoId: familia.capa_ml_picture_id ?? null,
    capa2FotoId: familia.capa2_ml_picture_id ?? null,
    capa3FotoId: familia.capa3_ml_picture_id ?? null,
    categoriaId: familia.categoria_ml_id,
    marca: null,
    dimensoes: null,
    desconto: null,
    precoFamilia: precoRaw != null ? Number(precoRaw) : null,
  };
}

export interface ProcessarJobDeps { admin: SupabaseClient }

export async function processarJob(deps: ProcessarJobDeps, job: PublicarAnuncioJob): Promise<ResultadoProcessarJob> {
  const { admin } = deps;

  const { data: familia } = await admin.from('familias').select('*').eq('id', job.familia_id).single();
  if (!familia) return { tipo: 'skip', detalhe: 'familia inexistente' };

  const id: IdentidadeCanal = { orgId: familia.org_id, canal: job.canal, codigoPai: familia.codigo_pai };

  // Padrão do worker ML (não re-claima): o roteador `publicar-familias` já fez o claim
  // atômico (pendente|erro → publicando) antes de enfileirar. O worker só verifica o claim
  // ativo e deriva a operação. Assim, numa falha retentável a linha SEGUE 'publicando' e o
  // retry do QStash re-executa (se o worker re-claimasse, o retry veria 'publicando' e daria
  // skip — deixando a linha presa; ver ADR-0061).
  const { data: linha } = await admin.from('anuncios_externos')
    .select('status, item_externo_id, variacoes_externas')
    .eq('org_id', id.orgId).eq('canal', id.canal).eq('codigo_pai', id.codigoPai).eq('particao', 0)
    .maybeSingle();
  if (!linha || (linha as { status: string }).status !== 'publicando') {
    return { tipo: 'skip', detalhe: 'sem claim ativo (status != publicando) — idempotência de re-entrega' };
  }
  const operacao = decidirOperacaoCanal(linha as { item_externo_id: string | null });

  const conexao = await resolverConexao(admin, familia.org_id, job.canal);
  if (!conexao) {
    await marcarErro(admin, id, 'canal não conectado');
    return { tipo: 'erro_definitivo', mensagem: 'canal não conectado' };
  }

  const conn = getConnector(job.canal);
  const ctx = { getToken: () => getValidAccessTokenConexao(conexao) };

  try {
    const { data: variacoes } = await admin.from('variacoes').select('*')
      .eq('familia_id', job.familia_id).eq('excluida_da_publicacao', false);
    const anuncio = await montarAnuncioCanonico(admin, conn, ctx, familia, variacoes ?? []);

    if (operacao === 'CREATE') {
      const r = await conn.criarAnuncio(ctx, anuncio);
      if (!r.ok) return await tratarErroCanal(admin, id, r.erro!);
      const ref = r.valor!;
      if (conn.capabilities.descricaoSeparada) {
        await conn.garantirDescricao(ctx, ref.itemExternoId, familia.descricao_ml ?? '');
      }
      await persistirSucesso(admin, id, { itemExternoId: ref.itemExternoId, permalink: ref.permalink, variacoesExternas: ref.variacoesExternas });
      return { tipo: 'ok', itemExternoId: ref.itemExternoId };
    }

    // UPDATE: reusa a linha claimada já lida (item_externo_id + variações vinculadas no canal).
    const itemExternoId = (linha as { item_externo_id: string | null }).item_externo_id as string;
    const variacoesExternasExistentes = ((linha as { variacoes_externas: unknown }).variacoes_externas ?? {}) as Record<string, VariacaoExterna>;
    const atualizacao = montarAtualizacao(familia, variacoes ?? [], itemExternoId, variacoesExternasExistentes);
    const r = await conn.atualizarAnuncio(ctx, atualizacao);
    if (!r.ok) return await tratarErroCanal(admin, id, r.erro!);
    if (conn.capabilities.descricaoSeparada) {
      await conn.garantirDescricao(ctx, itemExternoId, familia.descricao_ml ?? '');
    }
    await persistirSucesso(admin, id, { itemExternoId, variacoesExternas: r.valor!.variacoesExternas });
    return { tipo: 'ok', itemExternoId };
  } catch (e) {
    const erro = classificarErroCanal(e);
    if (erro.retentavel) return { tipo: 'erro_retentavel', mensagem: erro.mensagemOperador };
    await marcarErro(admin, id, erro.mensagemOperador);
    return { tipo: 'erro_definitivo', mensagem: erro.mensagemOperador };
  }
}
