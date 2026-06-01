import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import { validarColunas, agruparPorPai, matchImagem, matchCapa, normalizarCodigo } from '../_shared/parser.ts';
import type { PlanilhaRow } from '../_shared/types.ts';
import { enfileirarFamilia } from '../_shared/queue.ts';
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

    const grupos = agruparPorPai(rows);

    const codigosPai = grupos.map((g) => g.codigo_pai);
    const { data: existentes } = await admin
      .from('familias')
      .select('codigo_pai, ml_item_id')
      .eq('user_id', user.id)
      .in('codigo_pai', codigosPai)
      .not('ml_item_id', 'is', null);
    const publicadosSet = new Set((existentes ?? []).map((e) => e.codigo_pai));

    const familiasInsert = grupos.map((g) => ({
      lote_id: lote.id,
      user_id: user.id,
      codigo_pai: g.codigo_pai,
      nome_pai: g.nome_pai,
      descricao_pai: g.descricao_pai,
      unidade: g.unidade,
      operacao: publicadosSet.has(g.codigo_pai) ? 'UPDATE' : 'CREATE',
      status: 'pendente',
      capa_storage_path: matchCapa(g.codigo_pai, lote.imagens_paths) ?? null,
    }));
    const { data: familiasCriadas, error: famErr } = await admin
      .from('familias')
      .insert(familiasInsert)
      .select('id, codigo_pai');
    if (famErr || !familiasCriadas) throw new Error(`Insert famílias: ${famErr?.message}`);

    const familiaPorCodigo = new Map(familiasCriadas.map((f) => [f.codigo_pai, f.id]));

    const variacoesInsert = grupos.flatMap((g) =>
      g.variacoes.map((v) => ({
        familia_id: familiaPorCodigo.get(g.codigo_pai)!,
        user_id: user.id,
        codigo: normalizarCodigo(v.CODIGO),
        nome: v.NOME,
        gtin: v.GTIN,
        estoque: v.ESTOQUE,
        preco: v.PRECO,
        peso_gramas: v.PESO_GRAMAS,
        altura_cm: v.ALTURA_CM,
        largura_cm: v.LARGURA_CM,
        comprimento_cm: v.COMPRIMENTO_CM,
        imagem_path: matchImagem(v.CODIGO, lote.imagens_paths) ?? null,
      }))
    );
    const { error: varErr } = await admin.from('variacoes').insert(variacoesInsert);
    if (varErr) throw new Error(`Insert variações: ${varErr.message}`);

    for (const f of familiasCriadas) {
      const messageId = await enfileirarFamilia({ familia_id: f.id, lote_id: lote.id });
      await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
    }

    await admin
      .from('lotes')
      .update({ status: 'processando' })
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
