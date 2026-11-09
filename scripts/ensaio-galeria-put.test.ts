// Teste sem rede do ensaio da galeria (fetch mockado; nada sai para o ML nem para o Supabase).
// Rodar: deno test -A scripts/ensaio-galeria-put.test.ts
import { deepStrictEqual as assertEquals, notStrictEqual as assertNotEquals, ok as assert } from 'node:assert/strict';
import { cfg, definirToken, inverso } from './ensaio-galeria-put.ts';

const ID = 'MLB7168683146';
const fotos = ['f1', 'f2', 'f3', 'f4'];

function itemInicial() {
  return {
    id: ID, status: 'active', price: 10, available_quantity: 3, sold_quantity: 0, seller_custom_field: null,
    catalog_listing: false, tags: [], user_product_id: null, family_name: null,
    pictures: fotos.map((id) => ({ id, max_size: '1x1', secure_url: `https://x/${id}.jpg` })),
    variations: [
      { id: 1, price: 10, available_quantity: 1, sold_quantity: 0, seller_custom_field: 'A', attribute_combinations: [], picture_ids: ['f1', 'f2'] },
      { id: 2, price: 10, available_quantity: 2, sold_quantity: 0, seller_custom_field: 'B', attribute_combinations: [], picture_ids: ['f3', 'f4'] },
    ],
  };
}
const precos = { prices: [{ id: '1', type: 'standard', amount: 10 }] };

type Cenario = { getsFalhos?: Set<number>; aoFalhar?: (item: ReturnType<typeof itemInicial>) => void; pricesLanca?: number };

async function rodar(c: Cenario) {
  const item = itemInicial();
  let gets = 0, pricesN = 0;
  const puts: unknown[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith('https://api.mercadolibre.com/items/')) throw new Error(`rede proibida no teste: ${u}`);
    if (u.endsWith('/prices')) {
      if (++pricesN === c.pricesLanca) throw new Error('rede caiu (prices)');
      return new Response(JSON.stringify(precos));
    }
    if (init?.method === 'PUT') {
      const corpo = JSON.parse(String(init.body));
      puts.push(corpo);
      if (corpo.pictures) item.pictures = corpo.pictures.map((p: { id: string }) => ({ id: p.id, max_size: '1x1', secure_url: `https://x/${p.id}.jpg` }));
      for (const v of corpo.variations ?? []) {
        const alvo = item.variations.find((x) => x.id === v.id)!;
        if (v.picture_ids) alvo.picture_ids = v.picture_ids;
        if (v.available_quantity !== undefined) alvo.available_quantity = v.available_quantity;
      }
      return new Response('{}', { status: 200 });
    }
    gets++;
    if (c.getsFalhos?.has(gets)) {
      if (c.aoFalhar) { c.aoFalhar(item); c.aoFalhar = undefined; }
      return new Response('erro', { status: 500 });
    }
    return new Response(JSON.stringify(item));
  }) as typeof fetch;
  try {
    const codigo = await inverso('estoque');
    return { codigo, puts, item, gets };
  } finally {
    globalThis.fetch = original;
  }
}

const tmp = await Deno.makeTempDir();
cfg.saida = tmp;
cfg.evid = new URL(`file://${tmp}/`);
cfg.espera = () => Promise.resolve();
definirToken('falso');

// GETs de /items/{id} em inverso('estoque'): 1 antes, 2 precos(), 3 imediato, 4 (~60 s, com 4 tentativas → 4..7).
Deno.test('GET de ~60 s lançando: reconcilia, restaura e confere; nunca sai ok', async () => {
  const r = await rodar({
    getsFalhos: new Set([4, 5, 6, 7]),
    // o ML "mexeu" nas fotos enquanto a leitura falhava: o restauro tem de ser enviado e conferido
    aoFalhar: (item) => { item.pictures.reverse(); item.variations[0].picture_ids = ['f2', 'f1']; },
  });
  assertNotEquals(r.codigo, 0);
  assertEquals(r.codigo, 3); // nao_conferida, com restauro conferido (4 seria restauro não conferido)
  const restauroFotos = r.puts.find((p) => (p as { pictures?: unknown }).pictures);
  assert(restauroFotos, 'restauro de fotos não foi enviado');
  assertEquals(r.item.pictures.map((p) => p.id), fotos);
  assertEquals(r.item.variations[0].picture_ids, ['f1', 'f2']);
});

Deno.test('GET de ~60 s lançando sem mudança: ainda reconcilia por GET e sai ≠ 0', async () => {
  const r = await rodar({ getsFalhos: new Set([4, 5, 6, 7]) });
  assertEquals(r.codigo, 3);
  assertEquals(r.puts.length, 1); // só o PUT medido; reconciliação viu o retrato e não reescreveu
  assert(r.gets >= 9, `faltou GET de reconciliação/conferência (gets=${r.gets})`);
});

Deno.test('/prices de conferência lançando: medição não conferida, exit ≠ 0', async () => {
  const r = await rodar({ pricesLanca: 2 });
  assertEquals(r.codigo, 3);
});

Deno.test('caminho feliz: exit 0', async () => {
  const r = await rodar({});
  assertEquals(r.codigo, 0);
});
