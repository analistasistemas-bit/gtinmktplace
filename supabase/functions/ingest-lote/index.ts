import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { validarColunas, agruparPorPai, matchImagem, matchCapa, normalizarCodigo } from '../_shared/parser.ts';
import type { PlanilhaRow } from '../_shared/types.ts';
import { enfileirarFamilia } from '../_shared/queue.ts';
import { casarVariacoesUpdate, type VarAnterior } from '../_shared/update/casar.ts';
import * as XLSX from 'npm:xlsx@^0.18';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  let user;
  try {
    user = await requireUser(req);
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const { lote_id } = await req.json().catch(() => ({}));
  if (!lote_id || typeof lote_id !== 'string') {
    return new Response('lote_id obrigatório', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();

  const { data: lote, error: loteErr } = await admin
    .from('lotes')
    .select('*')
    .eq('id', lote_id)
    .eq('user_id', user.id)
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
      PRECO: Number(r.PRECO ?? 0),
      ESTOQUE: Number(r.ESTOQUE ?? 0),
      DESCRICAO_DETALHADO: String(r.DESCRICAO_DETALHADO ?? ''),
      PESO_GRAMAS: Number(r.PESO_GRAMAS ?? 0),
      ALTURA_CM: Number(r.ALTURA_CM ?? 0),
      LARGURA_CM: Number(r.LARGURA_CM ?? 0),
      COMPRIMENTO_CM: Number(r.COMPRIMENTO_CM ?? 0),
    }));

    const { grupos, anomalias } = agruparPorPai(rows);

    if (grupos.length === 0) {
      throw new Error('Nenhuma família com variação válida após descartar anomalias da planilha');
    }

    const codigosPai = grupos.map((g) => g.codigo_pai);
    const { data: anteriores } = await admin
      .from('familias')
      .select('codigo_pai, ml_item_id, ml_permalink, titulo_ml, descricao_ml, categoria_ml_id, atributos_ml, tipo_aviamento, capa_ml_picture_id, publicado_em, variacoes(codigo, ml_variation_id, cor, ml_picture_id, estoque)')
      .eq('user_id', user.id)
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
        ml_picture_id: v.ml_picture_id,
        estoque: v.estoque,
      }));
      const novas = g.variacoes.map((v) => ({ codigo: normalizarCodigo(v.CODIGO) }));
      casamentoPorPai.set(g.codigo_pai, casarVariacoesUpdate(novas, varsAnteriores));
    }

    const familiasInsert = grupos.map((g) => {
      const ant = anteriorPorPai.get(g.codigo_pai);
      if (!ant) {
        // CREATE — comportamento atual.
        return {
          lote_id: lote.id, user_id: user.id, codigo_pai: g.codigo_pai,
          nome_pai: g.nome_pai, descricao_pai: g.descricao_pai, unidade: g.unidade,
          operacao: 'CREATE', status: 'pendente',
          capa_storage_path: matchCapa(g.codigo_pai, lote.imagens_paths) ?? null,
        };
      }
      // UPDATE — herda metadados (exibição) + ml_item_id (publicação).
      const cas = casamentoPorPai.get(g.codigo_pai)!;
      const temCorNova = cas.mudancaEstrutural.novas.length > 0;
      return {
        lote_id: lote.id, user_id: user.id, codigo_pai: g.codigo_pai,
        nome_pai: g.nome_pai, descricao_pai: g.descricao_pai, unidade: g.unidade,
        operacao: 'UPDATE',
        // Com cor nova: 'pendente' p/ o process-familia resolver a cor das novas (ADR-0004).
        // Sem cor nova: 'pronto' direto, sem IA.
        status: temCorNova ? 'pendente' : 'pronto',
        capa_storage_path: matchCapa(g.codigo_pai, lote.imagens_paths) ?? null,
        ml_item_id: ant.ml_item_id,
        ml_permalink: ant.ml_permalink,
        titulo_ml: ant.titulo_ml,
        descricao_ml: ant.descricao_ml,
        categoria_ml_id: ant.categoria_ml_id,
        atributos_ml: ant.atributos_ml,
        tipo_aviamento: ant.tipo_aviamento,
        capa_ml_picture_id: ant.capa_ml_picture_id,
        mudanca_estrutural: cas.mudancaEstrutural,
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

    const variacoesInsert = grupos.flatMap((g) => {
      const cas = casamentoPorPai.get(g.codigo_pai); // undefined em CREATE
      return g.variacoes.map((v) => {
        const codigo = normalizarCodigo(v.CODIGO);
        const h = cas?.herdados[codigo];
        return {
          familia_id: familiaPorCodigo.get(g.codigo_pai)!,
          user_id: user.id,
          codigo,
          nome: v.NOME,
          gtin: v.GTIN,
          estoque: v.ESTOQUE,
          preco: v.PRECO,
          peso_gramas: v.PESO_GRAMAS,
          altura_cm: v.ALTURA_CM,
          largura_cm: v.LARGURA_CM,
          comprimento_cm: v.COMPRIMENTO_CM,
          imagem_path: matchImagem(v.CODIGO, lote.imagens_paths) ?? null,
          // UPDATE: herda identidade no ML + cor + snapshot do diff; preço de publicação = planilha.
          ...(cas ? {
            ml_variation_id: h?.ml_variation_id ?? null,
            cor: h?.cor ?? null,
            ml_picture_id: h?.ml_picture_id ?? null,
            estoque_anterior: h?.estoque_anterior ?? null,
            preco_publicacao: v.PRECO,
            // Cor nova (sem variação no anúncio) entra DESMARCADA (opt-in).
            excluida_da_publicacao: h?.ml_variation_id == null,
          } : {}),
        };
      });
    });
    const { error: varErr } = await admin.from('variacoes').insert(variacoesInsert);
    if (varErr) throw new Error(`Insert variações: ${varErr.message}`);

    for (const f of familiasCriadas) {
      if (f.status !== 'pendente') continue; // CREATE + UPDATE com cor nova precisam de IA
      const messageId = await enfileirarFamilia({ familia_id: f.id, lote_id: lote.id });
      await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
    }

    await admin
      .from('lotes')
      .update({ status: 'processando', anomalias_planilha: anomalias })
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
