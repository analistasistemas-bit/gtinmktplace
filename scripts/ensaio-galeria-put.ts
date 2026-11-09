// Galeria da cor por IA — Task 1 (ensaio do contrato do ML, bloqueador). Fora da suíte.
// Mede, em anúncios REAIS autorizados pelo Diego, como o ML trata escrita SÓ de fotos.
// Regras: só os MLBs da lista PERMITIDOS; só corpos com fotos (pictures / variations[].{id,picture_ids});
// a foto "nova" é sempre a PRÓPRIA foto atual do item, re-subida (mesmos bytes); token lido de
// get_connection_tokens em transação read only, NUNCA renovado nem impresso.
//
// Uso (raiz do repo; lê SUPABASE_ACCESS_TOKEN do .env.local):
//   deno run -A scripts/ensaio-galeria-put.ts snap <MLB> [rotulo]          GET completo + GET ?attributes=…,catalog_listing
//   deno run -A scripts/ensaio-galeria-put.ts upload <MLB> <picture_id>    baixa a foto do item e re-sobe (multipart)
//   deno run -A scripts/ensaio-galeria-put.ts put <MLB> <corpo.json> [fotos_esperadas] [restauro.json]
//       guarda → PUT → GET → compara invariantes; se algo mudar, PUT do restauro na hora e sai com 2
// Saída bruta em /tmp/ensaio-galeria/ (fora do repo).

const PROJETO = 'txvncrgkoynoxwopfkbp';
const CONEXAO_AVIL = '085fd9d3-a3dd-439c-a482-5ad24459a30a';
const PERMITIDOS = new Set(['MLB7168683146', 'MLB7245326808', 'MLB7245326842']);
const API = 'https://api.mercadolibre.com';
const SAIDA = '/tmp/ensaio-galeria';
await Deno.mkdir(SAIDA, { recursive: true });

function tokenSupabase(): string {
  const env = Deno.readTextFileSync(new URL('../.env.local', import.meta.url));
  const l = env.split('\n').find((x) => x.startsWith('SUPABASE_ACCESS_TOKEN='));
  if (!l) throw new Error('SUPABASE_ACCESS_TOKEN ausente');
  return l.split('=', 2)[1].trim().replace(/^"|"$/g, '');
}

async function tokenML(): Promise<string> {
  const q = `begin transaction read only; select access_token, expires_at from public.get_connection_tokens('${CONEXAO_AVIL}'); commit;`;
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJETO}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenSupabase()}`, 'Content-Type': 'application/json', 'User-Agent': 'ensaio-galeria' },
    body: JSON.stringify({ query: q }),
  });
  const [linha] = await r.json() as { access_token: string; expires_at: string }[];
  if (!linha?.access_token) throw new Error('NEEDS_CONTEXT: token ML indisponível');
  // ponytail: nunca renovar (refresh é rotativo e quebraria a conexão do app).
  if (new Date(linha.expires_at).getTime() - Date.now() < 10 * 60_000) throw new Error('NEEDS_CONTEXT: token ML vencido ou a <10 min');
  return linha.access_token;
}
const TOKEN = await tokenML();
const auth = { Authorization: `Bearer ${TOKEN}` };

async function getItem(id: string) {
  const r = await fetch(`${API}/items/${id}`, { headers: auth });
  if (!r.ok) throw new Error(`GET ${id} ${r.status}: ${await r.text()}`);
  return await r.json();
}

// Recorte comparável: o que a galeria pode mudar (fotos) e o que NUNCA pode mudar (o resto).
// deno-lint-ignore no-explicit-any
function recorte(it: any) {
  return {
    id: it.id, status: it.status, price: it.price, available_quantity: it.available_quantity, sold_quantity: it.sold_quantity,
    seller_custom_field: it.seller_custom_field, catalog_listing: it.catalog_listing, tags: it.tags,
    user_product_id: it.user_product_id, family_name: it.family_name,
    // deno-lint-ignore no-explicit-any
    pictures: (it.pictures ?? []).map((p: any) => ({ id: p.id, max_size: p.max_size, url: p.secure_url })),
    // deno-lint-ignore no-explicit-any
    variations: (it.variations ?? []).map((v: any) => ({
      id: v.id, price: v.price, available_quantity: v.available_quantity, sold_quantity: v.sold_quantity,
      seller_custom_field: v.seller_custom_field, attribute_combinations: v.attribute_combinations, picture_ids: v.picture_ids,
    })),
  };
}

// deno-lint-ignore no-explicit-any
function invariantes(r: any) {
  // deno-lint-ignore no-explicit-any
  // tags fora: o ML recalcula (ex.: good_quality_thumbnail) ao trocar foto; diff registrado à parte.
  const { pictures: _p, variations, tags: _t, ...resto } = r;
  // deno-lint-ignore no-explicit-any
  return { ...resto, variations: variations.map(({ picture_ids: _x, ...v }: any) => v) };
}

async function snap(id: string, rotulo: string) {
  const bruto = await getItem(id);
  const rAttr = await fetch(`${API}/items/${id}?attributes=id,status,catalog_listing,catalog_product_id`, { headers: auth });
  const attr = await rAttr.json();
  // /items/bulk, exatamente como varrer-itens.ts lê (caminhoMultiget): o campo vem explícito ou omitido?
  const rMulti = await fetch(`${API}/items/bulk?ids=${id}&attributes=status_code,body.id,body.status,body.catalog_listing`, { headers: auth });
  const multiBruto = await rMulti.json();
  const multi = (Array.isArray(multiBruto) ? multiBruto[0]?.body : multiBruto) ?? {};
  const rec = recorte(bruto);
  await Deno.writeTextFile(`${SAIDA}/${id}-${rotulo}.json`, JSON.stringify({ recorte: rec, attributes_catalog: attr, multiget: multi }, null, 2));
  return { rec, attr, multi, catalogPresenteNoMultiget: Object.hasOwn(multi, 'catalog_listing'), catalogPresenteNoGetCompleto: Object.hasOwn(bruto, 'catalog_listing'), catalogPresenteNoAttributes: Object.hasOwn(attr, 'catalog_listing') };
}

// deno-lint-ignore no-explicit-any
function guarda(rec: any) {
  const motivos: string[] = [];
  if (!PERMITIDOS.has(rec.id)) motivos.push('item fora da lista autorizada');
  if (rec.sold_quantity > 0) motivos.push(`sold_quantity=${rec.sold_quantity}`);
  if (rec.status !== 'active') motivos.push(`status=${rec.status}`);
  if (rec.catalog_listing === true) motivos.push('catalog_listing=true');
  if ((rec.tags ?? []).includes('variations_migration_pending')) motivos.push('variations_migration_pending');
  if (motivos.length) throw new Error(`BLOCKED: ${motivos.join('; ')}`);
}

// Corpo só com fotos: { pictures: [{id}] } e/ou { variations: [{ id, picture_ids }] }.
// deno-lint-ignore no-explicit-any
function corpoSoFotos(c: any) {
  for (const k of Object.keys(c)) if (k !== 'pictures' && k !== 'variations') throw new Error(`corpo com chave proibida: ${k}`);
  // deno-lint-ignore no-explicit-any
  for (const p of c.pictures ?? []) for (const k of Object.keys(p)) if (k !== 'id') throw new Error(`pictures[] com chave proibida: ${k}`);
  // deno-lint-ignore no-explicit-any
  for (const v of c.variations ?? []) for (const k of Object.keys(v)) if (k !== 'id' && k !== 'picture_ids') throw new Error(`variations[] com chave proibida: ${k}`);
}

async function upload(id: string, pictureId: string) {
  if (!PERMITIDOS.has(id)) throw new Error('item fora da lista autorizada');
  const it = await getItem(id);
  // deno-lint-ignore no-explicit-any
  const foto = (it.pictures ?? []).find((p: any) => p.id === pictureId);
  if (!foto) throw new Error(`foto ${pictureId} não pertence a ${id}`); // nunca imagem alheia
  const ext = foto.secure_url.endsWith('.webp') ? 'webp' : 'jpg';
  // secure_url do item (D_…-O) é a versão de 500 px; a original está em D_NQ_NP_<id>-F (medido no ensaio).
  const bytes = new Uint8Array(await (await fetch(`https://http2.mlstatic.com/D_NQ_NP_${pictureId}-F.${ext}`)).arrayBuffer());
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: ext === 'webp' ? 'image/webp' : 'image/jpeg' }), `${pictureId}.${ext}`);
  const t0 = Date.now();
  let r = await fetch(`${API}/pictures/items/upload`, { method: 'POST', headers: { ...auth, 'User-Agent': 'Mozilla/5.0' }, body: form });
  let txt = await r.text();
  console.log(JSON.stringify({ endpoint: '/pictures/items/upload', http: r.status, ms: Date.now() - t0, bytes: bytes.length, origem: pictureId }));
  if (!r.ok) {
    console.log(txt.slice(0, 500));
    // fotos.ts registra 405 nesse endpoint no bug bash da E1: tenta multipart em /pictures.
    r = await fetch(`${API}/pictures`, { method: 'POST', headers: { ...auth, 'User-Agent': 'Mozilla/5.0' }, body: form });
    txt = await r.text();
    console.log(JSON.stringify({ endpoint: '/pictures (multipart)', http: r.status, ms: Date.now() - t0 }));
    if (!r.ok) { console.log(txt.slice(0, 500)); return; }
  }
  const up = JSON.parse(txt);
  await Deno.writeTextFile(`${SAIDA}/upload-${up.id}.json`, txt);
  // Tempo até a URL real responder 200 (mlstatic devolve 405 para HEAD: usa GET).
  // deno-lint-ignore no-explicit-any
  const url = (up.variations ?? []).find((v: any) => v.secure_url)?.secure_url;
  let msUrl: number | null = null;
  for (let i = 0; i < 30 && url; i++) {
    const h = await fetch(url);
    await h.body?.cancel();
    if (h.ok) { msUrl = Date.now() - t0; break; }
    await new Promise((s) => setTimeout(s, 1000));
  }
  const g = await fetch(`${API}/pictures/${up.id}`, { headers: auth });
  const gj = await g.json();
  console.log(JSON.stringify({
    upload_id: up.id, status_upload: up.status, max_size: up.max_size, secure_url: url, ms_ate_url_200: msUrl,
    get_pictures_http: g.status, get_pictures_status: gj.status,
  }, null, 2));
}

async function put(id: string, arquivo: string, fotosEsperadas?: number, restauro?: string) {
  const corpo = JSON.parse(await Deno.readTextFile(arquivo));
  corpoSoFotos(corpo);
  const antes = await snap(id, `antes-${Date.now()}`);
  guarda(antes.rec);
  const quando = new Date().toISOString();
  const r = await fetch(`${API}/items/${id}`, {
    method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const resp = await r.text();
  console.log(JSON.stringify({ quando, put: id, corpo, http: r.status }));
  if (!r.ok) console.log(resp.slice(0, 2000));
  const depois = await snap(id, `depois-${Date.now()}`);
  const ia = JSON.stringify(invariantes(antes.rec));
  const id2 = JSON.stringify(invariantes(depois.rec));
  console.log(JSON.stringify({
    invariantes_iguais: ia === id2,
    fotos_antes: antes.rec.pictures.map((p: { id: string }) => p.id),
    fotos_depois: depois.rec.pictures.map((p: { id: string }) => p.id),
    // deno-lint-ignore no-explicit-any
    picture_ids_antes: antes.rec.variations.map((v: any) => [v.id, v.picture_ids]),
    // deno-lint-ignore no-explicit-any
    picture_ids_depois: depois.rec.variations.map((v: any) => [v.id, v.picture_ids]),
  }, null, 2));
  if (JSON.stringify(antes.rec.tags) !== JSON.stringify(depois.rec.tags)) console.log(JSON.stringify({ tags_antes: antes.rec.tags, tags_depois: depois.rec.tags }));
  const contagemOk = fotosEsperadas === undefined || depois.rec.pictures.length === fotosEsperadas;
  if (ia !== id2 || !contagemOk) {
    console.log(`ALERTA: ${ia !== id2 ? 'invariante mudou' : `contagem de fotos ${depois.rec.pictures.length} != ${fotosEsperadas}`}\nANTES ${ia}\nDEPOIS ${id2}`);
    if (restauro) {
      const corpoR = JSON.parse(await Deno.readTextFile(restauro));
      corpoSoFotos(corpoR);
      const rr = await fetch(`${API}/items/${id}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(corpoR) });
      console.log(JSON.stringify({ restauro_imediato: id, http: rr.status, quando: new Date().toISOString() }));
    }
    Deno.exit(2);
  }
}

const [cmd, a, b] = Deno.args;
if (cmd === 'snap') console.log(JSON.stringify(await snap(a, b ?? `snap-${Date.now()}`), null, 2));
else if (cmd === 'upload') await upload(a, b);
else if (cmd === 'put') await put(a, b, Deno.args[3] ? Number(Deno.args[3]) : undefined, Deno.args[4]);
else console.error('uso: snap <MLB> [rotulo] | upload <MLB> <picture_id> | put <MLB> <corpo.json>');
