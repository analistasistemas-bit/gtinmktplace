// Task 9, fix round 1: prova de "uma requisição HTTP" com o SDK REAL (`npm:openai@^4` de _shared/ai/client.ts) e o
// fetch global mockado — o vitest não tem o pacote `openai` e mocka o client.ts. Sem rede.
// Rodar: deno test --config supabase/functions/deno.json --allow-env --allow-read \
//   supabase/functions/_shared/galeria/__tests__/worker-http.denotest.ts
// (fora do vitest e do CI: o nome não casa com *.test.ts.)
import { assertEquals } from 'jsr:@std/assert@1';
import { fakeAdmin } from './fake-admin.ts';

const posts: string[] = [];
globalThis.fetch = ((u: string | URL | Request, init?: RequestInit) => {
  const url = u instanceof Request ? u.url : String(u);
  if ((u instanceof Request ? u.method : init?.method) === 'POST') posts.push(url);
  return Promise.resolve(new Response('bad gateway', { status: 502 }));
}) as typeof fetch;
Deno.env.set('OPENROUTER_API_KEY', 'teste');
Deno.env.set('HF_CREDENTIALS', 'copy:id:secret');

const { openrouterClient } = await import('../../ai/client.ts');
const { executarImagem } = await import('../worker-estado.ts');

const ID = '11111111-1111-4111-8111-111111111111';
function montar(extra: Record<string, unknown> = {}) {
  const db: Record<string, Record<string, unknown>[]> = {
    galeria_imagens: [{
      id: ID, org_id: 'org', familia_id: 'famB', roteiro_id: 'rot1', referencia_id: 'ref1', cor: 'Preto', missao: 2,
      geracao: 1, origem: 'gerador', modelo: 'google/gemini-nano-banana-2.1', provider_request_id: null, status: 'pendente',
      fase: 0, tentativa: 0, posse: null, lease_ate: null, prazo_ate: null, criado_em: new Date().toISOString(),
      prompt: null, cena_path: null, alertas: null, ...extra,
    }],
    galeria_roteiros: [{ id: 'rot1', status: 'aprovado', moda: false, conteudo: { categoria: 'x', contrato: 'c', missoes: [{ missao: 2, ativa: true, cena: 'cena', fatosUsados: [] }] } }],
    galeria_referencias: [{ id: 'ref1', path: 'org/ref.jpg' }],
  };
  return { db, admin: fakeAdmin(db).admin as never };
}
const msg = { id: ID, fase: 0, tentativa: 0 };
const deps = { agora: () => new Date() };

Deno.test('controle: sem maxRetries o SDK real repete (3 POSTs) — o stub enxerga os retries', async () => {
  posts.length = 0;
  // deno-lint-ignore no-explicit-any
  await openrouterClient().chat.completions.create({ model: 'm', messages: [] } as any).catch(() => {});
  assertEquals(posts.length, 3);
});

Deno.test('OpenRouter 502 na geração → um POST; lease solto com tentativa 1', async () => {
  posts.length = 0;
  const { db, admin } = montar();
  assertEquals(await executarImagem(admin, msg, deps), 'liberada');
  assertEquals(posts.filter((u) => u.startsWith('https://openrouter.ai/')).length, 1);
  assertEquals(db.galeria_imagens[0].status, 'submetendo');
  assertEquals(db.galeria_imagens[0].tentativa, 1);
});

Deno.test('visão 502 → um POST; alertas = verificacao_indisponivel', async () => {
  posts.length = 0;
  const { db, admin } = montar({ status: 'gerada', cena_path: 'org/c.jpg', fase: 1, tentativa: 1 });
  assertEquals(await executarImagem(admin, msg, deps), 'alertada');
  assertEquals(posts.filter((u) => u.startsWith('https://openrouter.ai/')).length, 1);
  assertEquals((db.galeria_imagens[0].alertas as Array<{ tipo: string }>)[0].tipo, 'verificacao_indisponivel');
});

Deno.test('submeterHF 502 (fetch global) → um POST; sem provider_request_id', async () => {
  posts.length = 0;
  const { db, admin } = montar({ modelo: 'xai/grok-imagine-image-2.0' });
  assertEquals(await executarImagem(admin, msg, deps), 'liberada');
  assertEquals(posts, ['https://api.higgsfield.ai/xai/grok-imagine-image-2.0']);
  assertEquals(db.galeria_imagens[0].provider_request_id, null);
});
