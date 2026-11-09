// Galeria da cor por IA — Task 1 (ensaio do contrato do ML, bloqueador). Fora da suíte.
// Mede, em anúncios REAIS autorizados pelo Diego, como o ML trata escrita de fotos (e, em (h), os PUTs
// sem fotos com os valores atuais). Regras: só os MLBs de PERMITIDOS; a foto "nova" é sempre a PRÓPRIA foto
// atual do item, re-subida; token lido de get_connection_tokens em transação read only, NUNCA renovado nem impresso.
//
// Uso (raiz do repo; lê SUPABASE_ACCESS_TOKEN do .env.local):
//   deno run -A scripts/ensaio-galeria-put.ts snap <MLB> <passo>              GET → evidência sanitizada
//   deno run -A scripts/ensaio-galeria-put.ts upload <MLB> <picture_id>       re-sobe foto do item (multipart)
//   deno run -A scripts/ensaio-galeria-put.ts put <MLB> <corpo.json> <passo>  só fotos; ver `put`
//   deno run -A scripts/ensaio-galeria-put.ts inverso estoque|preco|plano     (h): PUT sem fotos com os valores atuais
// Medição aprovada = HTTP 2xx + fotos do GET iguais ao corpo (ids, ordem e quantidade, por variação) + resto igual.
// Todo `put` restaura o retrato de antes (corpo de restauro gravado ANTES da escrita) e confere por GET.
// Saída: brutos em /tmp/ensaio-galeria/; evidência sanitizada em docs/superpowers/specs/evidencias/galeria-ensaio/.
// Códigos de saída: 0 ok · 1 PUT não-2xx · 2 medição reprovou · 3 medição NÃO conferida (leitura de conferência
// falhou) · 4 restauro NÃO conferido. Teste sem rede: `deno test -A scripts/ensaio-galeria-put.test.ts`.

const PROJETO = 'txvncrgkoynoxwopfkbp';
const CONEXAO_AVIL = '085fd9d3-a3dd-439c-a482-5ad24459a30a';
const PERMITIDOS = new Set(['MLB7168683146', 'MLB7245326808', 'MLB7245326842']);
const API = 'https://api.mercadolibre.com';
// Sem efeito colateral no import (o teste importa o módulo): diretórios, espera e token são ajustáveis.
export const cfg = {
  saida: '/tmp/ensaio-galeria',
  evid: new URL('../docs/superpowers/specs/evidencias/galeria-ensaio/', import.meta.url) as URL,
  espera: (ms: number) => new Promise<void>((s) => setTimeout(s, ms)),
};
let auth: Record<string, string> = {};
export function definirToken(t: string) { auth = { Authorization: `Bearer ${t}` }; }

function tokenSupabase(): string {
  const env = Deno.readTextFileSync(new URL('../.env.local', import.meta.url));
  const l = env.split('\n').find((x) => x.startsWith('SUPABASE_ACCESS_TOKEN='));
  if (!l) throw new Error('SUPABASE_ACCESS_TOKEN ausente');
  return l.split('=', 2)[1].trim().replace(/^"|"$/g, '');
}

async function tokenML(): Promise<string> {
  const q = `begin transaction read only; select access_token, expires_at from public.get_connection_tokens('${CONEXAO_AVIL}'); commit;`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROJETO}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenSupabase()}`, 'Content-Type': 'application/json', 'User-Agent': 'ensaio-galeria' },
      body: JSON.stringify({ query: q }),
    });
    const j = await r.json().catch(() => null);
    const linha = Array.isArray(j) ? j[0] as { access_token: string; expires_at: string } : null;
    if (!linha?.access_token) { await new Promise((s) => setTimeout(s, 3000)); continue; }
    // ponytail: nunca renovar (refresh é rotativo e quebraria a conexão do app).
    if (new Date(linha.expires_at).getTime() - Date.now() < 10 * 60_000) throw new Error('NEEDS_CONTEXT: token ML vencido ou a <10 min');
    return linha.access_token;
  }
  throw new Error('NEEDS_CONTEXT: token ML indisponível');
}
const espera = (ms: number) => cfg.espera(ms);

// GET com nova tentativa: falha de leitura não pode virar "medição ok" nem disparar restauro às cegas.
async function getItem(id: string) {
  let ultimo = '';
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${API}/items/${id}`, { headers: auth });
    if (r.ok) return await r.json();
    ultimo = `GET ${id} ${r.status}: ${(await r.text()).slice(0, 300)}`;
    await espera(2000 * (i + 1));
  }
  throw new Error(ultimo);
}

// deno-lint-ignore no-explicit-any
type Rec = any;
// Recorte comparável: fotos (o que a galeria muda) e o resto (o que NUNCA pode mudar).
function recorte(it: Rec) {
  return {
    id: it.id, status: it.status, price: it.price, available_quantity: it.available_quantity, sold_quantity: it.sold_quantity,
    seller_custom_field: it.seller_custom_field, catalog_listing: it.catalog_listing, tags: it.tags,
    user_product_id: it.user_product_id, family_name: it.family_name,
    pictures: (it.pictures ?? []).map((p: Rec) => ({ id: p.id, max_size: p.max_size, url: p.secure_url })),
    variations: (it.variations ?? []).map((v: Rec) => ({
      id: v.id, price: v.price, available_quantity: v.available_quantity, sold_quantity: v.sold_quantity,
      seller_custom_field: v.seller_custom_field,
      attribute_combinations: (v.attribute_combinations ?? []).map((c: Rec) => ({ id: c.id, value_id: c.value_id, value_name: c.value_name })),
      picture_ids: v.picture_ids,
    })),
  };
}
const semTags = (r: Rec) => JSON.stringify({ ...r, tags: undefined });
const semFotos = (r: Rec) => JSON.stringify({ ...r, tags: undefined, pictures: undefined, variations: r.variations.map((v: Rec) => ({ ...v, picture_ids: undefined })) });
const ids = (r: Rec) => r.pictures.map((p: Rec) => p.id);

let seq = 0;
// Evidência versionada: só campos do anúncio (nada de token, comprador ou pedido).
async function evid(id: string, passo: string, rotulo: string, rec: Rec, extra: Rec = {}) {
  const s = {
    mlb: id, passo, rotulo, horario_utc: new Date().toISOString(), ...extra,
    status: rec.status, price: rec.price, available_quantity: rec.available_quantity, sold_quantity: rec.sold_quantity,
    seller_custom_field: rec.seller_custom_field, catalog_listing: rec.catalog_listing,
    pictures: ids(rec),
    variations: rec.variations.map((v: Rec) => ({
      id: v.id, price: v.price, available_quantity: v.available_quantity, seller_custom_field: v.seller_custom_field,
      attribute_combinations: v.attribute_combinations.map((c: Rec) => `${c.id}=${c.value_name}`), picture_ids: v.picture_ids,
    })),
  };
  const nome = `${id}-${passo}-${String(++seq).padStart(2, '0')}-${rotulo}.json`;
  // Nunca lança: falha ao gravar evidência não pode impedir restauro nem conferência.
  try { await Deno.writeTextFile(new URL(nome, cfg.evid), JSON.stringify(s, null, 2) + '\n'); } catch (e) { console.log(`EVIDÊNCIA NÃO GRAVADA (${nome}): ${e}`); }
}

async function snap(id: string, rotulo: string) {
  const bruto = await getItem(id);
  const rec = recorte(bruto);
  await Deno.writeTextFile(`${cfg.saida}/${id}-${rotulo}-${Date.now()}.json`, JSON.stringify(rec, null, 2));
  return rec;
}

function guarda(rec: Rec) {
  const motivos: string[] = [];
  if (!PERMITIDOS.has(rec.id)) motivos.push('item fora da lista autorizada');
  if (rec.sold_quantity > 0) motivos.push(`sold_quantity=${rec.sold_quantity}`);
  if (rec.status !== 'active') motivos.push(`status=${rec.status}`);
  if (rec.catalog_listing === true) motivos.push('catalog_listing=true');
  if ((rec.tags ?? []).includes('variations_migration_pending')) motivos.push('variations_migration_pending');
  if (motivos.length) throw new Error(`BLOCKED: ${motivos.join('; ')}`);
}

// Corpo só com fotos; lista de fotos do item sempre COMPLETA (nunca parcial).
function corpoSoFotos(c: Rec, antes: Rec) {
  for (const k of Object.keys(c)) if (k !== 'pictures' && k !== 'variations') throw new Error(`corpo com chave proibida: ${k}`);
  for (const p of c.pictures ?? []) for (const k of Object.keys(p)) if (k !== 'id') throw new Error(`pictures[] com chave proibida: ${k}`);
  for (const v of c.variations ?? []) for (const k of Object.keys(v)) if (k !== 'id' && k !== 'picture_ids') throw new Error(`variations[] com chave proibida: ${k}`);
  if (c.pictures && c.pictures.length !== antes.pictures.length) throw new Error(`lista parcial: ${c.pictures.length} != ${antes.pictures.length} fotos`);
  if (c.variations && c.variations.length !== antes.variations.length) throw new Error('variations parcial (o ML apaga as omitidas)');
}

// Restauro no formato provado: Legacy {pictures, variations:[{id, picture_ids}]} (todas); UP {pictures}.
function corpoRestauro(antes: Rec) {
  const pictures = antes.pictures.map((p: Rec) => ({ id: p.id }));
  return antes.variations.length
    ? { pictures, variations: antes.variations.map((v: Rec) => ({ id: v.id, picture_ids: v.picture_ids })) }
    : { pictures };
}

// O GET bate com o corpo enviado? Fotos por id, ordem e quantidade (item e cada variação); resto igual ao antes.
function conferirCorpo(corpo: Rec, antes: Rec, depois: Rec): string[] {
  const erros: string[] = [];
  if (semFotos(antes) !== semFotos(depois)) erros.push('campo fora das fotos mudou');
  const esperado = corpo.pictures ? corpo.pictures.map((p: Rec) => p.id) : ids(antes);
  if (JSON.stringify(ids(depois)) !== JSON.stringify(esperado)) {
    erros.push(`pictures ${JSON.stringify(ids(depois))} != esperado ${JSON.stringify(esperado)}`);
  }
  for (const v of depois.variations) {
    const enviado = (corpo.variations ?? []).find((x: Rec) => x.id === v.id)?.picture_ids;
    const exp = enviado ?? antes.variations.find((x: Rec) => x.id === v.id)?.picture_ids;
    if (JSON.stringify(v.picture_ids) !== JSON.stringify(exp)) erros.push(`variação ${v.id}: ${JSON.stringify(v.picture_ids)} != ${JSON.stringify(exp)}`);
  }
  return erros;
}

async function putItem(id: string, corpo: Rec) {
  const r = await fetch(`${API}/items/${id}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const txt = await r.text();
  const quando = new Date().toISOString();
  console.log(JSON.stringify({ quando, put: id, corpo, http: r.status }));
  if (!r.ok) console.log(txt.slice(0, 1500));
  return { ok: r.ok, http: r.status, quando };
}

// Reconcilia (GET do estado atual) → restaura se diferir do retrato → só declara restaurado depois de um GET,
// feito após o restauro, igual ao retrato (fotos com ids/ordem por variação e o resto). Sem leitura não escreve.
export async function restaurar(id: string, passo: string, antes: Rec, corpos: Rec[]): Promise<boolean> {
  let atual: Rec;
  try { atual = await snap(id, `${passo}-reconcilia`); } catch (e) { console.log(`RECONCILIAÇÃO SEM LEITURA, restauro não enviado: ${e}`); return false; }
  if (atual.sold_quantity !== antes.sold_quantity) { console.log('BLOCKED: venda durante o ensaio; sem restauro automático'); return false; }
  if (semTags(atual) !== semTags(antes)) {
    for (const c of corpos) {
      const p = await putItem(id, c);
      if (!p.ok) { console.log(`RESTAURO FALHOU (HTTP ${p.http})`); return false; }
    }
  }
  let d: Rec = null;
  for (const ms of [0, 5000, 15000]) {
    await espera(ms);
    try { d = await snap(id, `${passo}-restaurado`); } catch (e) { console.log(`GET do restauro falhou: ${e}`); continue; }
    if (semTags(d) === semTags(antes)) { await evid(id, passo, 'restaurado', d, { conferido_igual_ao_antes: true }); return true; }
  }
  if (d) await evid(id, passo, 'restaurado', d, { conferido_igual_ao_antes: false });
  console.log(`RESTAURO NÃO CONFERIDO\nANTES ${semTags(antes)}\nDEPOIS ${d ? semTags(d) : '(sem leitura)'}`);
  return false;
}

// Experimento só-fotos: guarda → restauro preparado → PUT → GET confere o corpo → restaura (SEMPRE, finally)
// → GET confere o retrato → só então grava a evidência (que nunca lança).
export async function put(id: string, arquivo: string, passo: string): Promise<number> {
  const corpo = JSON.parse(await Deno.readTextFile(arquivo));
  const antes = await snap(id, `${passo}-antes`);
  guarda(antes);
  corpoSoFotos(corpo, antes);
  const restauro = corpoRestauro(antes);
  await Deno.writeTextFile(`${cfg.saida}/${id}-${passo}-restauro.json`, JSON.stringify(restauro)); // preparado antes da escrita
  await evid(id, passo, 'antes', antes);
  let p = { ok: false, http: 0, quando: '' };
  let depois: Rec = null;
  let erros: string[] = ['sem leitura pós-PUT'];
  let ok = false;
  try {
    p = await putItem(id, corpo);
    depois = await snap(id, `${passo}-depois`);
    erros = p.ok ? conferirCorpo(corpo, antes, depois) : (semTags(depois) === semTags(antes) ? ['PUT recusado; nada mudou'] : ['PUT recusado E item mudou']);
  } catch (e) {
    console.log(`falha entre o PUT e a leitura: ${e}`); // estado desconhecido: o finally restaura e confere
  } finally {
    ok = depois && semTags(depois) === semTags(antes) ? true : await restaurar(id, passo, antes, [restauro]);
  }
  if (depois) await evid(id, passo, 'depois', depois, { http: p.http, put_utc: p.quando, corpo_enviado: corpo, conferencia: erros.length ? erros : 'igual ao corpo enviado' });
  if (depois && semTags(depois) === semTags(antes)) await evid(id, passo, 'restaurado', depois, { conferido_igual_ao_antes: true, nota: 'nada mudou; sem PUT de restauro' });
  console.log(JSON.stringify({ medicao: erros.length ? 'REPROVOU' : 'ok', erros, restauro_conferido: ok }, null, 2));
  if (!ok) return 4;
  if (!p.ok) return 1;
  return erros.length ? 2 : 0;
}

async function upload(id: string, pictureId: string): Promise<number> {
  if (!PERMITIDOS.has(id)) throw new Error('item fora da lista autorizada');
  const it = await getItem(id);
  const foto = (it.pictures ?? []).find((p: Rec) => p.id === pictureId);
  if (!foto) throw new Error(`foto ${pictureId} não pertence a ${id}`); // nunca imagem alheia
  const ext = foto.secure_url.endsWith('.webp') ? 'webp' : 'jpg';
  // secure_url do item (D_…-O) é a versão de 500 px; a original está em D_NQ_NP_<id>-F (medido no ensaio).
  const bytes = new Uint8Array(await (await fetch(`https://http2.mlstatic.com/D_NQ_NP_${pictureId}-F.${ext}`)).arrayBuffer());
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: ext === 'webp' ? 'image/webp' : 'image/jpeg' }), `${pictureId}.${ext}`);
  const t0 = Date.now();
  const r = await fetch(`${API}/pictures/items/upload`, { method: 'POST', headers: { ...auth, 'User-Agent': 'Mozilla/5.0' }, body: form });
  const txt = await r.text();
  console.log(JSON.stringify({ endpoint: '/pictures/items/upload', http: r.status, ms: Date.now() - t0, bytes: bytes.length, origem: pictureId }));
  if (!r.ok) { console.log(txt.slice(0, 500)); return 1; }
  const up = JSON.parse(txt);
  await Deno.writeTextFile(`${cfg.saida}/upload-${up.id}.json`, txt);
  // Contrato observado (só nomes de campos e ids públicos de foto).
  const contrato = {
    endpoint: 'POST /pictures/items/upload (multipart, campo file)', http: r.status, horario_utc: new Date().toISOString(),
    campos_resposta: Object.keys(up).sort(), id: up.id, status: up.status, max_size: up.max_size,
    variations_campos: [...new Set((up.variations ?? []).flatMap((v: Rec) => Object.keys(v)))].sort(),
    variations_tem_id: (up.variations ?? []).some((v: Rec) => 'id' in v),
    variations_qtd: (up.variations ?? []).length,
  };
  await Deno.writeTextFile(new URL(`upload-contrato-${up.id}.json`, cfg.evid), JSON.stringify(contrato, null, 2) + '\n');
  console.log(JSON.stringify(contrato, null, 2));
  return 0;
}

// (h) O inverso: PUT SEM fotos, com os valores ATUAIS lidos no GET imediatamente antes (nada muda de fato).
//   estoque → Legacy { variations: [{ id, available_quantity }] } (todas)  — atualizarEstoque/montarVariacoesUpdate
//   preco   → Legacy { variations: [{ id, price }] } (todas)              — reajuste/ml.ts putPreco
//   plano   → UP     { price, available_quantity }                        — atualizarItemPlanoML / kit putQuantidade
// Confere o recorte inteiro logo depois e ~60 s depois; se mudar, restaura (fotos e valores) e confere por GET.
const AUTORIZADO_H: Record<string, string> = { estoque: 'MLB7168683146', preco: 'MLB7168683146', plano: 'MLB7245326808' };
export async function inverso(modo: string): Promise<number> {
  const id = AUTORIZADO_H[modo];
  if (!id) throw new Error('modo: estoque | preco | plano');
  const passo = `h-${modo}`;
  const antes = await snap(id, `${passo}-antes`);
  guarda(antes);
  const vs = antes.variations;
  if ((modo === 'plano') !== (vs.length === 0)) throw new Error(`BLOCKED: formato inesperado (${vs.length} variações)`);
  const corpo = modo === 'estoque' ? { variations: vs.map((v: Rec) => ({ id: v.id, available_quantity: v.available_quantity })) }
    : modo === 'preco' ? { variations: vs.map((v: Rec) => ({ id: v.id, price: v.price })) }
    : { price: antes.price, available_quantity: antes.available_quantity };
  // Preço promocional no GET reenviado como `price` sobrescreveria o preço-base: só segue sem promoção ativa.
  const precos = async () => {
    const it = await getItem(id);
    const p = await (await fetch(`${API}/items/${id}/prices`, { headers: { ...auth, 'show-all-prices': 'TRUE' } })).json();
    return { original_price: it.original_price, var_original: (it.variations ?? []).map((v: Rec) => v.original_price ?? null), prices: p.prices ?? p };
  };
  const precoAntes = await precos();
  if (modo !== 'estoque') {
    const lista: Rec[] = Array.isArray(precoAntes.prices) ? precoAntes.prices : [];
    const padrao = lista.filter((x) => x.type === 'standard');
    const alvos = vs.length ? vs.map((v: Rec) => v.price) : [antes.price];
    if (precoAntes.original_price != null || precoAntes.var_original.some((x: unknown) => x != null) || lista.length !== padrao.length
      || !padrao.length || !alvos.every((a: number) => padrao.some((s) => s.amount === a))) {
      throw new Error('BLOCKED: preço com promoção/original_price ou standard != GET — PUT de preço não enviado');
    }
  }
  const restauros = [corpoRestauro(antes), corpo];
  await Deno.writeTextFile(`${cfg.saida}/${id}-${passo}-restauro.json`, JSON.stringify(restauros)); // preparado antes da escrita
  await evid(id, passo, 'antes', antes);
  let p = { ok: false, http: 0, quando: '' };
  const leituras: { ms: number; d: Rec; erros: string[] }[] = [];
  // Só é conferida com PUT 2xx E as DUAS leituras (imediata e ~60 s) feitas e iguais ao retrato.
  // Qualquer leitura que lance deixa a medição não conferida e força reconciliação + restauro + GET de conferência.
  let conferida = false;
  let leituraFalhou = false;
  let restauro: 'desnecessario' | 'conferido' | 'nao_conferido' = 'desnecessario';
  try {
    p = await putItem(id, corpo);
    for (const ms of [0, 60_000]) {
      await espera(ms);
      const d = await snap(id, `${passo}-depois${ms}`);
      const erros = conferirCorpo({}, antes, d); // corpo sem fotos: fotos e resto têm de ficar iguais ao antes
      leituras.push({ ms, d, erros });
      if (!p.ok || erros.length) break;
    }
    conferida = p.ok && leituras.length === 2 && leituras.every((l) => !l.erros.length);
  } catch (e) {
    leituraFalhou = true;
    console.log(`falha entre o PUT e a leitura: ${e}`);
  } finally {
    if (!conferida) restauro = await restaurar(id, passo, antes, restauros) ? 'conferido' : 'nao_conferido';
  }
  for (const l of leituras) {
    await evid(id, passo, `depois-${l.ms / 1000}s`, l.d, { http: p.http, put_utc: p.quando, corpo_enviado: corpo, conferencia: l.erros.length ? l.erros : 'igual ao antes' });
  }
  // /prices (atacado incluso): leitura de conferência que falha reprova; nunca vira ok.
  let precoDepois: Rec = null;
  try { precoDepois = await precos(); } catch (e) { leituraFalhou = true; console.log(`/prices depois falhou: ${e}`); }
  const precosIguais = precoDepois !== null && JSON.stringify(precoAntes) === JSON.stringify(precoDepois);
  try {
    await Deno.writeTextFile(new URL(`${id}-${passo}-prices.json`, cfg.evid), JSON.stringify({ mlb: id, passo, precos_antes: precoAntes, precos_depois: precoDepois, iguais: precosIguais }, null, 2) + '\n');
  } catch (e) { console.log(`EVIDÊNCIA /prices NÃO GRAVADA: ${e}`); }
  const medicao = leituraFalhou ? 'nao_conferida' : !p.ok ? 'put_recusado' : (!conferida || !precosIguais) ? 'REPROVOU' : 'ok';
  console.log(JSON.stringify({ medicao, http: p.http, precos_iguais: precosIguais, restauro }));
  if (restauro === 'nao_conferido') return 4;
  return { ok: 0, put_recusado: 1, REPROVOU: 2, nao_conferida: 3 }[medicao];
}

if (import.meta.main) {
  const [cmd, a, b, c] = Deno.args;
  await Deno.mkdir(cfg.saida, { recursive: true });
  await Deno.mkdir(cfg.evid, { recursive: true });
  definirToken(await tokenML());
  let codigo = 0;
  if (cmd === 'inverso') codigo = await inverso(a);
  else if (cmd === 'snap') { const r = await snap(a, b); await evid(a, b, 'get', r); console.log(JSON.stringify(r, null, 2)); }
  else if (cmd === 'upload') codigo = await upload(a, b);
  else if (cmd === 'put') codigo = await put(a, b, c);
  else { console.error('uso: snap <MLB> <passo> | upload <MLB> <picture_id> | put <MLB> <corpo.json> <passo> | inverso <modo>'); codigo = 64; }
  Deno.exit(codigo);
}
