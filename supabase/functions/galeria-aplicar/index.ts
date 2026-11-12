// ADR-0201 (Galeria da cor por IA), Task 14: aplicar e reverter as fotos aprovadas num anúncio do ML. Chamada pela tela
// com o JWT do operador (verify_jwt = true); só admin (ADR-0060), senão 403. Escopo = a linha de Publicados clicada
// (`ml_item_id` → `anuncio_externo_id`; split: cada partição só alcança as aplicações dela). Ações:
// - preparar {ml_item_id, cor, modo}: trabalho novo — exige o roteiro aprovado da família vigente com o fatos_hash atual;
//   manifesto = aprovadas da cor nesse roteiro (com final_sha256); alvos + GET de cada item (catálogo, migração, formato,
//   plano de ida em seco: `limite`/`mudou`); grava a aplicação `preparada` com o retrato e os itens `pendente`. Nunca
//   escreve no ML. Devolve também a `previa` por MLB (fotos da cor hoje × depois, com a `secure_url` do mesmo GET e a
//   URL assinada do final aprovado); a prévia é só resposta, nada dela é gravado.
// - confirmar {ml_item_id, aplicacao_id}: `galeria_confirmar_aplicacao` (vigência, manifesto, escrita pendente, trava,
//   em_andamento — tudo ou nada numa transação), depois publica um job por item na fila do dono (otimização).
// - reverter {ml_item_id, aplicacao_id}: operação histórica (qualquer família do mesmo anúncio):
//   `galeria_iniciar_reversao` (trava, revertendo, aplicado → compensando, numa transação); o despachante executa.
// - estado {ml_item_id, aplicacao_id?}: somente leitura para a tela acompanhar a saga (aplicações do anúncio da linha,
//   mais novas primeiro, com o status e o erro de cada MLB). Não escreve nem chama o ML.
// Queda da edge depois de qualquer RPC deixa o estado coerente e retomável pelo despachante; antes dela, nada mudou.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { carregarAnuncio, resolverAnuncio } from '../_shared/galeria/anuncio.ts';
import { calcularVigencia } from '../_shared/galeria/referencias.ts';
import { alvosDaCor, lerElegibilidadeItemML, motivoElegibilidade, type ItemElegibilidade } from '../_shared/galeria/alvos.ts';
import { CORPO_MINIMO, fotosDaCorNoItem, planejarFotosItem } from '../_shared/galeria/aplicar.ts';
import { LIMITE_ITEM, LIMITE_VAR } from '../_shared/galeria/saga.ts';
import { publicarJobs, type Trabalho } from '../_shared/galeria/despacho.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { buscarItemBackfill } from '../_shared/ml/buscar-item.ts';
import { garantirFilaSerial, qstashClient } from '../_shared/queue.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Admin = ReturnType<typeof adminClient>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Otimização: um job por item na fila serial do dono da família (o despachante retoma o que se perder). */
async function publicarItens(admin: Admin, aplicacaoId: string, familiaId: string, status: string) {
  try {
    const [{ data: fam }, { data: itens }] = await Promise.all([
      admin.from('familias').select('user_id').eq('id', familiaId).maybeSingle(),
      admin.from('galeria_aplicacao_itens').select('id, fase, despacho_seq').eq('aplicacao_id', aplicacaoId).eq('status', status),
    ]);
    if (!fam?.user_id) return;
    const jobs: Trabalho[] = (itens ?? []).map((i: { id: string; fase: number; despacho_seq: number }) => ({
      tipo: 'aplicacao_item', id: i.id, fase: i.fase, tentativa: 0, despacho_seq: i.despacho_seq, acao: 'passo',
      userId: fam.user_id as string, aplicacaoId,
    }));
    await publicarJobs(admin, jobs, {
      agora: new Date(), base: Deno.env.get('SUPABASE_URL')!,
      publicar: (msgs) => qstashClient().batchJSON(msgs as never) as never,
      garantirFila: garantirFilaSerial,
      enfileirar: () => Promise.resolve(),
    });
  } catch (e) {
    console.error('[galeria-aplicar] publicar', (e as Error).message);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let auth: Awaited<ReturnType<typeof requireUserOrg>>;
  try { auth = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId, userId, isAdmin } = auth;
  if (!isAdmin) return json({ error: 'somente_admin' }, 403);
  const admin = adminClient();

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const acao = body.acao;
  const mlItemId = typeof body.ml_item_id === 'string' && body.ml_item_id.trim() !== '' && body.ml_item_id.length <= 40 ? body.ml_item_id.trim() : null;
  const aplicacaoId = typeof body.aplicacao_id === 'string' && UUID.test(body.aplicacao_id) ? body.aplicacao_id.toLowerCase() : null;
  const cor = typeof body.cor === 'string' && body.cor.trim() !== '' ? body.cor : null;
  const modo = body.modo === 'substituir' || body.modo === 'adicionar' ? body.modo : null;
  if (!mlItemId || !['preparar', 'confirmar', 'reverter', 'estado'].includes(acao as string)) return json({ error: 'pedido_invalido' }, 400);
  // ADR-0201 §8 (revisão geral): aplicar foto nova exige o módulo imagem_ia (fail-closed). Reverter e estado ficam fora:
  // desligar o módulo é o plano de volta e não pode prender no ML as fotos já aplicadas.
  if ((acao === 'preparar' || acao === 'confirmar') && !(await exigirModulo(admin, orgId, 'imagem_ia'))) {
    return json({ error: 'modulo_desligado' }, 403);
  }
  if (acao === 'preparar' ? !cor || !modo : acao !== 'estado' && !aplicacaoId) return json({ error: 'pedido_invalido' }, 400);

  try {
    const r = await resolverAnuncio(admin, orgId, mlItemId);
    if ('erro' in r) return json({ error: r.erro }, 409);

    if (acao === 'estado') {
      let q = admin.from('galeria_aplicacoes').select('id, cor, modo, status, manifesto')
        .eq('org_id', orgId).eq('anuncio_externo_id', r.anuncioId);
      if (aplicacaoId) q = q.eq('id', aplicacaoId);
      const { data: apls, error: eL } = await q.order('criado_em', { ascending: false }).limit(20);
      if (eL) throw new Error(eL.message);
      const ids = (apls ?? []).map((a: { id: string }) => a.id);
      const { data: its, error: eIt } = ids.length === 0 ? { data: [], error: null }
        : await admin.from('galeria_aplicacao_itens').select('aplicacao_id, item_id, status, erro, fotos_novas, put_em').eq('org_id', orgId).in('aplicacao_id', ids);
      if (eIt) throw new Error(eIt.message);
      type ItemEstado = { item_id: string; status: string; erro: string | null; fotos_novas: Array<{ pronta?: boolean }> | null; put_em: string | null };
      return json({ aplicacoes: (apls ?? []).map((a: { id: string; cor: string; modo: string; status: string; manifesto: unknown }) => ({
        id: a.id, cor: a.cor, modo: a.modo, status: a.status, manifesto: a.manifesto,
        itens: (its ?? []).filter((i: { aplicacao_id: string }) => i.aplicacao_id === a.id)
          .map((i: ItemEstado) => {
            // Progresso da ida para a tela; só contagens e flags (upload_id e corpo ficam no servidor).
            const fotos = Array.isArray(i.fotos_novas) ? i.fotos_novas : [];
            return { item_id: i.item_id, status: i.status, erro: i.erro,
              fotos_total: fotos.length, fotos_enviadas: fotos.filter((f) => f?.pronta === true).length,
              trocado: i.put_em != null,
              // `publicado_em` é o marcador do despacho (zerado a cada fase), não a conferência: conferido = item aplicado.
              conferido: i.status === 'aplicado' };
          }) })) });
    }

    if (acao !== 'preparar') {
      const { data: apl, error: eA } = await admin.from('galeria_aplicacoes').select('id, familia_id, status')
        .eq('org_id', orgId).eq('anuncio_externo_id', r.anuncioId).eq('id', aplicacaoId!).maybeSingle();
      if (eA) throw new Error(eA.message);
      if (!apl) return json({ error: 'nao_encontrada' }, 404);
      if (acao === 'reverter') {
        const { data: codigo, error } = await admin.rpc('galeria_iniciar_reversao',
          { p_org: orgId, p_familia: apl.familia_id, p_aplicacao: apl.id });
        if (error) throw new Error(error.message);
        if (codigo !== 'ok') return json({ error: codigo }, 409);
        await publicarItens(admin, apl.id, apl.familia_id, 'compensando');
        return json({ status: 'revertendo' });
      }
      // confirmar: trabalho novo → família vigente, roteiro aprovado e fatos_hash atuais (a RPC compara e trava).
      const a = await carregarAnuncio(admin, orgId, r.anuncioId);
      if ('erro' in a) return json({ error: a.erro }, 409);
      const { data: rot, error: eR } = await admin.from('galeria_roteiros').select('id')
        .eq('org_id', orgId).eq('anuncio_externo_id', r.anuncioId).eq('status', 'aprovado').maybeSingle();
      if (eR) throw new Error(eR.message);
      const v = await calcularVigencia(admin, orgId, a);
      const { data: codigo, error } = await admin.rpc('galeria_confirmar_aplicacao', {
        p_org: orgId, p_familia: a.vigente.id, p_aplicacao: apl.id, p_roteiro_id: rot?.id ?? null, p_fatos_hash: v.fatos_hash,
      });
      if (error) throw new Error(error.message);
      if (codigo !== 'ok') return json({ error: codigo }, 409);
      await publicarItens(admin, apl.id, apl.familia_id, 'pendente');
      return json({ status: 'em_andamento' });
    }

    // preparar
    const a = await carregarAnuncio(admin, orgId, r.anuncioId);
    if ('erro' in a) return json({ error: a.erro }, 409);
    const { data: rot, error: eR } = await admin.from('galeria_roteiros').select('id, familia_id, fatos_hash')
      .eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId).eq('status', 'aprovado').maybeSingle();
    if (eR) throw new Error(eR.message);
    if (!rot) return json({ error: 'roteiro_nao_aprovado' }, 409);
    if (rot.familia_id !== a.vigente.id) return json({ error: 'familia_nao_vigente', familia_id_vigente: a.vigente.id }, 409);
    const v = await calcularVigencia(admin, orgId, a);
    if (v.fatos_hash !== rot.fatos_hash) return json({ error: 'desatualizada' }, 409);

    // Manifesto congelado: aprovadas da cor no roteiro vigente, na ordem das missões, com o sha do final.
    const { data: aprovadas, error: eI } = await admin.from('galeria_imagens').select('id, missao, final_sha256, final_path')
      .eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId).eq('roteiro_id', rot.id).eq('cor', cor!).eq('status', 'aprovada');
    if (eI) throw new Error(eI.message);
    const ordenadas = ((aprovadas ?? []) as Array<{ id: string; missao: number; final_sha256: string | null; final_path: string | null }>)
      .sort((x, y) => x.missao - y.missao);
    const manifesto = ordenadas.map((i) => ({ imagem_id: i.id, missao: i.missao, final_sha256: i.final_sha256 }));
    if (manifesto.length === 0) return json({ error: 'sem_aprovadas' }, 409);
    if (manifesto.some((m) => !m.final_sha256)) return json({ error: 'sem_final' }, 409);

    const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
    if (!cx) return json({ error: 'sem_conexao_ml' }, 409);
    const token = await getValidAccessTokenConexao(cx);
    const lidos = new Map<string, Promise<ItemElegibilidade | null>>();
    const lerItem = (id: string) => {
      if (!lidos.has(id)) lidos.set(id, lerElegibilidadeItemML(token, id));
      return lidos.get(id)!;
    };
    const alvos = await alvosDaCor(admin, orgId, a.anuncioId, cor!, { lerItem, lerBackfill: (id) => buscarItemBackfill(fetch, { accessToken: token }, id) });
    if ((await Promise.all(lidos.values())).some((i) => i === null)) return json({ error: 'ml_indisponivel' }, 503);
    if ('erro' in alvos) return json({ error: alvos.erro, detalhe: alvos.detalhe }, 409);

    // Prévia: uma URL assinada por imagem aprovada (fora do loop de itens); falha → null e a tela mostra o espaço vazio.
    const urlNova = new Map<string, string | null>(await Promise.all(ordenadas.map(async (i) => {
      if (!i.final_path) return [`novo-${i.missao}`, null] as const;
      const { data, error } = await admin.storage.from('imagens').createSignedUrl(i.final_path, 600);
      return [`novo-${i.missao}`, error ? null : data?.signedUrl ?? null] as const;
    })));
    type Foto = { id: string; url: string | null };
    const previa: Array<{ item_id: string; variacoes: number; antes: Array<Foto & { sai: boolean }>; depois: Array<Foto & { nova: boolean; missao?: number }> }> = [];
    const retrato: Record<string, { pictures: string[]; variacoes: ItemElegibilidade['variacoes'] }> = {};
    const itens: Array<Record<string, unknown>> = [];
    const placeholders = manifesto.map((m) => ({ missao: m.missao, id: `novo-${m.missao}` }));
    for (const alvo of alvos.alvos) {
      const item = await lerItem(alvo.itemId);
      if (!item) return json({ error: 'ml_indisponivel' }, 503);
      const motivo = motivoElegibilidade(item) ?? (item.tags.includes('variations_migration_pending') ? 'migracao_pendente' : null);
      if (motivo) return json({ error: motivo, item_id: alvo.itemId }, 409);
      // Formato que exigiria quantidade no PUT de fotos fica bloqueado (ensaio da Task 1: nenhum exige hoje).
      const formato = item.variacoes.length > 0 ? CORPO_MINIMO.legacy : CORPO_MINIMO.plano;
      if ((formato as readonly string[]).includes('available_quantity')) return json({ error: 'formato_bloqueado', item_id: alvo.itemId }, 409);
      const antes = fotosDaCorNoItem(item, alvo.variacoes);
      if (!antes) return json({ error: 'variacao_nao_casa', item_id: alvo.itemId }, 409);
      // Plano de ida em seco: `limite` (a tela oferece Substituir) e qualquer recusa antes de gravar.
      const seco = planejarFotosItem({ direcao: 'ida', atual: item, retrato: item, variacoesAlvo: alvo.variacoes,
        fotosDaCor: placeholders, capaAprovada: manifesto.some((m) => m.missao === 1), modo: modo!, limiteVar: LIMITE_VAR, limiteItem: LIMITE_ITEM });
      if (!seco.ok) return json({ error: seco.motivo, item_id: alvo.itemId, detalhe: seco.detalhe }, 409);
      // ponytail: prévia pela 1ª variação-alvo do item; as demais SKUs da cor costumam ter as mesmas fotos.
      const v0 = alvo.variacoes[0];
      const depoisIds = v0.variationId === null ? seco.corpo.pictures.map((p) => p.id)
        : seco.corpo.variations?.find((x) => x.id === v0.variationId)?.picture_ids ?? [];
      previa.push({
        item_id: alvo.itemId,
        // Confirmar altera todas as variações da cor neste MLB; a prévia mostra só a primeira.
        variacoes: alvo.variacoes.length,
        antes: antes[v0.sku].map((id) => ({ id, url: item.urls?.[id] ?? null, sai: !depoisIds.includes(id) })),
        depois: depoisIds.map((id) => {
          const missao = /^novo-(\d+)$/.exec(id)?.[1];
          return missao ? { id, url: urlNova.get(id) ?? null, nova: true, missao: Number(missao) } : { id, url: item.urls?.[id] ?? null, nova: false };
        }),
      });
      retrato[alvo.itemId] = { pictures: item.pictures, variacoes: item.variacoes };
      itens.push({
        org_id: orgId, anuncio_externo_id: a.anuncioId, item_id: alvo.itemId, variacoes_alvo: alvo.variacoes, fotos_antes: antes,
        fotos_novas: manifesto.map((m) => ({ ...m, upload_id: null, pronta: false })),
      });
    }

    const { data: apl, error: eAp } = await admin.from('galeria_aplicacoes').insert({
      org_id: orgId, anuncio_externo_id: a.anuncioId, familia_id: a.vigente.id, cor, modo, retrato, manifesto,
      roteiro_id: rot.id, fatos_hash: rot.fatos_hash, status: 'preparada', aplicado_por: userId,
    }).select('id').single();
    if (eAp || !apl) throw new Error(eAp?.message ?? 'aplicação não gravada');
    const { error: eIt } = await admin.from('galeria_aplicacao_itens').insert(itens.map((i) => ({ ...i, aplicacao_id: apl.id })));
    if (eIt) {
      // `preparada` sem itens nunca executa, mas não deve sobrar: desfaz (melhor esforço) e falha.
      await admin.from('galeria_aplicacoes').delete().eq('id', apl.id).eq('status', 'preparada');
      throw new Error(eIt.message);
    }
    return json({ aplicacao_id: apl.id, status: 'preparada', itens: itens.map((i) => i.item_id), manifesto, previa });
  } catch (e) {
    console.error('[galeria-aplicar]', acao, (e as Error).message);
    return json({ error: 'falha_interna' }, 500);
  }
});
