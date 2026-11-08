// ADR-0197 (Task 10): cria o kit com variação na tela Publicados. Casca: autenticação, gate de admin (a
// montagem pausa os individuais por T, ADR-0060) e as portas de `processar.ts` no Supabase e no ML. Nada é
// publicado aqui: a saga `kit-transferencia` reduz as peças e cria os itens.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { lerSchemaAtributos } from '../_shared/categoria/schema.ts';
import { garantirChart, type Genero } from '../_shared/ml/size-chart.ts';
import { gradeDaFamilia } from '../_shared/produto/tipos-produto-valores.ts';
import { exigirFiscalCompletoSePreciso, type FamiliaFiscalRow } from '../_shared/fiscal/gate.ts';
import { derivarCodigos, codigosJaUsados } from '../_shared/produto/codigos.ts';
import { comRetryConcorrencia } from '../_shared/estoque/baixa.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../_shared/ml/multiget.ts';
import { enfileirarSaga } from '../_shared/queue.ts';
import { EMBED_MODULOS } from '../_shared/kit-variacao/politica.ts';
import { lerOferta } from '../_shared/kit-variacao/ml-oferta.ts';
import { AVISO_SELETOR_ML } from '../_shared/kit-variacao/combinacoes.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import {
  criarKitVariacao, itensPorFoto, moderadosDoBulk, type CriarKitVariacaoInput, type DepsCriarKitVariacao,
} from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const STATUS_POR_MOTIVO: Record<string, number> = {
  base_nao_encontrada: 404, modulo_desligado: 403,
  falha_gravar: 500, sku_nao_encontrado: 500, baseline_incompleto: 500,
  base_desatualizada: 409, base_e_kit: 409, base_em_kit: 409, base_legacy: 409, base_full: 409,
  base_multi_origem: 409, base_moderada: 409, foto_moderada: 409, peca_insuficiente: 409,
  baseline_divergente: 409, up_ocupado: 409, pedido_diferente: 409, cadastro_parcial_divergente: 409,
  foto_nao_autorizada: 403,
};

type Linha = Record<string, unknown>;

/** Lê ou lança: sem leitura não há decisão (fail-closed). */
async function ler<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>, onde: string): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(`${onde}: ${error.message}`);
  return data;
}
/** Linha obrigatória (insert com select, `single`). */
async function lerUm<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>, onde: string): Promise<NonNullable<T>> {
  const data = await ler(q, onde);
  if (data == null) throw new Error(`${onde}: sem linha`);
  return data;
}

function portas(admin: SupabaseClient, orgId: string, userId: string): DepsCriarKitVariacao {
  let conexao: Promise<{ token: string; id: string }> | null = null;
  const ml = () => conexao ??= (async () => {
    const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
    if (!cx) throw new Error('Organização sem conexão com o Mercado Livre');
    return { token: await getValidAccessTokenConexao(cx), id: cx.id };
  })();

  return {
    orgId,
    async usuariosDaOrg() {
      return (await ler(admin.from('profiles').select('id').eq('org_id', orgId), 'usuários da org') ?? []).map((p) => p.id as string);
    },

    async parcial(chave) {
      const f = await ler(admin.from('familias').select('id, lote_id, codigo_pai, kit_variacao_pedido').eq('org_id', orgId)
        .eq('chave_cadastro', chave).maybeSingle(), 'cadastro parcial');
      if (!f) return null;
      const vs = await ler(admin.from('variacoes').select('codigo, cor, tamanho').eq('familia_id', f.id), 'variações do parcial') ?? [];
      return {
        pedidoHash: (f.kit_variacao_pedido as string | null) ?? null,
        familiaId: f.id as string, loteId: f.lote_id as string, codigoPai: f.codigo_pai as string,
        variacoes: vs.map((v) => ({ codigo: v.codigo as string, cor: v.cor as string | null, tamanho: v.tamanho as string | null })),
      };
    },

    async lerBase(familiaId) {
      const familia = await ler(admin.from('familias').select(`*, ${EMBED_MODULOS}`)
        .eq('id', familiaId).eq('org_id', orgId).maybeSingle(), 'família-base') as Linha | null;
      if (!familia) return null;
      const [ultima] = await lerUm(admin.from('familias').select('id').eq('org_id', orgId)
        .eq('codigo_pai', familia.codigo_pai as string).order('criado_em', { ascending: false }).limit(1), 'versão da base');
      const variacoes = await ler(admin.from('variacoes').select('*')
        .eq('familia_id', familiaId).eq('excluida_da_publicacao', false), 'variações da base') as Linha[];
      const vinculos = await ler(admin.from('anuncios_externos_itens')
        .select('sku, item_externo_id, user_product_id, catalog_listing_id, anuncios_externos!inner(codigo_pai)')
        .eq('org_id', orgId).eq('anuncios_externos.codigo_pai', familia.codigo_pai as string).eq('retirado', false)
        .in('sku', variacoes.map((v) => v.codigo as string)), 'vínculos da base');
      return {
        familia, canonica: ultima?.id === familiaId, variacoes,
        vinculos: (vinculos ?? []).map((v) => ({
          sku: v.sku as string, item_externo_id: v.item_externo_id as string | null,
          user_product_id: v.user_product_id as string | null, catalog_listing_id: v.catalog_listing_id as string | null,
        })),
      };
    },

    async existente(chave) {
      const kit = await ler(admin.from('kits_variacao').select('id, pedido_hash').eq('org_id', orgId).eq('chave_cadastro', chave)
        .maybeSingle(), 'kit existente');
      if (!kit) return null;
      const t = await ler(admin.from('kit_transferencias').select('id').eq('org_id', orgId).eq('kit_id', kit.id)
        .eq('tipo', 'montar').order('criado_em').limit(1), 'transferência do kit');
      return {
        kitId: kit.id as string, transferenciaId: (t?.[0]?.id as string | undefined) ?? null,
        pedidoHash: (kit.pedido_hash as string | null) ?? null,
      };
    },

    lerOferta: async (upId, itemIds) => lerOferta((await ml()).token, upId, itemIds),

    // Foto → itens que a usam (`itensPorFoto`: Legacy, principal e cópias de catálogo) → status lido no ML agora,
    // com leitura completa (`moderadosDoBulk` lança se faltar item). Qualquer falha lança e a edge recusa.
    async fotosEmItemModerado(paths) {
      const vs = await ler(admin.from('variacoes').select('codigo, imagem_path, catalog_listing_id, familias!inner(ml_item_id)')
        .eq('org_id', orgId).in('imagem_path', paths), 'fotos de variação') ?? [];
      const capas: Array<{ path: string; codigo_pai: string; ml_item_id: string | null }> = [];
      for (const coluna of ['capa_storage_path', 'capa2_storage_path', 'capa3_storage_path']) {
        const fs = await ler(admin.from('familias').select('*').eq('org_id', orgId).in(coluna, paths), 'fotos de capa') as Linha[] | null;
        capas.push(...(fs ?? []).map((f) => ({
          path: f[coluna] as string, codigo_pai: f.codigo_pai as string, ml_item_id: (f.ml_item_id as string | null) ?? null,
        })));
      }
      const skus = [...new Set(vs.map((v) => v.codigo as string))];
      const pais = [...new Set(capas.map((f) => f.codigo_pai))];
      const filhos: Linha[] = [];
      const colunas = 'sku, item_externo_id, catalog_listing_id, anuncios_externos!inner(codigo_pai)';
      if (skus.length > 0) {
        filhos.push(...await ler(admin.from('anuncios_externos_itens').select(colunas).eq('org_id', orgId)
          .in('sku', skus), 'itens das fotos de variação') ?? []);
      }
      if (pais.length > 0) {
        filhos.push(...await ler(admin.from('anuncios_externos_itens').select(colunas).eq('org_id', orgId)
          .in('anuncios_externos.codigo_pai', pais), 'itens das fotos de capa') ?? []);
      }
      const umDe = (x: unknown) => (Array.isArray(x) ? x[0] : x) as Linha | null | undefined;
      const itensPorPath = itensPorFoto({
        variacoes: vs.map((v) => ({
          imagem_path: v.imagem_path as string, codigo: v.codigo as string,
          familia_ml_item_id: (umDe(v.familias)?.ml_item_id as string | null) ?? null,
          catalog_listing_id: (v.catalog_listing_id as string | null) ?? null,
        })),
        capas,
        filhos: filhos.map((f) => ({
          sku: f.sku as string, codigo_pai: (umDe(f.anuncios_externos)?.codigo_pai as string | null) ?? null,
          item_externo_id: (f.item_externo_id as string | null) ?? null, catalog_listing_id: (f.catalog_listing_id as string | null) ?? null,
        })),
      });
      const ids = [...new Set([...itensPorPath.values()].flatMap((x) => [...x]))];
      if (ids.length === 0) return [];
      const { token } = await ml();
      const moderados = new Set<string>();
      for (let i = 0; i < ids.length; i += 20) {
        const bloco = ids.slice(i, i + 20);
        const resp = await fetch(`https://api.mercadolibre.com${caminhoMultiget(bloco, 'id,status,sub_status')}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) throw new Error(`ML /items/bulk ${resp.status}`);
        for (const id of moderadosDoBulk(bloco, comoEnvelopeAntigo(await resp.json(), bloco))) moderados.add(id);
      }
      return [...itensPorPath].filter(([, itens]) => [...itens].some((id) => moderados.has(id))).map(([p]) => p);
    },

    exigirFiscal: async (familia) => { await exigirFiscalCompletoSePreciso(admin, familia as unknown as FamiliaFiscalRow); },
    lerSchema: async (categoriaId) => lerSchemaAtributos((await ml()).token, categoriaId),
    async garantirGuia(familia, tamanhos) {
      const grade = gradeDaFamilia((familia.grade_tamanho as string | null) ?? null, tamanhos);
      if (!grade) throw new Error('Sem grade de tamanho na base.');
      const { token, id } = await ml();
      await garantirChart(admin, token, id, familia.categoria_ml_id as string, familia.genero as Genero, tamanhos, grade);
    },

    async subirFoto(path) {
      const { data, error } = await admin.storage.from('imagens').createSignedUrl(path, 60 * 60 * 2);
      if (error || !data) throw new Error(error?.message ?? 'foto não encontrada');
      return await getConnector('mercado_livre').subirFoto({ getToken: async () => (await ml()).token }, data.signedUrl);
    },

    async reservarCodigos(qtd) {
      for (const resync of [false, true]) {
        const ultimo = await ler(admin.rpc('proximo_codigo_produto', { p_org: orgId, p_qtd: qtd, ...(resync ? { p_resync: true } : {}) }),
          'numeração');
        const r = derivarCodigos(Number(ultimo), qtd);
        if ((await codigosJaUsados(admin, orgId, [r.codigoPai, ...r.codigos])).length === 0) return r;
        console.warn('criar_kit_variacao_resync_sequencia', { orgId });
      }
      throw new Error('Falha na numeração automática. Tente novamente.');
    },

    gravar: {
      async lote() {
        const lote = await lerUm(admin.from('lotes').insert({ user_id: userId, org_id: orgId, status: 'publicando', origem: 'manual' })
          .select('id').single(), 'lote');
        const numero = await ler(admin.rpc('proximo_numero_lote', { p_org: orgId }), 'número do lote');
        if (numero != null) await admin.from('lotes').update({ numero_org: numero }).eq('id', lote.id);
        return lote.id as string;
      },
      familia: async (linha) => (await lerUm(admin.from('familias').insert(linha).select('id').single(), 'família do kit')).id as string,
      async variacao(linha) {
        const { error } = await comRetryConcorrencia(() => admin.from('variacoes').insert(linha));
        if (error) throw new Error(`variação do kit: ${error.message}`);
      },
      kit: async (a) => await lerUm(admin.rpc('kit_variacao_criar', {
        p_org: orgId, p_chave: a.chave, p_kit: a.kit, p_skus: a.skus, p_baseline: a.baseline, p_alvos: a.alvos,
      }), 'kit_variacao_criar'),
      async desfazer(loteId, familiaId) {
        if (familiaId) await admin.from('familias').delete().eq('id', familiaId);
        await admin.from('lotes').delete().eq('id', loteId);
      },
    },

    enfileirarSaga: (id) => enfileirarSaga(id, orgId),
  };
}

function parse(body: Linha): CriarKitVariacaoInput | null {
  const quantidades = Array.isArray(body.quantidades) ? body.quantidades as Linha[] : null;
  if (
    typeof body.familia_base_id !== 'string' || !Array.isArray(body.cores) || typeof body.pecas_por_kit !== 'number'
    || typeof body.preco !== 'number' || !quantidades || typeof body.titulo !== 'string' || typeof body.descricao !== 'string'
    || typeof body.fotos !== 'object' || body.fotos === null || typeof body.chave_cadastro !== 'string' || !body.chave_cadastro
  ) return null;
  return {
    familiaBaseId: body.familia_base_id, cores: body.cores.map(String), pecasPorKit: body.pecas_por_kit, preco: body.preco,
    quantidades: quantidades.map((q) => ({
      cores: Array.isArray(q.cores) ? q.cores.map(String) : [], tamanho: String(q.tamanho ?? ''), quantidade: Number(q.quantidade),
    })),
    titulo: body.titulo, descricao: body.descricao, fotos: body.fotos as Record<string, string>,
    soEmKit: body.so_em_kit === true, meta: typeof body.meta === 'number' ? body.meta : 0, chaveCadastro: body.chave_cadastro,
    ...(body.listing_type_id != null ? { listingTypeId: body.listing_type_id as CriarKitVariacaoInput['listingTypeId'] } : {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { context = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { userId, orgId } = context;
  const admin = adminClient();

  // A montagem pausa os anúncios individuais durante a quarentena (ADR-0060): só admin.
  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditarOperacaoSuporte(admin, context, { type: 'org', id: orgId }, 'denied');
    return json({ error: 'Somente administradores podem executar esta ação' }, 403);
  }
  if (!(await exigirModulo(admin, orgId, 'kit_variacao'))) {
    return json({ error: 'Kit com variação não habilitado para esta organização.' }, 403);
  }

  let input: CriarKitVariacaoInput | null;
  try { input = parse(await req.json()); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (!input) return json({ error: 'Payload inválido.' }, 400);
  const target = { type: 'familia', id: input.familiaBaseId };

  try {
    const r = await criarKitVariacao(portas(admin, orgId, userId), input);
    if (!r.ok) {
      await auditarOperacaoSuporte(admin, context, target, 'failed');
      return json({ error: r.mensagem ?? r.motivo, motivo: r.motivo }, STATUS_POR_MOTIVO[r.motivo] ?? 400);
    }
    await auditarOperacaoSuporte(admin, context, target, 'succeeded');
    return json({ ...r, aviso: AVISO_SELETOR_ML });
  } catch (e) {
    console.error('criar_kit_variacao_falhou', orgId, String(e));
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
