import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { validarColunas, agruparPorPai, matchImagem, matchCapa, matchCapa2, matchCapa3, normalizarCodigo } from '../_shared/parser.ts';
import type { PlanilhaRow } from '../_shared/types.ts';
import { enfileirarFamilia } from '../_shared/queue.ts';
import { casarVariacoesUpdate, type VarAnterior } from '../_shared/update/casar.ts';
import { reconciliarCasamentoComML } from '../_shared/update/reconciliar.ts';
import { buscarVariacoesExistentesML } from '../_shared/ml/variacoes-existentes.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import * as XLSX from 'npm:xlsx@^0.18';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  let callerId: string, orgId: string;
  try {
    ({ userId: callerId, orgId } = await requireUserOrg(req));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const { lote_id } = await req.json().catch(() => ({}));
  if (!lote_id || typeof lote_id !== 'string') {
    return new Response('lote_id obrigatório', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();
  // E7: o token ML agora resolve por org_id (marketplace_connections), não mais por user_id —
  // então familias/variações passam a ficar com o user_id de quem realmente subiu o lote
  // (callerId), em vez de herdar o dono de uma credencial legada.
  const ownerUserId = callerId;

  // Escopo da operação (ADR-0047/0056): o lote pode ter sido criado por qualquer membro.
  const { data: lote, error: loteErr } = await admin
    .from('lotes')
    .select('*')
    .eq('id', lote_id)
    .single();
  if (loteErr || !lote) {
    return new Response(`Lote ${lote_id} não encontrado`, { status: 404, headers: corsHeaders });
  }
  if (lote.status !== 'importando') {
    return new Response(
      JSON.stringify({ loteId: lote.id, totalFamilias: lote.total_familias, jaProcessado: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (!lote.planilha_path) {
    return new Response('Lote sem planilha_path', { status: 400, headers: corsHeaders });
  }

  try {
    const { data: blob, error: dlErr } = await admin.storage
      .from('imagens')
      .download(lote.planilha_path);
    if (dlErr || !blob) throw new Error(`Falha baixando planilha: ${dlErr?.message ?? 'sem blob'}`);

    const buffer = new Uint8Array(await blob.arrayBuffer());
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rowsRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    if (rowsRaw.length === 0) throw new Error('Planilha vazia');

    validarColunas(Object.keys(rowsRaw[0]));

    const rows: PlanilhaRow[] = rowsRaw.map((r) => ({
      CODIGO: String(r.CODIGO ?? ''),
      PAI: String(r.PAI ?? '0'),
      NOME: String(r.NOME ?? ''),
      UNIDADE: String(r.UNIDADE ?? ''),
      GTIN: r.GTIN ? String(r.GTIN) : null,
      CUSTO: Number(r.CUSTO ?? 0),
      PRECO: Number(r.PRECO ?? 0),
      ESTOQUE: Number(r.ESTOQUE ?? 0),
      DESCRICAO_DETALHADO: String(r.DESCRICAO_DETALHADO ?? ''),
      PESO_GRAMAS: Number(r.PESO_GRAMAS ?? 0),
      ALTURA_CM: Number(r.ALTURA_CM ?? 0),
      LARGURA_CM: Number(r.LARGURA_CM ?? 0),
      COMPRIMENTO_CM: Number(r.COMPRIMENTO_CM ?? 0),
      FORNECEDOR: String(r.FORNECEDOR ?? ''),
    }));

    const { grupos, anomalias } = agruparPorPai(rows);

    if (grupos.length === 0) {
      throw new Error('Nenhuma família com variação válida após descartar anomalias da planilha');
    }

    const codigosPai = grupos.map((g) => g.codigo_pai);
    // Escopo da operação (ADR-0056): buscar anteriores de TODA a operação por codigo_pai.
    // Com filtro por user.id, um membro não-dono não veria o anúncio já publicado por outro →
    // trataria como CREATE e DUPLICARIA o anúncio no ML. A operação compartilha os anúncios.
    const { data: anteriores } = await admin
      .from('familias')
      .select('codigo_pai, ml_item_id, ml_permalink, titulo_ml, descricao_ml, categoria_ml_id, atributos_ml, tipo_aviamento, capa_ml_picture_id, publicado_em, concorrencia_vendedores, concorrencia_preco_min, concorrencia_origem, concorrencia_classe, estrategia_preco, estrategia_motivo, analise_mercado, variacoes(codigo, ml_variation_id, cor, cor_origem, ml_picture_id, estoque, preco_publicacao)')
      .in('codigo_pai', codigosPai)
      .not('ml_item_id', 'is', null)
      .order('publicado_em', { ascending: false, nullsFirst: false });

    // Publicação mais recente por codigo_pai.
    const anteriorPorPai = new Map<string, NonNullable<typeof anteriores>[number]>();
    for (const a of anteriores ?? []) {
      if (!anteriorPorPai.has(a.codigo_pai)) anteriorPorPai.set(a.codigo_pai, a);
    }

    // Casamento lote↔anúncio anterior por código (herança + mudança estrutural).
    const casamentoPorPai = new Map<string, ReturnType<typeof casarVariacoesUpdate>>();
    for (const g of grupos) {
      const ant = anteriorPorPai.get(g.codigo_pai);
      if (!ant) continue; // CREATE
      const varsAnteriores: VarAnterior[] = (ant.variacoes ?? []).map((v) => ({
        codigo: v.codigo,
        ml_variation_id: v.ml_variation_id,
        cor: v.cor,
        cor_origem: v.cor_origem,
        ml_picture_id: v.ml_picture_id,
        estoque: v.estoque,
        preco_publicacao: v.preco_publicacao,
      }));
      const novas = g.variacoes.map((v) => ({ codigo: normalizarCodigo(v.CODIGO) }));
      casamentoPorPai.set(g.codigo_pai, casarVariacoesUpdate(novas, varsAnteriores));
    }

    // Reconciliação contra o ML (adendo ADR-0016): o snapshot local pode estar
    // desatualizado (lote excluído, cor adicionada fora do app), marcando como "nova"
    // uma cor que JÁ existe no anúncio. Só consulta o ML nas famílias com suposta cor
    // nova (raro). Falha de ML/token → mantém o casamento local (resiliente).
    const conexaoReconciliacao = await resolverConexao(admin, orgId, 'mercado_livre');
    let tokenML: string | null = null;
    for (const g of grupos) {
      const cas = casamentoPorPai.get(g.codigo_pai);
      const ant = anteriorPorPai.get(g.codigo_pai);
      if (!cas || !ant?.ml_item_id || cas.mudancaEstrutural.novas.length === 0) continue;
      try {
        if (!tokenML) {
          if (!conexaoReconciliacao) throw new Error('Organização sem conexão com o Mercado Livre');
          tokenML = await getValidAccessTokenConexao(conexaoReconciliacao);
        }
        const existentes = await buscarVariacoesExistentesML(tokenML, ant.ml_item_id);
        casamentoPorPai.set(g.codigo_pai, reconciliarCasamentoComML(cas, existentes));
      } catch (e) {
        console.error(`Reconciliação ML falhou (${g.codigo_pai}): ${e instanceof Error ? e.message : e}`);
      }
    }

    const familiasInsert = grupos.map((g) => {
      const ant = anteriorPorPai.get(g.codigo_pai);
      // Candidatos para casar as fotos comuns: PAI + códigos das variações. O operador
      // costuma nomear a foto pelo código vendável (filho), não pelo PAI (bug lote #26).
      const codigosFoto = [g.codigo_pai, ...g.variacoes.map((v) => v.CODIGO)];
      if (!ant) {
        // CREATE — comportamento atual.
        return {
          lote_id: lote.id, user_id: ownerUserId, org_id: lote.org_id, codigo_pai: g.codigo_pai,
          nome_pai: g.nome_pai, descricao_pai: g.descricao_pai, unidade: g.unidade,
          fornecedor: g.fornecedor,
          origem: g.origem,
          operacao: 'CREATE', status: 'pendente',
          capa_storage_path: matchCapa(codigosFoto, lote.imagens_paths) ?? null,
          capa2_storage_path: matchCapa2(codigosFoto, lote.imagens_paths) ?? null,
          capa3_storage_path: matchCapa3(codigosFoto, lote.imagens_paths) ?? null,
        };
      }
      // UPDATE — herda metadados (exibição) + ml_item_id (publicação).
      const cas = casamentoPorPai.get(g.codigo_pai)!;
      const temCorNova = cas.mudancaEstrutural.novas.length > 0;
      return {
        lote_id: lote.id, user_id: ownerUserId, org_id: lote.org_id, codigo_pai: g.codigo_pai,
        nome_pai: g.nome_pai, descricao_pai: g.descricao_pai, unidade: g.unidade,
        fornecedor: g.fornecedor,
        origem: g.origem,
        operacao: 'UPDATE',
        // Com cor nova: 'pendente' p/ o process-familia resolver a cor das novas (ADR-0004).
        // Sem cor nova: 'pronto' direto, sem IA.
        status: temCorNova ? 'pendente' : 'pronto',
        capa_storage_path: matchCapa(codigosFoto, lote.imagens_paths) ?? null,
        capa2_storage_path: matchCapa2(codigosFoto, lote.imagens_paths) ?? null,
        capa3_storage_path: matchCapa3(codigosFoto, lote.imagens_paths) ?? null,
        ml_item_id: ant.ml_item_id,
        ml_permalink: ant.ml_permalink,
        titulo_ml: ant.titulo_ml,
        descricao_ml: ant.descricao_ml,
        categoria_ml_id: ant.categoria_ml_id,
        atributos_ml: ant.atributos_ml,
        tipo_aviamento: ant.tipo_aviamento,
        capa_ml_picture_id: ant.capa_ml_picture_id,
        mudanca_estrutural: cas.mudancaEstrutural,
        // ADR-0016: UPDATE não re-roda IA/concorrência; herda a análise da publicação
        // anterior p/ o Painel de Análise não aparecer vazio na revisão.
        concorrencia_vendedores: ant.concorrencia_vendedores,
        concorrencia_preco_min: ant.concorrencia_preco_min,
        concorrencia_origem: ant.concorrencia_origem,
        concorrencia_classe: ant.concorrencia_classe,
        estrategia_preco: ant.estrategia_preco,
        estrategia_motivo: ant.estrategia_motivo,
        analise_mercado: ant.analise_mercado,
      };
    });

    // Insert em dois lotes por operação: CREATE e UPDATE têm conjuntos de colunas
    // diferentes; o bulk insert do PostgREST une as chaves e grava NULL nas ausentes
    // (em vez do default da coluna), o que viola o NOT NULL de atributos_ml no CREATE.
    const familiasCriadas: { id: string; codigo_pai: string; operacao: string; status: string }[] = [];
    for (const op of ['CREATE', 'UPDATE'] as const) {
      const subset = familiasInsert.filter((f) => f.operacao === op);
      if (subset.length === 0) continue;
      const { data, error: famErr } = await admin
        .from('familias')
        .insert(subset)
        .select('id, codigo_pai, operacao, status');
      if (famErr || !data) throw new Error(`Insert famílias (${op}): ${famErr?.message}`);
      familiasCriadas.push(...data);
    }

    const familiaPorCodigo = new Map(familiasCriadas.map((f) => [f.codigo_pai, f.id]));

    // CREATE e UPDATE em listas separadas: o bulk insert do PostgREST une as chaves
    // de todos os objetos e grava NULL nas ausentes (em vez do default), o que viola
    // o NOT NULL de excluida_da_publicacao (presente só no ramo UPDATE) nas linhas CREATE.
    const variacoesCreate: Record<string, unknown>[] = [];
    const variacoesUpdate: Record<string, unknown>[] = [];
    for (const g of grupos) {
      const cas = casamentoPorPai.get(g.codigo_pai); // undefined em CREATE
      const familiaId = familiaPorCodigo.get(g.codigo_pai)!;
      // Preço de publicação representativo da família (menor entre as cores casadas) —
      // a cor nova herda o mesmo preço de venda das outras, não o preço da planilha.
      const precosCasados = cas
        ? Object.values(cas.herdados)
            .map((h) => h.preco_publicacao)
            .filter((p) => p != null)
            .map((p) => Number(p))
        : [];
      const precoPubFamilia = precosCasados.length ? Math.min(...precosCasados) : null;
      for (const v of g.variacoes) {
        const codigo = normalizarCodigo(v.CODIGO);
        const base = {
          familia_id: familiaId,
          user_id: ownerUserId,
          org_id: lote.org_id,
          codigo,
          nome: v.NOME,
          gtin: v.GTIN,
          custo: v.CUSTO,
          estoque: v.ESTOQUE,
          preco: v.PRECO,
          peso_gramas: v.PESO_GRAMAS,
          altura_cm: v.ALTURA_CM,
          largura_cm: v.LARGURA_CM,
          comprimento_cm: v.COMPRIMENTO_CM,
          imagem_path: matchImagem(v.CODIGO, lote.imagens_paths) ?? null,
        };
        if (cas) {
          const h = cas.herdados[codigo];
          // UPDATE: herda identidade no ML + cor + snapshot do diff; preço de publicação = planilha.
          // Cor casada (já no anúncio) sempre entra. Cor nova entra MARCADA se tiver foto E
          // estoque (foto: igual CREATE; estoque>0: adendo 2026-06-16 — zerada dorme até repor).
          // Cor nova sem foto/sem estoque entra desmarcada; o operador a reinclui na Revisão.
          variacoesUpdate.push({
            ...base,
            ml_variation_id: h?.ml_variation_id ?? null,
            cor: h?.cor ?? null,
            // Cor casada vem de um anúncio já publicado (confirmada): herda a origem real
            // (descricao/vision/manual) p/ não disparar o alerta "sem cor". Dado antigo sem
            // origem cai em 'manual'. Cor nova fica null → process-familia resolve (ADR-0004).
            cor_origem: h?.cor_origem ?? (h?.cor ? 'manual' : null),
            ml_picture_id: h?.ml_picture_id ?? null,
            estoque_anterior: h?.estoque_anterior ?? null,
            // ADR-0016: UPDATE preserva o preço já publicado. Cor nova (sem preço anterior)
            // herda o preço de venda das outras cores da família; só cai na planilha se não houver.
            preco_publicacao: h?.preco_publicacao ?? precoPubFamilia ?? v.PRECO,
            excluida_da_publicacao: h?.ml_variation_id == null && !(base.imagem_path != null && base.estoque > 0),
          });
        } else {
          // CREATE: cor sem foto entra DESMARCADA (mesma política do opt-in da cor nova
          // no UPDATE). Evita travar a publicação da família inteira por uma cor sem
          // imagem; o operador é avisado na Revisão e a cor volta ao subir a foto.
          variacoesCreate.push({ ...base, excluida_da_publicacao: base.imagem_path == null });
        }
      }
    }
    for (const subset of [variacoesCreate, variacoesUpdate]) {
      if (subset.length === 0) continue;
      const { error: varErr } = await admin.from('variacoes').insert(subset);
      if (varErr) throw new Error(`Insert variações: ${varErr.message}`);
    }

    let temPendente = false;
    for (const f of familiasCriadas) {
      if (f.status !== 'pendente') continue; // CREATE + UPDATE com cor nova precisam de IA
      temPendente = true;
      const messageId = await enfileirarFamilia({ familia_id: f.id, lote_id: lote.id });
      await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
    }

    // Sem família pendente (reposição UPDATE sem cor nova → todas já 'pronto'): vai
    // direto para revisão. Com pendentes, o trigger flipa processando→revisao quando
    // a última família termina a IA.
    await admin
      .from('lotes')
      .update({ status: temPendente ? 'processando' : 'revisao', anomalias_planilha: anomalias })
      .eq('id', lote.id);

    return new Response(
      JSON.stringify({ loteId: lote.id, totalFamilias: grupos.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin
      .from('lotes')
      .update({ status: 'erro', erro_mensagem: msg })
      .eq('id', lote.id);
    return new Response(`Falha no ingest: ${msg}`, { status: 500, headers: corsHeaders });
  }
});
