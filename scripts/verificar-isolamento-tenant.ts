/**
 * Prova executável de isolamento multi-tenant (E7 / ADR-0027).
 *
 * Hermética: cria DUAS organizações sintéticas (A e B), cada uma com seu usuário
 * e 1 linha por tabela de domínio, e prova que o usuário de A não enxerga NADA de
 * B e vice-versa (SELECT, escrita cruzada e Storage). Não depende de dados reais —
 * roda idêntico no Supabase local (ensaio) e em produção. Limpa tudo no finally.
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
 *     pnpm tsx scripts/verificar-isolamento-tenant.ts [--skip-edges]
 *
 * Exit 1 em QUALQUER vazamento. Gate permanente: re-rodar após toda migration.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const SKIP_EDGES = process.argv.includes('--skip-edges');

if (!URL || !SERVICE || !ANON) {
  console.error('Faltam envs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (ou VITE_*).');
  process.exit(2);
}

const TABELAS = [
  'lotes', 'familias', 'variacoes', 'anuncios_externos', 'ml_credentials', 'ml_vendas',
  'ml_vendas_itens', 'ml_perguntas', 'ml_devolucoes', 'ml_moderacao', 'ml_webhook_eventos', 'configuracoes',
];

type Resultado = { assercao: string; status: 'PASS' | 'FAIL'; detalhe: string };
const resultados: Resultado[] = [];
function assert(cond: boolean, assercao: string, detalhe = '') {
  resultados.push({ assercao, status: cond ? 'PASS' : 'FAIL', detalhe: cond ? '' : detalhe });
}

const svc = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

/** cria org + usuário (via admin) + seed de 1 linha por tabela. Retorna ids p/ cleanup. */
async function criarTenant(tag: string) {
  const email = `e7-iso-${tag}-${Date.now()}@teste.invalid`;
  const senha = `Iso!${randomUUID().slice(0, 12)}`;

  const { data: org, error: orgErr } = await svc.from('organizations')
    .insert({ nome: `Org ${tag}`, slug: `e7-iso-${tag}-${Date.now()}` }).select('id').single();
  if (orgErr || !org) throw new Error(`criar org ${tag}: ${orgErr?.message}`);
  const orgId = org.id as string;

  const { data: created, error: userErr } = await svc.auth.admin.createUser({
    email, password: senha, email_confirm: true,
    user_metadata: { nome: `Iso ${tag}`, org_id: orgId, allowed_menus: [] },
  });
  if (userErr || !created.user) throw new Error(`criar user ${tag}: ${userErr?.message}`);
  const userId = created.user.id;

  // Garante profile com a org (o trigger handle_new_user deveria ter feito; reforça).
  await svc.from('profiles').update({ org_id: orgId, is_active: true }).eq('id', userId);

  // Seed: 1 linha por tabela (cadeia lote→familia→variacao; venda→item).
  const { data: lote } = await svc.from('lotes').insert({ user_id: userId, org_id: orgId, numero: Date.now() % 2000000000 }).select('id').single();
  const { data: fam } = await svc.from('familias').insert({ lote_id: lote!.id, user_id: userId, org_id: orgId, codigo_pai: `PAI${tag}`, nome_pai: `Fam ${tag}`, operacao: 'CREATE' }).select('id').single();
  await svc.from('variacoes').insert({ familia_id: fam!.id, user_id: userId, org_id: orgId, codigo: `V${tag}`, preco: 10 });
  await svc.from('anuncios_externos').insert({ user_id: userId, org_id: orgId, canal: 'mercado_livre', codigo_pai: `PAI${tag}` });
  await svc.from('ml_credentials').insert({ user_id: userId, org_id: orgId, ml_user_id: `ml-${tag}-${Date.now()}`, expires_at: new Date(Date.now() + 3600e3).toISOString(), access_token_secret_id: randomUUID(), refresh_token_secret_id: randomUUID() });
  const { data: venda } = await svc.from('ml_vendas').insert({ user_id: userId, org_id: orgId, order_id: Date.now() % 2000000000, status: 'paid' }).select('id').single();
  await svc.from('ml_vendas_itens').insert({ user_id: userId, org_id: orgId, venda_id: venda!.id });
  await svc.from('ml_perguntas').insert({ user_id: userId, org_id: orgId, question_id: Date.now() % 2000000000, status: 'UNANSWERED' });
  await svc.from('ml_devolucoes').insert({ user_id: userId, org_id: orgId, claim_id: Date.now() % 2000000000 });
  await svc.from('ml_moderacao').insert({ user_id: userId, org_id: orgId, ml_item_id: `MLB${tag}${Date.now()}`, status: 'under_review' });
  await svc.from('ml_webhook_eventos').insert({ user_id: userId, org_id: orgId });
  await svc.from('configuracoes').insert({ user_id: userId, org_id: orgId });

  return { orgId, userId, email, senha, loteId: lote!.id as string, famId: fam!.id as string };
}

/** client autenticado como o usuário (anon key + sessão). */
async function comoUsuario(email: string, senha: string): Promise<SupabaseClient> {
  const cli = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await cli.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return cli;
}

async function main() {
  const A = await criarTenant('A');
  const B = await criarTenant('B');
  const cliA = await comoUsuario(A.email, A.senha);
  const cliB = await comoUsuario(B.email, B.senha);

  // 1. SELECT: cada usuário vê só a própria org, nas 12 tabelas.
  for (const t of TABELAS) {
    const { data: visto, error } = await cliB.from(t).select('org_id');
    assert(!error, `${t}: SELECT como B não erra`, error?.message ?? '');
    const vazaAvA = (visto ?? []).filter((r: { org_id: string | null }) => r.org_id === A.orgId).length;
    assert(vazaAvA === 0, `${t}: B não vê linhas da org A`, `${vazaAvA} linha(s) de A vazaram para B`);
    // ml_webhook_eventos: linhas podem existir sem org (nullable); só exigimos que nenhuma de A apareça.
  }
  for (const t of TABELAS) {
    const { data: visto } = await cliA.from(t).select('org_id');
    const vazaBvA = (visto ?? []).filter((r: { org_id: string | null }) => r.org_id === B.orgId).length;
    assert(vazaBvA === 0, `${t}: A não vê linhas da org B`, `${vazaBvA} linha(s) de B vazaram para A`);
  }

  // 2. Escrita cruzada: B não consegue UPDATE numa família de A (RLS → 0 linhas).
  const { data: updRows } = await cliB.from('familias').update({ nome_pai: 'HACK' }).eq('id', A.famId).select('id');
  assert((updRows ?? []).length === 0, 'B não altera família de A (UPDATE cruzado bloqueado)', `${(updRows ?? []).length} linha(s) afetada(s)`);

  // 3. Escrita cruzada: B não insere linha com org_id de A (WITH CHECK bloqueia).
  const { error: insErr } = await cliB.from('lotes').insert({ user_id: B.userId, org_id: A.orgId, numero: (Date.now() % 2000000000) + 1 });
  assert(!!insErr, 'B não insere lote com org_id de A (WITH CHECK bloqueia)', 'insert cruzado NÃO foi bloqueado');

  // 4. Storage: B não lista/baixa objeto no path do usuário de A.
  const pathA = `${A.userId}/e7-iso/prova.txt`;
  await svc.storage.from('imagens').upload(pathA, new Blob(['x']), { upsert: true });
  const { data: signed } = await cliB.storage.from('imagens').createSignedUrl(pathA, 60);
  assert(!signed?.signedUrl, 'B não gera signed URL de objeto de A (storage isolado)', 'signed URL cruzada foi gerada');

  // 5. Edges (opcional): B chama status-publicados → nunca dados de A.
  if (!SKIP_EDGES) {
    try {
      const { data: sess } = await cliB.auth.getSession();
      const token = sess.session?.access_token;
      const resp = await fetch(`${URL}/functions/v1/status-publicados`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON! } });
      const body = await resp.text();
      assert(!body.includes(A.orgId) && !body.includes(A.famId), 'edge status-publicados não vaza dados de A para B', 'resposta contém ids de A');
    } catch (e) {
      assert(false, 'edge status-publicados respondeu', String(e));
    }

    // 5a. remover-publicado: B mira a família de A → com o fix, o lookup escopado por org
    // devolve null → 404 (nunca 400 "não publicada" da versão vulnerável, que a acharia).
    try {
      const { data: sess } = await cliB.auth.getSession();
      const token = sess.session?.access_token;
      const resp = await fetch(`${URL}/functions/v1/remover-publicado`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: ANON!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ familia_id: A.famId }),
      });
      assert(resp.status === 404, 'edge remover-publicado: B não remove família de A (404)', `status=${resp.status}`);
    } catch (e) {
      assert(false, 'edge remover-publicado respondeu', String(e));
    }

    // 5b. reprocessar-familia: seed A em 'erro', B tenta reprocessar → fix não toca a família
    // de A (fica 'erro'); versão vulnerável a resetaria para 'pendente'.
    try {
      await svc.from('familias').update({ status: 'erro' }).eq('id', A.famId);
      const { data: sess } = await cliB.auth.getSession();
      const token = sess.session?.access_token;
      const resp = await fetch(`${URL}/functions/v1/reprocessar-familia`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: ANON!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ familia_id: A.famId }),
      });
      const body = await resp.json();
      assert(body.reenviadas === 0, 'edge reprocessar-familia: B não reprocessa família de A (reenviadas=0)', `reenviadas=${body.reenviadas}`);
      const { data: apos } = await svc.from('familias').select('status').eq('id', A.famId).single();
      assert(apos?.status === 'erro', 'edge reprocessar-familia: família de A permanece erro (não resetada)', `status=${apos?.status}`);
    } catch (e) {
      assert(false, 'edge reprocessar-familia respondeu', String(e));
    }

    // 5c. publicar-familias: seed A em 'pronto', B tenta publicar → fix não casa a família de A
    // no claim (fica 'pronto'); versão vulnerável a marcaria 'publicando'.
    try {
      await svc.from('familias').update({ status: 'pronto' }).eq('id', A.famId);
      const { data: sess } = await cliB.auth.getSession();
      const token = sess.session?.access_token;
      const resp = await fetch(`${URL}/functions/v1/publicar-familias`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: ANON!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ familia_ids: [A.famId] }),
      });
      const body = await resp.json();
      assert(body.enfileiradas === 0, 'edge publicar-familias: B não publica família de A (enfileiradas=0)', `enfileiradas=${body.enfileiradas}`);
      const { data: apos } = await svc.from('familias').select('status').eq('id', A.famId).single();
      assert(apos?.status === 'pronto', 'edge publicar-familias: família de A permanece pronto (não claimed)', `status=${apos?.status}`);
    } catch (e) {
      assert(false, 'edge publicar-familias respondeu', String(e));
    }
  } else {
    console.log('[--skip-edges] asserções de edge function puladas (ensaio local).');
  }

  // Cleanup: remove seeds, profiles, users e orgs (ordem respeita FKs).
  async function limpar(tenant: { orgId: string; userId: string }) {
    for (const t of ['ml_vendas_itens', 'ml_moderacao', 'ml_devolucoes', 'ml_perguntas', 'ml_webhook_eventos', 'ml_vendas', 'ml_credentials', 'anuncios_externos', 'variacoes', 'familias', 'lotes', 'configuracoes']) {
      await svc.from(t).delete().eq('org_id', tenant.orgId);
    }
    await svc.storage.from('imagens').remove([`${tenant.userId}/e7-iso/prova.txt`]);
    await svc.auth.admin.deleteUser(tenant.userId); // cascata remove profile
    await svc.from('organizations').delete().eq('id', tenant.orgId);
  }
  await limpar(A);
  await limpar(B);
}

main()
  .then(() => {})
  .catch((e) => { resultados.push({ assercao: 'execução da suíte', status: 'FAIL', detalhe: String(e?.message ?? e) }); })
  .finally(() => {
    console.table(resultados.map((r) => ({ '✓/✗': r.status, assercao: r.assercao, detalhe: r.detalhe })));
    const falhas = resultados.filter((r) => r.status === 'FAIL');
    if (falhas.length) {
      console.error(`\n❌ ${falhas.length} FALHA(S) de isolamento. NÃO prosseguir.`);
      process.exit(1);
    }
    console.log(`\n✅ Isolamento cross-tenant provado (${resultados.length} asserções).`);
    process.exit(0);
  });
