// SOMENTE LEITURA. Mede a galeria das peças (ADR-0200, adendo 12/11) com dado real: roda a MESMA função da edge
// (`galeriaDasPecas`) sobre os anúncios de um produto e imprime, por combinação, a sequência (cor · posição da foto na
// galeria da peça). Não escreve no ML nem no banco; o token ML sai de `get_connection_tokens` em transação read only e
// nunca é impresso.
//
// Uso (raiz do repo; lê SUPABASE_ACCESS_TOKEN do .env.local):
//   deno run -A scripts/medir-galeria-pecas.ts <org_id> <codigo_pai> "Preto+Caqui" "Preto+Azul Claro" ...
import { galeriaDasPecas, lerLimiteFotos } from '../supabase/functions/_shared/kit-variacao/galeria-leitura.ts';
import { pecaDaCor } from '../supabase/functions/_shared/kit-variacao/galeria-pecas.ts';

const [orgId, codigoPai, ...combos] = Deno.args;
if (!orgId || !codigoPai || combos.length === 0) throw new Error('uso: <org_id> <codigo_pai> "CorA+CorB" ...');
if (!/^[0-9a-f-]{36}$/.test(orgId) || !/^\d+$/.test(codigoPai)) throw new Error('org_id/codigo_pai inválidos');

const raiz = decodeURIComponent(new URL('..', import.meta.url).pathname);
const env = Deno.readTextFileSync(raiz + '.env.local');
const tok = env.split('\n').find((x) => x.startsWith('SUPABASE_ACCESS_TOKEN='))!.split('=').slice(1).join('=').replace(/"/g, '').trim();
const ref = Deno.readTextFileSync(raiz + 'supabase/.temp/project-ref').trim();
async function sql(query: string) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', 'User-Agent': 'medir-galeria-pecas' },
    body: JSON.stringify({ query: `begin transaction read only; ${query}; commit;` }),
  });
  return await r.json();
}

const base = await sql(`select f.categoria_ml_id, v.codigo, v.cor, i.item_externo_id from familias f
  join variacoes v on v.familia_id=f.id and coalesce(v.excluida_da_publicacao,false)=false
  left join anuncios_externos_itens i on i.sku=v.codigo and i.org_id=f.org_id and i.retirado=false
  where f.org_id='${orgId}' and f.codigo_pai='${codigoPai}' order by f.criado_em desc, v.codigo`) as Array<Record<string, string>>;
if (!Array.isArray(base) || base.length === 0) throw new Error('produto não encontrado');
const categoria = base[0].categoria_ml_id;
const variacoes = base.map((b) => ({ codigo: b.codigo, cor: String(b.cor).trim() }));
const vinculos = base.map((b) => ({ sku: b.codigo, item_externo_id: b.item_externo_id }));

const con = await sql(`select id from marketplace_connections where org_id='${orgId}' limit 1`);
const tk = await sql(`select access_token from public.get_connection_tokens('${con[0].id}')`);
const token = tk[0].access_token as string;
const limite = await lerLimiteFotos(categoria);
console.log(`produto ${codigoPai} · categoria ${categoria} · limite de fotos ${limite}`);
if (limite === null) throw new Error('limite ilegível');

for (const combo of combos) {
  const cores = combo.split('+').map((c) => c.trim());
  const pecas = cores.map((cor) => ({ cor, itemId: pecaDaCor(variacoes, vinculos, cor) ?? '' }));
  if (pecas.some((p) => !p.itemId)) { console.log(`\n${combo}: cor sem anúncio`); continue; }
  const r = await galeriaDasPecas(token, pecas, limite);
  // posição de cada foto na galeria da própria peça (para ver o que a regra pega)
  const bulk = await fetch(`https://api.mercadolibre.com/items/bulk?ids=${[...new Set(pecas.map((p) => p.itemId))].join(',')}&attributes=status_code,body.id,body.pictures`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const itens = new Map<string, string[]>();
  for (const e of await bulk.json() as Array<{ body?: { id: string; pictures: Array<{ id: string }> } }>) {
    if (e.body) itens.set(e.body.id, e.body.pictures.map((p) => p.id));
  }
  console.log(`\n${combo}  (peças: ${pecas.map((p) => `${p.cor}=${p.itemId} com ${itens.get(p.itemId)?.length ?? '?'} fotos`).join(', ')})`);
  console.log(`  foto 1 = foto do kit`);
  r.fotos.forEach((f, i) => {
    const cor = pecas.find((p) => p.itemId === f.item)!.cor;
    console.log(`  foto ${i + 2} = imagem ${(itens.get(f.item)?.indexOf(f.id) ?? -2) + 1} do ${cor}  (${f.id})`);
  });
  console.log(`  total no anúncio: ${r.fotos.length + 1} de ${limite}${r.avisos.length ? ` · avisos: ${r.avisos.join(' | ')}` : ''}`);
}
