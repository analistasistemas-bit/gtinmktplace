// ESCRITA PONTUAL AUTORIZADA PELO DIEGO (12/11/2026): coloca a galeria das peças (regra da feature, ADR-0200 adendo 12/11)
// nos anúncios de um kit com variação JÁ publicado antes da feature (kit 00000250 da Zaven). Fora do fluxo do app, por
// decisão explícita do Diego; nunca rodar em outro kit sem nova autorização.
//
// Por anúncio: GET → guardas → snapshot em disco ANTES de escrever → PUT só de `pictures` (nunca preço, estoque, status,
// atributos) → GET de conferência (fotos = enviadas; preço, estoque, status, SKU = snapshot) → restauro automático se algo
// divergir. Sem --executar nada é escrito (dry-run). O token ML sai de `get_connection_tokens` e nunca é impresso.
//
// Uso (raiz do repo):
//   deno run -A scripts/aplicar-galeria-kit-publicado.ts <org_id> <codigo_pai_kit>                  # dry-run, todos
//   deno run -A scripts/aplicar-galeria-kit-publicado.ts <org_id> <codigo_pai_kit> --so MLB123 --executar
//   deno run -A scripts/aplicar-galeria-kit-publicado.ts <org_id> <codigo_pai_kit> --executar       # todos
//   deno run -A scripts/aplicar-galeria-kit-publicado.ts --desfazer <snapshot.json>
import { galeriaDasPecas, lerLimiteFotos } from '../supabase/functions/_shared/kit-variacao/galeria-leitura.ts';
import { pecaDaCor } from '../supabase/functions/_shared/kit-variacao/galeria-pecas.ts';

const args = Deno.args;
const flag = (n: string) => args.includes(n);
const valor = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const executar = flag('--executar');
const so = valor('--so');
const desfazerArquivo = valor('--desfazer');

const raiz = decodeURIComponent(new URL('..', import.meta.url).pathname);
const env = Deno.readTextFileSync(raiz + '.env.local');
const tokSb = env.split('\n').find((x) => x.startsWith('SUPABASE_ACCESS_TOKEN='))!.split('=').slice(1).join('=').replace(/"/g, '').trim();
const ref = Deno.readTextFileSync(raiz + 'supabase/.temp/project-ref').trim();
async function sql(query: string) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokSb}`, 'Content-Type': 'application/json', 'User-Agent': 'galeria-kit-publicado' },
    body: JSON.stringify({ query }),
  });
  return await r.json();
}
const PASTA = raiz + 'docs/superpowers/specs/evidencias/galeria-kit/';

interface Snap { mlb: string; sku: string | null; status: string; sub_status: string[]; price: number; available_quantity: number; pictures: string[] }
const ml = (token: string) => async (path: string, init?: RequestInit) => {
  const r = await fetch(`https://api.mercadolibre.com${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, any> };
};
async function ler(f: ReturnType<typeof ml>, mlb: string): Promise<{ snap: Snap; bruto: Record<string, any> }> {
  const r = await f(`/items/${mlb}`);
  if (r.status !== 200) throw new Error(`GET ${mlb} → ${r.status}`);
  const j = r.json;
  return {
    bruto: j,
    snap: {
      mlb, sku: j.seller_custom_field ?? null, status: j.status, sub_status: j.sub_status ?? [], price: j.price,
      available_quantity: j.available_quantity, pictures: (j.pictures ?? []).map((p: { id: string }) => p.id),
    },
  };
}
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sinalizar = (a: Snap, b: Snap) => (['sku', 'status', 'price', 'available_quantity'] as const).filter((k) => !igual(a[k], b[k]));

async function tokenML(orgId: string): Promise<string> {
  const con = await sql(`begin transaction read only; select id from marketplace_connections where org_id='${orgId}' limit 1; commit;`);
  const t = await sql(`begin transaction read only; select access_token from public.get_connection_tokens('${con[0].id}'); commit;`);
  if (!t[0]?.access_token) throw new Error('token ML indisponível');
  return t[0].access_token as string;
}

async function put(f: ReturnType<typeof ml>, mlb: string, ids: string[]) {
  const r = await f(`/items/${mlb}`, { method: 'PUT', body: JSON.stringify({ pictures: ids.map((id) => ({ id })) }) });
  return r;
}

// ---- desfazer -------------------------------------------------------------------------------------------------
if (desfazerArquivo) {
  const s = JSON.parse(Deno.readTextFileSync(desfazerArquivo)) as { orgId: string; antes: Snap };
  const f = ml(await tokenML(s.orgId));
  const atual = await ler(f, s.antes.mlb);
  console.log(`desfazer ${s.antes.mlb}: ${atual.snap.pictures.length} fotos agora → ${s.antes.pictures.length} originais`);
  const r = await put(f, s.antes.mlb, s.antes.pictures);
  const depois = await ler(f, s.antes.mlb);
  console.log(`PUT ${r.status}; fotos = originais? ${igual(depois.snap.pictures, s.antes.pictures)}; campos divergentes: ${JSON.stringify(sinalizar(s.antes, depois.snap))}`);
  Deno.exit(0);
}

// ---- aplicar --------------------------------------------------------------------------------------------------
const [orgId, codigoPaiKit] = args.filter((a) => !a.startsWith('--') && a !== so);
if (!orgId || !codigoPaiKit || !/^[0-9a-f-]{36}$/.test(orgId) || !/^\d+$/.test(codigoPaiKit)) throw new Error('uso: <org_id> <codigo_pai_kit> [--so MLB…] [--executar]');

const kit = await sql(`begin transaction read only; select codigo_pai_base, pecas_por_kit from kits_variacao where org_id='${orgId}' and codigo_pai_kit='${codigoPaiKit}'; commit;`);
if (!kit[0]) throw new Error('kit não encontrado nesta org');
const skus = await sql(`begin transaction read only;
  select s.codigo, s.rotulo_cor, s.cores, s.tamanho, i.item_externo_id
  from kit_variacao_skus s join kits_variacao k on k.id=s.kit_id
  left join anuncios_externos_itens i on i.sku=s.codigo and i.org_id=k.org_id and i.retirado=false
  where k.org_id='${orgId}' and k.codigo_pai_kit='${codigoPaiKit}' order by s.rotulo_cor, s.tamanho; commit;`) as Array<{ codigo: string; rotulo_cor: string; cores: string[]; tamanho: string; item_externo_id: string | null }>;
const base = await sql(`begin transaction read only; select f.categoria_ml_id, v.codigo, v.cor, i.item_externo_id
  from familias f join variacoes v on v.familia_id=f.id and coalesce(v.excluida_da_publicacao,false)=false
  left join anuncios_externos_itens i on i.sku=v.codigo and i.org_id=f.org_id and i.retirado=false
  where f.org_id='${orgId}' and f.codigo_pai='${kit[0].codigo_pai_base}' order by f.criado_em desc, v.codigo; commit;`) as Array<Record<string, string>>;
const variacoes = base.map((b) => ({ codigo: b.codigo, cor: String(b.cor).trim() }));
const vinculos = base.map((b) => ({ sku: b.codigo, item_externo_id: b.item_externo_id }));

const token = await tokenML(orgId);
const f = ml(token);
const limite = await lerLimiteFotos(base[0].categoria_ml_id);
if (limite === null) throw new Error('limite de fotos da categoria ilegível');
console.log(`kit ${codigoPaiKit} (base ${kit[0].codigo_pai_base}) · limite ${limite} · ${executar ? 'EXECUTAR' : 'DRY-RUN'}${so ? ` · só ${so}` : ''}\n`);

Deno.mkdirSync(PASTA, { recursive: true });
let falhas = 0;
for (const s of skus) {
  if (so && s.item_externo_id !== so) continue;
  const rotulo = `${s.rotulo_cor} ${s.tamanho} (${s.codigo})`;
  if (!s.item_externo_id) { console.log(`${rotulo}: sem anúncio vivo, pulado`); continue; }
  const mlb = s.item_externo_id;
  try {
    const { snap, bruto } = await ler(f, mlb);
    if (snap.sku !== s.codigo) throw new Error(`SKU do anúncio (${snap.sku}) ≠ ${s.codigo}`);
    if (bruto.catalog_listing === true) throw new Error('anúncio de catálogo');
    if ((bruto.variations ?? []).length > 0) throw new Error('anúncio com variações (formato Legacy): fora do escopo');
    if ((bruto.tags ?? []).includes('variations_migration_pending')) throw new Error('migração de variações pendente');
    if (!['active', 'paused'].includes(snap.status) || snap.sub_status.some((x) => ['forbidden', 'waiting_for_patch'].includes(x))) {
      throw new Error(`anúncio ${snap.status} ${JSON.stringify(snap.sub_status)}`);
    }
    const pecas = s.cores.map((cor) => ({ cor, itemId: pecaDaCor(variacoes, vinculos, cor.trim()) ?? '' }));
    if (pecas.some((p) => !p.itemId)) throw new Error('cor sem anúncio de peça');
    const g = await galeriaDasPecas(token, pecas, limite);
    if (g.indisponivel || g.fotos.length === 0) throw new Error(`galeria indisponível: ${g.avisos.join(' | ')}`);
    const novas = g.fotos.map((x) => x.id).filter((id) => !snap.pictures.includes(id));
    const depois = [...snap.pictures, ...novas];
    if (depois.length > limite) throw new Error(`passa do limite (${depois.length} > ${limite})`);
    console.log(`${rotulo} ${mlb}: ${snap.pictures.length} foto(s) hoje → ${depois.length} (+${novas.length}) · ${g.fotos.map((x) => `${pecas.find((p) => p.itemId === x.item)!.cor}:${x.id.slice(0, 6)}`).join(' ')}`);
    if (novas.length === 0 || !executar) continue;

    const arquivo = `${PASTA}${mlb}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    Deno.writeTextFileSync(arquivo, JSON.stringify({ orgId, antes: snap, enviar: depois }, null, 2));   // ANTES de escrever
    const r = await put(f, mlb, depois);
    const conf = await ler(f, mlb);
    const divergencias = sinalizar(snap, conf.snap);
    const fotosOk = igual(conf.snap.pictures, depois);
    console.log(`   PUT ${r.status} · fotos conferem: ${fotosOk} · campos divergentes: ${JSON.stringify(divergencias)} · snapshot ${arquivo.replace(raiz, '')}`);
    if (r.status !== 200 || !fotosOk || divergencias.length > 0) {
      console.log(`   !! divergência: restaurando as fotos originais de ${mlb}`);
      const rr = await put(f, mlb, snap.pictures);
      const c2 = await ler(f, mlb);
      console.log(`   restauro PUT ${rr.status} · fotos originais? ${igual(c2.snap.pictures, snap.pictures)} · corpo do erro do PUT: ${JSON.stringify(r.json).slice(0, 400)}`);
      falhas++;
      break;   // um anúncio com problema interrompe o lote
    }
  } catch (e) {
    falhas++;
    console.log(`${rotulo} ${mlb}: NÃO aplicado — ${e instanceof Error ? e.message : String(e)}`);
    if (executar) break;
  }
}
console.log(falhas ? `\nterminou com ${falhas} problema(s)` : '\nok');
