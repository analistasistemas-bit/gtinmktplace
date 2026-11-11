// ADR-0201 (Galeria da cor por IA) + ADR-0203 (imagem inteira do gerador): pedido de geração. Chamada pela tela com o
// JWT do operador (verify_jwt = true). POST {pedido_id, ml_item_id, cores, missoes, unit_cents_exibido, confirmar_troca?}.
// Ordem: gate do módulo → anúncio → repetição do mesmo pedido (devolve o que já existe) → cores → elegibilidade no ML
// (catálogo, conjunto da cor) → preço do mês → vigência e foto `frente` de cada cor → plano vigente (`garantirPlano`:
// reaproveita ou pede à IA) → posições indisponíveis → `galeria_reservar_pedido`. Nenhuma recusa reserva pedido; o plano
// (IA paga) só é pedido depois de elegibilidade, preço e referências passarem. Depois da reserva publica um job por
// imagem (otimização: o despachante retoma o que se perder). Só GET no ML; nunca escreve em anúncio.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { carregarAnuncio, coresDoAnuncio, resolverAnuncio } from '../_shared/galeria/anuncio.ts';
import { calcularVigencia } from '../_shared/galeria/referencias.ts';
import { type Missao, type Vista } from '../_shared/galeria/regras.ts';
import { garantirPlano, type AtributoML } from '../_shared/galeria/plano-vigente.ts';
import { resolverModeloGaleria } from '../_shared/galeria/provedores.ts';
import { resolverModeloTexto } from '../_shared/ai/modelos.ts';
import { planejarGeracoes, precoDoMes, type LinhaVaga } from '../_shared/galeria/pedido.ts';
import { alvosDaCor, lerElegibilidadeItemML, motivoElegibilidade, type ItemElegibilidade } from '../_shared/galeria/alvos.ts';
import { publicarJobs } from '../_shared/galeria/despacho.ts';
import { resolverConexaoEstrita } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { buscarItemBackfill } from '../_shared/ml/buscar-item.ts';
import { garantirFilaSerial, qstashClient } from '../_shared/queue.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUNAS_IMAGEM = 'id, cor, missao, geracao, status, origem, fase, tentativa, despacho_seq, request_id';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Ficha do anúncio no ML (só GET). Falha → null (o plano recusa `ml_indisponivel`, sem IA). */
async function lerFichaML(token: string, itemId: string | null): Promise<AtributoML[] | null> {
  if (!itemId) return null;
  try {
    const r = await fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}?attributes=attributes`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const j = await r.json() as { attributes?: unknown };
    return (Array.isArray(j.attributes) ? j.attributes : []).map((x: Record<string, unknown>) => ({
      id: String(x?.id ?? ''), name: String(x?.name ?? ''), value_name: typeof x?.value_name === 'string' ? x.value_name : null,
    }));
  } catch {
    return null;
  }
}

/** `path_from_root` da categoria (GET público, como o galeria-roteiro). Falha ou vazio → null (`categoria_indisponivel`). */
async function lerCategoria(id: string): Promise<Array<{ id: string }> | null> {
  try {
    const r = await fetch(`https://api.mercadolibre.com/categories/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const cat = await r.json() as { path_from_root?: unknown };
    return Array.isArray(cat.path_from_root) && cat.path_from_root.length > 0 ? cat.path_from_root as Array<{ id: string }> : null;
  } catch (e) {
    console.error('[galeria-gerar] categoria', (e as Error).message);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let auth: Awaited<ReturnType<typeof requireUserOrg>>;
  try { auth = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  const { orgId, userId } = auth;
  const admin = adminClient();
  // ADR-0201 §8: gerar exige o módulo imagem_ia (fail-closed).
  if (!(await exigirModulo(admin, orgId, 'imagem_ia'))) return json({ error: 'modulo_desligado' }, 403);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const pedidoId = typeof body.pedido_id === 'string' && UUID.test(body.pedido_id) ? body.pedido_id.toLowerCase() : null;
  const mlItemId = typeof body.ml_item_id === 'string' && body.ml_item_id.trim() !== '' && body.ml_item_id.length <= 40 ? body.ml_item_id.trim() : null;
  // Só `true` literal confirma a troca de plano (§9): qualquer outro valor é "não confirmou".
  const confirmarTroca = body.confirmar_troca === true;
  const cores = Array.isArray(body.cores) && body.cores.length > 0 && body.cores.every((c) => typeof c === 'string' && c.trim() !== '')
    ? [...new Set(body.cores as string[])] : null;
  const missoes = Array.isArray(body.missoes) && body.missoes.length > 0 && body.missoes.every((m) => Number.isInteger(m) && m >= 1 && m <= 7)
    ? [...new Set(body.missoes as Missao[])].sort() : null;
  const exibido = Number.isInteger(body.unit_cents_exibido) && (body.unit_cents_exibido as number) >= 0 ? body.unit_cents_exibido as number : null;
  if (!pedidoId || !mlItemId || !cores || !missoes || exibido === null) return json({ error: 'pedido_invalido' }, 400);

  try {
    const r = await resolverAnuncio(admin, orgId, mlItemId);
    if ('erro' in r) return json({ error: r.erro }, 409);
    const a = await carregarAnuncio(admin, orgId, r.anuncioId);
    if ('erro' in a) return json({ error: a.erro }, 409);

    // Repetição (timeout, recarga): o mesmo pedido devolve as linhas que já existem, sem conferir nada de novo e sem
    // cobrar de novo (R8.3). Pedido de outro anúncio/org → recusa.
    const { data: existente, error: eP } = await admin.from('galeria_pedidos').select('id, org_id, anuncio_externo_id').eq('id', pedidoId).maybeSingle();
    if (eP) throw new Error(eP.message);
    if (existente) {
      if (existente.org_id !== orgId || existente.anuncio_externo_id !== a.anuncioId) return json({ error: 'pedido_de_outro_anuncio' }, 409);
      const { data, error } = await admin.from('galeria_imagens').select(COLUNAS_IMAGEM).eq('pedido_id', pedidoId).eq('org_id', orgId);
      if (error) throw new Error(error.message);
      return json({ pedido_id: pedidoId, imagens: data ?? [] });
    }

    const doAnuncio = new Set(coresDoAnuncio(a));
    const corInvalida = cores.filter((c) => !doAnuncio.has(c));
    if (corInvalida.length > 0) return json({ error: 'cor_invalida', cores: corInvalida }, 400);

    // Elegibilidade no ML antes de qualquer custo (R0.2, ADR §5). Um GET por item, memoizado.
    const cx = await resolverConexaoEstrita(admin, orgId, 'mercado_livre');
    if (!cx) return json({ error: 'sem_conexao_ml' }, 409);
    const token = await getValidAccessTokenConexao(cx);
    const lidos = new Map<string, Promise<ItemElegibilidade | null>>();
    const lerItem = (id: string) => {
      if (!lidos.has(id)) lidos.set(id, lerElegibilidadeItemML(token, id));
      return lidos.get(id)!;
    };
    const leitor = { lerItem, lerBackfill: (id: string) => buscarItemBackfill(fetch, { accessToken: token }, id) };
    // GET que falhou (5xx/rede) não é catálogo nem conjunto incompleto: recusa retentável, sem pedido nem custo.
    // `catalogo_desconhecido` fica só para GET 200 sem o campo.
    const falhouGet = async () => (await Promise.all(lidos.values())).some((i) => i === null);
    let itemFicha: string | null = null; // 1º alvo da 1ª cor: dele sai a ficha do anúncio para o plano
    for (const cor of cores) {
      const alvos = await alvosDaCor(admin, orgId, a.anuncioId, cor, leitor);
      if (await falhouGet()) return json({ error: 'ml_indisponivel' }, 503);
      if ('erro' in alvos) return json({ error: alvos.erro, cor, detalhe: alvos.detalhe }, 409);
      itemFicha ??= alvos.alvos[0]?.itemId ?? null;
      for (const { itemId } of alvos.alvos) {
        const item = await lerItem(itemId);
        if (!item) return json({ error: 'ml_indisponivel' }, 503);
        const motivo = motivoElegibilidade(item);
        if (motivo) return json({ error: motivo, cor, item_id: itemId }, 409);
      }
    }

    // Preço do mês congelado no pedido; diferente do que a tela mostrou → nova confirmação.
    const { unitCents, termosId } = await precoDoMes(admin, orgId);
    if (unitCents !== exibido) return json({ error: 'preco_mudou', unit_cents: unitCents }, 409);

    // Vigência (fatos_hash e referências). Sem `conferir`: o gerar nunca paga visão da etiqueta.
    const v = await calcularVigencia(admin, orgId, a);
    // ADR-0203: o gerador recebe só a frente; toda cor pedida precisa dela antes de qualquer custo.
    const frente = (cor: string) => {
      const x = v.referencias[cor]?.frente;
      return x && !('erro' in x) ? x : null;
    };
    const semRef = cores.filter((c) => !frente(c));
    if (semRef.length > 0) return json({ error: 'sem_referencia', cores: semRef }, 409);

    const { data: assinada, error: eUrl } = await admin.storage.from('imagens').createSignedUrl(frente(cores[0])!.path, 600);
    if (eUrl || !assinada?.signedUrl) throw new Error(eUrl?.message ?? 'URL da referência não assinada');
    const g = await garantirPlano(admin, {
      orgId, userId, a, fatosHash: v.fatos_hash, refUrl: assinada.signedUrl, confirmarTroca,
      modelo: await resolverModeloTexto(admin, orgId),
      lerFichaML: () => lerFichaML(token, itemFicha),
      lerCategoria,
    });
    if ('erro' in g) {
      if (g.erro === 'plano_desatualizado') return json({ error: g.erro, imagens: g.imagens }, 409);
      return json({ error: g.erro }, g.erro === 'ml_indisponivel' || g.erro === 'categoria_indisponivel' ? 503 : 502);
    }
    const { roteiroId, moda } = g;
    const indisponiveis = missoes.filter((m) => g.plano.imagens.find((i) => i.posicao === m)?.indisponivel);
    if (indisponiveis.length > 0) return json({ error: 'posicao_indisponivel', missoes: indisponiveis }, 422);

    const vistasPorCor = Object.fromEntries(cores.map((c) => [c, ['frente' as Vista]]));
    const { data: linhas, error: eL } = await admin.from('galeria_imagens').select('roteiro_id, cor, missao, geracao, status, origem, erro')
      .eq('org_id', orgId).eq('anuncio_externo_id', a.anuncioId).in('cor', cores);
    if (eL) throw new Error(eL.message);
    const plano = planejarGeracoes({ roteiroId, cores, missoes, moda, vistasPorCor, linhas: (linhas ?? []) as LinhaVaga[] });
    if (plano.bloqueadas.length > 0) return json({ error: plano.bloqueadas[0].motivo, bloqueadas: plano.bloqueadas }, 409);

    const modelo = await resolverModeloGaleria(admin, orgId);
    // ADR-0203: todas as posições são do gerador; recorte aqui seria regra antiga voltando: falha sem reservar.
    if (plano.recortes.length > 0) throw new Error('recorte_inesperado');
    const itens = plano.novas.map(({ cor, missao }) => ({
      cor, missao, origem: 'gerador', referencia_id: frente(cor)!.id, modelo: modelo.slug, provedor: modelo.provedor,
    }));
    const { data: reservadas, error: eRes } = await admin.rpc('galeria_reservar_pedido', { p_pedido: {
      id: pedidoId, org_id: orgId, anuncio_externo_id: a.anuncioId, familia_id: a.vigente.id, roteiro_id: roteiroId,
      unit_cents: unitCents, terms_id: termosId, elegivel: termosId !== null, criado_por: userId, itens,
    } });
    if (eRes) {
      // Corrida com outro pedido do mesmo anúncio (a RPC serializa e confere de novo).
      if (eRes.code === 'P0001' && (eRes.message === 'em_andamento' || eRes.message === 'teto')) return json({ error: eRes.message }, 409);
      throw new Error(eRes.message);
    }
    const imagens = (reservadas ?? []) as Array<{ id: string; origem: string; status: string; fase: number; tentativa: number; despacho_seq: number }>;

    // Otimização: um job por imagem gerador agora; falha aqui só atrasa até o próximo tick do despachante.
    try {
      await publicarJobs(admin, imagens.filter((i) => i.origem === 'gerador' && i.status === 'pendente').map((i) => ({
        tipo: 'imagem' as const, id: i.id, fase: i.fase, tentativa: i.tentativa, despacho_seq: i.despacho_seq, acao: 'submeter' as const,
      })), {
        agora: new Date(), base: Deno.env.get('SUPABASE_URL')!,
        publicar: (msgs) => qstashClient().batchJSON(msgs as never) as never,
        garantirFila: garantirFilaSerial,
        enfileirar: async () => {},
      });
    } catch (e) {
      console.error('[galeria-gerar] publicar', (e as Error).message);
    }
    return json({ pedido_id: pedidoId, unit_cents: unitCents, imagens });
  } catch (e) {
    console.error('[galeria-gerar]', (e as Error).message);
    return json({ error: 'falha_interna' }, 500);
  }
});
