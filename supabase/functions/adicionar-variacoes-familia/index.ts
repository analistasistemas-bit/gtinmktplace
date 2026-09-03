// ADR-0129 — Adicionar variação a família publicada, direto da tela Estoque. Admin monta um
// lote real de UPDATE clonando a família publicada mais recente + suas variações vivas, insere
// N variações novas digitadas (foto já no storage), registra o estoque inicial pelo ledger e
// encadeia `publicar-familias` — o pipeline de UPDATE existente decide Legacy vs. User Products
// e enfileira o worker (process-familia/update-familia-ml não mudam uma linha). Ver
// docs/decisions/0129-adicionar-variacao-a-familia-publicada.md.
//
// Desvio 1 do plano: o sketch do ADR ("enfileira via enfileirarFamilias") levaria a
// process-familia, que para UPDATE só resolve cor e marca 'pronto' — o lote ficaria parado
// esperando clique manual na Revisão, violando D-10 (este lote NUNCA passa por Revisão).
// Encadeamos publicar-familias (fetch server-to-server com o MESMO JWT do chamador) em vez
// disso; as decisões D-1…D-11 do ADR continuam valendo, só o helper de enfileiramento muda.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { codigosJaUsados } from '../_shared/produto/codigos.ts';
import {
  clonarFamilia, clonarVariacao, montarVariacaoNova, normalizarCodigo8,
  precoPublicacaoNova, validarEntrada, type VariacaoNovaEntrada,
} from './processar.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const CODIGO_8_DIGITOS = /^[0-9]{8}$/;

// Encadeia publicar-familias com o JWT do chamador. `resp.ok` sozinho é falso positivo: o claim
// de lá (status in ('pronto','erro'), ml_item_id not null) pode não casar nada e a edge ainda
// devolve 200 com `enfileiradas: 0` — mesmo risco de "200 não prova canal atualizado" do push
// de estoque no ML. Idempotente: o claim de publicar-familias só pega famílias 'pronto'/'erro',
// então repetir a chamada num retry nunca duplica publicação.
async function encadearPublicacao(authorization: string, familiaId: string): Promise<boolean> {
  try {
    const resp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/publicar-familias`, {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ familia_ids: [familiaId] }),
    });
    const corpo = await resp.json().catch(() => null) as { enfileiradas?: number } | null;
    return resp.ok && Number(corpo?.enfileiradas ?? 0) > 0;
  } catch (e) {
    console.error('adicionar_variacoes_familia_publicar_falhou', { familiaId, erro: String(e) });
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let userId: string, orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try { ({ userId, orgId } = context = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();

  // Gate admin (D-7/ADR-0060/ADR-0047): esconder o item de menu é navegação, não fronteira de
  // segurança — mesmo padrão de atualizar-status-publicado/index.ts:12-24. Adicionar variação
  // muda a composição de um anúncio já publicado: mesma classe de risco do pausar/reativar.
  if (!context.isAdmin && context.support?.scope !== 'full') {
    await auditarOperacaoSuporte(admin, context, { type: 'org', id: orgId }, 'denied');
    return json({ error: 'Somente administradores podem executar esta ação' }, 403);
  }

  if (!(await exigirModulo(admin, orgId, 'estoque'))) {
    return json({ error: 'Módulo de estoque não habilitado para esta organização.' }, 403);
  }

  let body: { familia_id?: unknown; chave?: unknown; variacoes?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const erros = validarEntrada(body, userId);
  if (erros.length > 0) return json({ erros }, 400);
  const familiaIdRecebida = body.familia_id as string;
  const chave = body.chave as string;
  const variacoesEntrada = body.variacoes as VariacaoNovaEntrada[];

  const target = { type: 'familia', id: familiaIdRecebida };

  // Idempotência (mesmo padrão de cadastrar-produto/index.ts:58-60): um retry de rede reusa o
  // que já foi gravado em vez de duplicar família, estoque ou publicação. Se a família ainda
  // está 'pronto', a 1ª tentativa morreu ANTES de encadear a publicação — re-encadeia aqui em
  // vez de fabricar `publicacaoOk: true` (o claim de publicar-familias é idempotente, só pega
  // 'pronto'/'erro'; família já 'publicando'/'publicado' vira no-op e reportamos true, que aí
  // é observação, não previsão).
  const { data: jaExistente } = await admin.from('familias')
    .select('id, lote_id, status').eq('org_id', orgId).eq('chave_cadastro', chave).maybeSingle();
  if (jaExistente) {
    let publicacaoOk = true;
    if (jaExistente.status === 'pronto') {
      publicacaoOk = await encadearPublicacao(req.headers.get('Authorization')!, jaExistente.id as string);
      await admin.from('lotes')
        .update({ status: publicacaoOk ? 'publicando' : 'revisao' })
        .eq('id', jaExistente.lote_id as string);
    }
    return json({
      jaExistia: true, familiaId: jaExistente.id, loteId: jaExistente.lote_id,
      publicacaoOk, falhasEstoque: [],
    });
  }

  // Resolve codigo_pai a partir da família canônica que a tela Estoque conhece (valida org).
  const { data: familiaRecebida } = await admin.from('familias')
    .select('codigo_pai').eq('id', familiaIdRecebida).eq('org_id', orgId).maybeSingle();
  if (!familiaRecebida) {
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: 'Produto não encontrado.' }, 404);
  }
  const codigoPai = familiaRecebida.codigo_pai as string;

  // Anterior = família mais recente já publicada no ML por (org_id, codigo_pai) — mesma
  // resolução e MESMA ordenação de ingest-lote/index.ts:117-123 (`publicado_em desc,
  // nullsFirst: false`, não `criado_em`): uma tentativa de UPDATE que falhou DEPOIS da última
  // publicação tem ml_item_id herdado mas publicado_em ainda null — `criado_em desc` clonaria
  // essa família errada (que não reflete o anúncio vivo no ML). Em duas queries simples
  // (família, depois variações) em vez do embed usado lá.
  const { data: anterior } = await admin.from('familias').select('*')
    .eq('org_id', orgId).eq('codigo_pai', codigoPai).not('ml_item_id', 'is', null)
    .order('publicado_em', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (!anterior) {
    return json({ error: 'Família ainda não publicada no Mercado Livre.' }, 409);
  }
  const { data: variacoesVivas, error: errVivas } = await admin.from('variacoes')
    .select('*').eq('familia_id', anterior.id as string);
  if (errVivas) {
    return json({ error: `Falha lendo variações da família publicada: ${errVivas.message}` }, 500);
  }

  // Os guards de banco (20260804113000) rejeitariam com erro cru — valida antes e explica.
  if (!CODIGO_8_DIGITOS.test(codigoPai) || (variacoesVivas ?? []).some((v) => !CODIGO_8_DIGITOS.test(v.codigo as string))) {
    return json({ error: 'Produto com código fora do padrão de 8 dígitos — não é possível atualizar por este fluxo.' }, 409);
  }

  // D-8: recusa se já existe família NÃO-TERMINAL para este codigo_pai (lote em voo) — dois
  // lotes da mesma família em voo é a receita para o race condition que o ADR-0104 já trata
  // como risco de composição.
  const { data: emVoo } = await admin.from('familias').select('id')
    .eq('org_id', orgId).eq('codigo_pai', codigoPai)
    .not('status', 'in', '("publicado","erro")').limit(1);
  if (emVoo && emVoo.length > 0) {
    return json({ error: 'Já existe uma atualização em andamento para este produto.' }, 409);
  }

  // D-5: unicidade de SKU org-wide para os códigos NOVOS digitados (as variações clonadas já
  // existem no banco — checá-las de novo acusaria colisão consigo mesmas).
  const codigosNovos = variacoesEntrada.map((v) => normalizarCodigo8(v.codigo)!);
  const conflitos = await codigosJaUsados(admin, orgId, codigosNovos);
  if (conflitos.length > 0) {
    return json({ error: 'Código já usado por outro produto nesta organização.', conflitos }, 409);
  }

  // Estoque canônico: a família mais recente por codigo_pai (qualquer status) pode ser mais
  // nova que `anterior` (ex.: uma tentativa de UPDATE anterior terminou em 'erro' DEPOIS da
  // última publicada) — é ela que reflete o saldo vivo mostrado na tela Estoque
  // (produtos_estoque_resumo, 20260814181410, também resolve pela família mais recente).
  const { data: maisRecente } = await admin.from('familias').select('id')
    .eq('org_id', orgId).eq('codigo_pai', codigoPai)
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();
  let estoquePorCodigo = new Map<string, number>(
    (variacoesVivas ?? []).map((v) => [v.codigo as string, v.estoque as number]),
  );
  if (maisRecente && maisRecente.id !== anterior.id) {
    const { data: varsCanonicas, error: errCanon } = await admin.from('variacoes')
      .select('codigo, estoque').eq('familia_id', maisRecente.id as string);
    if (errCanon) return json({ error: `Falha lendo estoque canônico: ${errCanon.message}` }, 500);
    estoquePorCodigo = new Map((varsCanonicas ?? []).map((v) => [v.codigo as string, v.estoque as number]));
  }

  // Lote nasce em 'publicando' de propósito (D-10/critério de aceite 8): NUNCA aparece na fila
  // de Revisão. Se o encadeamento da publicação mais abaixo falhar, rebaixamos para 'revisao'
  // só como rota de recuperação visível na tela Lotes.
  const { data: loteNovo, error: loteErr } = await admin.from('lotes')
    .insert({ user_id: userId, org_id: orgId, status: 'publicando', origem: 'manual' })
    .select('id').single();
  if (loteErr || !loteNovo) {
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: 'Falha criando lote de atualização.' }, 500);
  }
  const loteId = loteNovo.id as string;
  const { data: numeroOrg } = await admin.rpc('proximo_numero_lote', { p_org: orgId });
  if (numeroOrg != null) await admin.from('lotes').update({ numero_org: numeroOrg }).eq('id', loteId);

  const familiaClonada = clonarFamilia(anterior as Record<string, unknown>, { loteId, userId, chave });
  // mudanca_estrutural é próprio DESTA submissão, não da família antiga (STRIP_FAMILIA remove o
  // valor herdado): novas = os códigos digitados agora; removidas = [] (este fluxo só adiciona
  // cor, nunca remove — D-1 do ADR). O único consumidor hoje (src/components/familia-row.tsx,
  // contagem "removidas" da Revisão) nem alcança esta família (D-10), mas o campo fica coerente
  // em vez de arrastar o diff de um re-ingest antigo e não relacionado a esta submissão.
  familiaClonada.mudanca_estrutural = { novas: codigosNovos, removidas: [] };

  const { data: familiaCriada, error: famErr } = await admin.from('familias')
    .insert(familiaClonada).select('id').single();
  if (famErr) {
    // Mesmo discriminador por DADO do cadastrar-produto/index.ts:198-208: 23505 pode ser a
    // corrida de idempotência (mesma chave) OU outra unique — só a primeira é "tente novamente".
    // Lote recém-criado sem família é lixo (dedicado a esta submissão, nada mais o referencia) —
    // sem o delete ele ficava vazio e preso em 'publicando' na tela Lotes.
    await admin.from('lotes').delete().eq('id', loteId);
    if (famErr.code === '23505') {
      const { data: mesmaChave } = await admin.from('familias')
        .select('id').eq('org_id', orgId).eq('chave_cadastro', chave).maybeSingle();
      if (mesmaChave) return json({ error: 'Solicitação em andamento. Tente novamente.' }, 409);
    }
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: famErr.message }, 500);
  }
  const familiaId = familiaCriada.id as string;

  const clonesVariacoes = (variacoesVivas ?? []).map((v) => clonarVariacao(
    v as Record<string, unknown>,
    { familiaId, userId, estoqueCanonico: estoquePorCodigo.get(v.codigo as string) },
  ));
  const irmasParaPreco = clonesVariacoes as unknown as
    { preco_publicacao: number | null; excluida_da_publicacao: boolean }[];
  const novasVariacoes = variacoesEntrada.map((v) => montarVariacaoNova(
    { ...v, codigo: normalizarCodigo8(v.codigo)! },
    { familiaId, userId, orgId, precoPublicacao: precoPublicacaoNova(irmasParaPreco, v.preco) },
  ));

  // Falha aqui derruba a família criada (padrão cadastrar-produto/index.ts:218-221): família
  // sem variação é lixo — não deixar estado parcial visível na tela.
  //
  // Insert multi-row com DUAS origens de linha: só é seguro porque `clonarVariacao` e
  // `montarVariacaoNova` produzem o MESMO conjunto de chaves (invariante documentado em
  // processar.ts e travado por teste). Chave presente em uma origem e ausente na outra vira
  // NULL explícito na linha que não a tem — não o DEFAULT da coluna — e estoura nas NOT NULL.
  const { error: varErr } = await admin.from('variacoes').insert([...clonesVariacoes, ...novasVariacoes]);
  if (varErr) {
    await admin.from('familias').delete().eq('id', familiaId);
    // Mesma limpeza do famErr acima: lote dedicado sem família não deve sobrar na tela Lotes.
    await admin.from('lotes').delete().eq('id', loteId);
    await auditarOperacaoSuporte(admin, context, target, 'failed');
    return json({ error: varErr.message }, 500);
  }

  // Ledger: estoque inicial de cada cor nova (mesmo padrão de cadastrar-produto/index.ts:253-263,
  // ref. `addvar:{familiaId}:{codigo}` própria desta feature). Falha aqui NÃO aborta — família e
  // variações já existem; o operador vê `falhasEstoque` e repõe manualmente pela tela Estoque.
  const falhasEstoque: string[] = [];
  for (const v of variacoesEntrada) {
    const codigo = normalizarCodigo8(v.codigo)!;
    const { error } = await admin.rpc('registrar_entrada', {
      p_org: orgId, p_codigo: codigo, p_qtd: v.estoqueInicial,
      p_custo: v.custo ?? null, p_doc: 'Variação adicionada', p_obs: null,
      p_criado_por: userId, p_ref: `addvar:${familiaId}:${codigo}`,
    });
    if (error) falhasEstoque.push(`${codigo}: ${error.message}`);
  }

  // Encadeia publicar-familias (desvio 1) — server-to-server, JWT do chamador encaminhado (a
  // edge de destino faz o próprio requireUserOrg, então autorização não é perdida no repasse).
  // NÃO enviamos somente_estoque_*: adicionar variação é mudança de COMPOSIÇÃO do anúncio, não
  // reposição — o invariante do ADR-0104 §4 ("mudança de composição só roda pelo caminho
  // 'Atualizar tudo'") exige o caminho completo de UPDATE. Mesmo assim as cores JÁ publicadas
  // não são tocadas (nem preço, nem estoque, nem nome de cor): o worker deriva isso do lote
  // `origem='manual'` (`_shared/update/fluxo-add-variacao.ts`) e só escreve a cor nova.
  const publicacaoOk = await encadearPublicacao(req.headers.get('Authorization')!, familiaId);
  if (!publicacaoOk) {
    // Rota de recuperação: o lote fica visível (e reenviável) na tela Lotes em vez de preso,
    // invisível, em 'publicando' para sempre.
    await admin.from('lotes').update({ status: 'revisao' }).eq('id', loteId);
  }

  await auditarOperacaoSuporte(admin, context, { type: 'familia', id: familiaId }, 'succeeded');
  return json({ loteId, familiaId, publicacaoOk, falhasEstoque });
});
