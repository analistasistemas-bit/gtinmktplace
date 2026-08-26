import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { adminClient } from '../_shared/supabase.ts';
import { validarColunas, agruparPorPai, matchImagem, matchCapa, matchCapa2, matchCapa3, normalizarCodigo } from '../_shared/parser.ts';
import type { PlanilhaRow } from '../_shared/types.ts';
import { mapearLinha } from './mapear-linha.ts';
import { verificarOrigemInviolavel, exigirOrigemExplicita } from './verificar-origem.ts';
import { exigirFiscalExplicito, resolverCamposFiscais } from './verificar-fiscal.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { enfileirarFamilias } from '../_shared/queue.ts';
import { casarVariacoesUpdate, type VarAnterior } from '../_shared/update/casar.ts';
import { donoDoPathNaOrg, filtrarPathsDeDonos } from '../_shared/lote/exclusao.ts';
import { herdarPictureId } from '../_shared/update/heranca-foto.ts';
import { reconciliarCasamentoComML } from '../_shared/update/reconciliar.ts';
import { buscarVariacoesExistentesML } from '../_shared/ml/variacoes-existentes.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
// @deno-types="../_shared/vendor/xlsx.d.ts"
import * as XLSX from '../_shared/vendor/xlsx.mjs';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  let callerId: string, orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try {
    ({ userId: callerId, orgId } = context = await requireUserOrg(req, { access: 'write' }));
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

  // Escopo da operação (ADR-0047/0056): o lote pode ter sido criado por qualquer membro
  // DA MESMA ORG — daí o filtro por org_id e não por user_id. Sem ele, um lote_id de outro
  // tenant faria este handler (service_role, RLS desligada) baixar a planilha alheia e gravar
  // familias/variacoes sob a org da vítima com o user_id do chamador.
  const { data: lote, error: loteErr } = await admin
    .from('lotes')
    .select('*')
    .eq('id', lote_id)
    .eq('org_id', orgId)
    .single();
  if (loteErr || !lote) {
    return new Response(`Lote ${lote_id} não encontrado`, { status: 404, headers: corsHeaders });
  }

  // Numeração de lote por org (Task 14). O INSERT do lote é feito no cliente
  // (src/hooks/useUploadLote.ts) sem numero_org — e tem de ser assim: a RPC
  // proximo_numero_lote é service_role-only (revogada de authenticated). Este é o
  // 1º ponto server-side que toca o lote; atribui o número da org (idempotente).
  if (lote.numero_org == null) {
    const { data: numeroOrg } = await admin.rpc('proximo_numero_lote', { p_org: orgId });
    if (numeroOrg != null) {
      await admin.from('lotes').update({ numero_org: numeroOrg }).eq('id', lote.id);
      lote.numero_org = numeroOrg;
    }
  }

  if (lote.status !== 'importando') {
    await auditarOperacaoSuporte(admin, context, { type: 'lote', id: lote.id }, 'succeeded');
    return new Response(
      JSON.stringify({ loteId: lote.id, totalFamilias: lote.total_familias, jaProcessado: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (!lote.planilha_path) {
    return new Response('Lote sem planilha_path', { status: 400, headers: corsHeaders });
  }

  // Guard de posse cross-org (achado F2, CLAUDE-SECURITY-20260822-113640): planilha_path é
  // escrito pelo cliente e este download roda com service_role (RLS de storage não se
  // aplica). Comparar contra lote.user_id não bastaria — a coluna também é livre pro cliente
  // escrever no mesmo UPDATE que grava o path. Confia no 1º segmento só se o profile daquele
  // user_id for da MESMA org (qualquer membro pode operar o lote de outro — ADR-0047/0056).
  const uploaderCandidato = lote.planilha_path.split('/')[0] ?? '';
  const { data: uploaderProfile } = await admin
    .from('profiles')
    .select('org_id')
    .eq('id', uploaderCandidato)
    .maybeSingle();
  const donos = donoDoPathNaOrg(uploaderProfile?.org_id, orgId, uploaderCandidato);
  if (filtrarPathsDeDonos([lote.planilha_path], donos).length === 0) {
    return new Response('planilha_path inválido para esta organização', { status: 400, headers: corsHeaders });
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
    // ORIGEM explícita em todo PAI (ADR-0107): falha antes de qualquer trabalho, nada é persistido.
    exigirOrigemExplicita(rowsRaw);
    // ADR-0135: NCM obrigatório SÓ quando a org emite nota — org sem o módulo segue intacta.
    const moduloFiscal = await exigirModulo(admin, orgId, 'fiscal');
    if (moduloFiscal) exigirFiscalExplicito(rowsRaw);

    const rows: PlanilhaRow[] = rowsRaw.map(mapearLinha);

    const { grupos, anomalias } = agruparPorPai(rows);

    if (grupos.length === 0) {
      throw new Error('Nenhuma família com variação válida após descartar anomalias da planilha');
    }

    // Trava inviolável do imposto por origem (ADR-0055): aborta o lote (nada é persistido) se a
    // `origem` montada divergir da ORIGEM crua da planilha — nunca gravar imposto errado em silêncio.
    verificarOrigemInviolavel(rowsRaw, grupos);

    const codigosPai = grupos.map((g) => g.codigo_pai);
    // Escopo da operação (ADR-0056): buscar anteriores de TODA a operação por codigo_pai.
    // Com filtro por user.id, um membro não-dono não veria o anúncio já publicado por outro →
    // trataria como CREATE e DUPLICARIA o anúncio no ML. A operação compartilha os anúncios.
    // O limite da operação é a ORG (ADR-0056: "quando existir org_id, os filtros viram org_id"):
    // codigo_pai não é único entre tenants, então sem este filtro uma colisão traria ml_item_id,
    // preço e análise de concorrência de OUTRA org para dentro desta família.
    const { data: anteriores } = await admin
      .from('familias')
      .select('codigo_pai, ml_item_id, ml_permalink, titulo_ml, descricao_ml, categoria_ml_id, categoria_nome, atributos_ml, tipo_aviamento, capa_ml_picture_id, publicado_em, concorrencia_vendedores, concorrencia_preco_min, concorrencia_origem, concorrencia_classe, estrategia_preco, estrategia_motivo, analise_mercado, cest, origem_nfe, tributacao_icms, tributacao_icms_regime, variacoes(codigo, ml_variation_id, cor, cor_origem, ml_picture_id, estoque, preco_publicacao)')
      .in('codigo_pai', codigosPai)
      .eq('org_id', lote.org_id)
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
      // ADR-0135: campos fiscais só gravados na org com o módulo — sem ele, INSERT idêntico
      // ao de hoje (colunas ficam no DEFAULT/NULL da tabela). Opcionais herdam de `ant`
      // quando a célula vem vazia no re-ingest (ver `resolverCamposFiscais`).
      const fiscal = moduloFiscal ? resolverCamposFiscais(g, ant) : {};
      if (!ant) {
        // CREATE — comportamento atual.
        return {
          lote_id: lote.id, user_id: ownerUserId, org_id: lote.org_id, codigo_pai: g.codigo_pai,
          nome_pai: g.nome_pai, descricao_pai: g.descricao_pai, unidade: g.unidade,
          fornecedor: g.fornecedor,
          origem: g.origem,
          ...fiscal,
          operacao: 'CREATE', status: 'pendente',
          capa_storage_path: matchCapa(codigosFoto, lote.imagens_paths) ?? null,
          capa2_storage_path: matchCapa2(codigosFoto, lote.imagens_paths) ?? null,
          capa3_storage_path: matchCapa3(codigosFoto, lote.imagens_paths) ?? null,
        };
      }
      // UPDATE — herda metadados (exibição) + ml_item_id (publicação).
      const cas = casamentoPorPai.get(g.codigo_pai)!;
      const temCorNova = cas.mudancaEstrutural.novas.length > 0;
      const capaPath = matchCapa(codigosFoto, lote.imagens_paths) ?? null;
      return {
        lote_id: lote.id, user_id: ownerUserId, org_id: lote.org_id, codigo_pai: g.codigo_pai,
        nome_pai: g.nome_pai, descricao_pai: g.descricao_pai, unidade: g.unidade,
        fornecedor: g.fornecedor,
        origem: g.origem,
        ...fiscal,
        operacao: 'UPDATE',
        // Com cor nova: 'pendente' p/ o process-familia resolver a cor das novas (ADR-0004).
        // Sem cor nova: 'pronto' direto, sem IA.
        status: temCorNova ? 'pendente' : 'pronto',
        capa_storage_path: capaPath,
        capa2_storage_path: matchCapa2(codigosFoto, lote.imagens_paths) ?? null,
        capa3_storage_path: matchCapa3(codigosFoto, lote.imagens_paths) ?? null,
        ml_item_id: ant.ml_item_id,
        ml_permalink: ant.ml_permalink,
        titulo_ml: ant.titulo_ml,
        descricao_ml: ant.descricao_ml,
        categoria_ml_id: ant.categoria_ml_id,
        categoria_nome: ant.categoria_nome,
        atributos_ml: ant.atributos_ml,
        tipo_aviamento: ant.tipo_aviamento,
        // Só herda o picture_id sem capa nova neste re-ingest (path novo != foto cacheada
        // no ML sob o id antigo). Com capa nova, zera → força re-upload da atual (plano 031).
        capa_ml_picture_id: herdarPictureId(capaPath, ant.capa_ml_picture_id),
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
            // Mesma invariante da capa: imagem nova neste re-ingest zera o id herdado (plano 031).
            ml_picture_id: herdarPictureId(base.imagem_path, h?.ml_picture_id ?? null),
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

    // CREATE + UPDATE com cor nova precisam de IA. 1 batch (não 1 publish por família) —
    // lote #44 (3299 linhas) precisou de 1 requisição em vez de 18 pro enfileiramento.
    const pendentes = familiasCriadas.filter((f) => f.status === 'pendente');
    const temPendente = pendentes.length > 0;
    if (temPendente) {
      try {
        const messageIds = await enfileirarFamilias(pendentes.map((f) => ({ familia_id: f.id, lote_id: lote.id })));
        for (const [i, f] of pendentes.entries()) {
          await admin.from('familias').update({ qstash_message_id: messageIds[i] }).eq('id', f.id);
        }
      } catch (e) {
        // Achado no lote #44: sem isto, a família fica 'pendente' pra sempre — nada dispara
        // process-familia pra ela, e "Reenviar" (reprocessar-familia) só alcança família em
        // 'erro'. Marca só quem de fato não tem mensagem viva (um bloco anterior pode já ter
        // publicado antes deste bloco falhar — ver `enfileirados` em enfileirarFamilias).
        const enfileiradas = new Set(
          ((e as Error & { enfileirados?: { familia_id: string }[] }).enfileirados ?? []).map((j) => j.familia_id),
        );
        const orfas = pendentes.filter((f) => !enfileiradas.has(f.id));
        if (orfas.length > 0) {
          await admin
            .from('familias')
            .update({ status: 'erro', erro_mensagem: `Falha ao enfileirar: ${(e as Error).message}` })
            .in('id', orfas.map((f) => f.id))
            .eq('status', 'pendente');
        }
        throw e; // lote inteiro ainda vira 'erro' (comportamento existente, ver catch abaixo)
      }
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
    await auditarOperacaoSuporte(admin, context, { type: 'lote', id: lote.id }, 'failed');
    return new Response(`Falha no ingest: ${msg}`, { status: 500, headers: corsHeaders });
  }
});
