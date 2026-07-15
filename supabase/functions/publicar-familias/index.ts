import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabase.ts';
import {
  enfileirarPublicacao, enfileirarAtualizacao, enfileirarSplit, garantirFilaSerial,
  enfileirarPublicacaoCanal,
} from '../_shared/queue.ts';
import { MAX_VARIACOES_ML } from '../_shared/split/particionar.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { garantirAnuncioExterno, claimAnuncioExterno } from '../_shared/anuncios/estado.ts';
import { separarCanais } from '../_shared/canais/selecao.ts';
import { resolverSomenteEstoque } from './somente-estoque.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  // Gate de auth: membro autenticado da operação (ADR-0047/0056) + org (E7).
  let userId: string, orgId: string;
  try { ({ userId, orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { familia_ids, listing_type_id, canais, somente_estoque_global, somente_estoque_overrides } = await req.json().catch(() => ({}));
  if (!Array.isArray(familia_ids) || familia_ids.length === 0) {
    return new Response('familia_ids obrigatório', { status: 400, headers: corsHeaders });
  }
  // Clássico (default) ou Premium; ignora qualquer outro valor.
  const listingType = listing_type_id === 'gold_pro' ? 'gold_pro' : 'gold_special';
  // ADR-0078 F1: escolha "somente estoque" da operação (global) + overrides por família que
  // invertem o global. Sem os campos → default false → comportamento 100% atual (preço propaga).
  const somenteEstoqueGlobal: boolean = somente_estoque_global ?? false;
  const somenteEstoqueOverrides: string[] = somente_estoque_overrides ?? [];
  // Canais a publicar (E6). Default ['mercado_livre'] → chamadas atuais 100% compatíveis.
  const { incluiML, extras: canaisExtras } = separarCanais(canais);

  const admin = adminClient();
  let enfileiradas = 0;
  let loteId: string | null = null;

  // ─── Caminho ML (intocado — roda quando 'mercado_livre' está entre os canais) ───────────
  if (incluiML) {
    // Claim CREATE: 'pronto'/'erro', ainda não publicado. Escopo da operação (sem filtro por
    // user.id): qualquer membro publica as famílias selecionadas (ADR-0047/0056).
    const { data: novos, error: errC } = await admin
      .from('familias')
      .update({ status: 'publicando', erro_mensagem: null })
      .in('id', familia_ids)
      .eq('operacao', 'CREATE')
      .in('status', ['pronto', 'erro'])
      .is('ml_item_id', null)
      .eq('org_id', orgId)
      .select('id, lote_id, user_id');
    if (errC) return new Response(`Erro no claim CREATE: ${errC.message}`, { status: 500, headers: corsHeaders });

    // Claim UPDATE: 'pronto'/'erro', já publicado (tem ml_item_id herdado).
    const { data: updates, error: errU } = await admin
      .from('familias')
      .update({ status: 'publicando', erro_mensagem: null })
      .in('id', familia_ids)
      .eq('operacao', 'UPDATE')
      .in('status', ['pronto', 'erro'])
      .not('ml_item_id', 'is', null)
      .eq('org_id', orgId)
      .select('id, lote_id, user_id');
    if (errU) return new Response(`Erro no claim UPDATE: ${errU.message}`, { status: 500, headers: corsHeaders });

    // Serializa as escritas no ML por CONTA de vendedor (ADR-0034): parallelism=1 evita
    // publicações concorrentes que tornam o processamento de foto do ML lento. A fila é keyed
    // pelo dono da família (familias.user_id = conta ML da operação, ADR-0056) — o mesmo id que
    // o worker usa para resolver o token —, não pelo chamador. Publica uma de cada vez.
    const donos = [...new Set([...(novos ?? []), ...(updates ?? [])].map((f) => f.user_id as string))];
    for (const dono of donos) {
      await garantirFilaSerial(dono);
    }

    // Split (ADR-0048): família com >100 cores incluídas vai para o worker de split (N anúncios),
    // tanto no CREATE quanto no UPDATE. ≤100 segue o caminho normal (publish/update), intocado.
    const idsParaEnfileirar = [...(novos ?? []), ...(updates ?? [])].map((f) => f.id);
    const coresPorFamilia = new Map<string, number>();
    if (idsParaEnfileirar.length > 0) {
      const { data: vrs } = await admin.from('variacoes')
        .select('familia_id').in('familia_id', idsParaEnfileirar).eq('excluida_da_publicacao', false);
      for (const v of vrs ?? []) coresPorFamilia.set(v.familia_id, (coresPorFamilia.get(v.familia_id) ?? 0) + 1);
    }
    const ehSplit = (familiaId: string) => (coresPorFamilia.get(familiaId) ?? 0) > MAX_VARIACOES_ML;

    for (const f of novos ?? []) {
      const job = { familia_id: f.id, lote_id: f.lote_id, listing_type_id: listingType };
      const messageId = ehSplit(f.id)
        ? await enfileirarSplit(job, f.user_id as string)
        : await enfileirarPublicacao(job, f.user_id as string);
      await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
      loteId = f.lote_id;
      enfileiradas++;
    }
    for (const f of updates ?? []) {
      // ADR-0078 F1: propaga a escolha "somente estoque" resolvida por família (global±override).
      const somenteEstoque = resolverSomenteEstoque(f.id, somenteEstoqueGlobal, somenteEstoqueOverrides);
      const messageId = ehSplit(f.id)
        ? await enfileirarSplit({ familia_id: f.id, lote_id: f.lote_id, listing_type_id: listingType, somenteEstoque }, f.user_id as string)
        : await enfileirarAtualizacao({ familia_id: f.id, lote_id: f.lote_id, somenteEstoque }, f.user_id as string);
      await admin.from('familias').update({ qstash_message_id: messageId }).eq('id', f.id);
      loteId = f.lote_id;
      enfileiradas++;
    }
    if (loteId) {
      await admin.from('lotes').update({ status: 'publicando' }).eq('id', loteId);
    }
  }

  // ─── Fan-out dos canais ≠ ML (E6/ADR-0061): cada (família, canal) tem claim próprio na
  //     linha de anuncios_externos; falha de um canal nunca toca outro nem o fluxo ML. ─────
  const porCanal: Record<string, number> = {};
  const canaisIgnorados: string[] = [];
  if (canaisExtras.length > 0) {
    // Elegibilidade por canal é do claim da linha do canal, não do familias.status: carrega
    // TODAS as famílias pedidas (codigo_pai é a identidade por canal).
    const { data: familiasAlvo } = await admin.from('familias')
      .select('id, lote_id, codigo_pai').in('id', familia_ids).eq('org_id', orgId);
    for (const canal of canaisExtras) {
      const conexao = await resolverConexao(admin, orgId, canal);
      if (!conexao) { canaisIgnorados.push(canal); continue; } // org não conectou o canal
      for (const familia of familiasAlvo ?? []) {
        await garantirAnuncioExterno(admin, { orgId, userId, canal, codigoPai: familia.codigo_pai as string });
        const claim = await claimAnuncioExterno(admin, { orgId, canal, codigoPai: familia.codigo_pai as string });
        if (!claim) continue; // já publicando/publicado nesse canal (idempotência)
        const messageId = await enfileirarPublicacaoCanal(
          { familia_id: familia.id as string, lote_id: familia.lote_id as string, canal }, orgId,
        );
        await admin.from('anuncios_externos').update({ qstash_message_id: messageId })
          .eq('org_id', orgId).eq('canal', canal).eq('codigo_pai', familia.codigo_pai as string).eq('particao', 0);
        porCanal[canal] = (porCanal[canal] ?? 0) + 1;
        enfileiradas++;
      }
    }
  }

  return new Response(JSON.stringify({ enfileiradas, porCanal, canaisIgnorados }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
