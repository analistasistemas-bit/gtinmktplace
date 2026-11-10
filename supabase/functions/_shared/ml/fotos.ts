// POST /pictures com { source } (validado no bug bash Task 13: /pictures/items/upload
// retornava 405 tengine; /pictures aceita JSON e retorna o picture id).
export async function subirFotoML(accessToken: string, sourceUrl: string): Promise<string> {
  const resp = await fetch('https://api.mercadolibre.com/pictures', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: sourceUrl }),
  });
  if (!resp.ok) {
    throw new Error(`Falha ao subir foto (${resp.status}): ${await resp.text()}`);
  }
  const json = await resp.json();
  return json.id as string;
}

// Galeria da cor: upload dos bytes do arquivo final. Contrato medido no ensaio da Task 1
// (docs/superpowers/specs/2026-11-08-galeria-da-cor-ensaio-put.md, (e)): multipart `file` com
// `User-Agent` de navegador → 201 { id, status: 'ACTIVE', variations[].secure_url } (o 405 do
// comentário acima não se repetiu). `pronta` = ACTIVE com URL real (R9.2); o id é o mesmo no PUT e
// no GET do item. Mesmos bytes → id novo (sem deduplicação): quem chama nunca re-sobe.
export async function subirFotoMLArquivo(
  accessToken: string, bytes: Uint8Array<ArrayBuffer>, mime: string, f: typeof fetch = fetch,
): Promise<{ id: string; pronta: boolean }> {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), `galeria.${mime.split('/')[1] ?? 'jpg'}`);
  const resp = await f('https://api.mercadolibre.com/pictures/items/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'Mozilla/5.0' },
    body: form,
    // Timeout = upload incerto (erro sem `.status`): o ML pode ter criado a foto; quem chama não re-sobe às cegas.
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    const e = new Error(`Falha ao subir foto (${resp.status}): ${await resp.text()}`);
    (e as { status?: number }).status = resp.status;
    throw e;
  }
  const json = await resp.json().catch(() => ({})) as { id?: unknown; status?: unknown; variations?: Array<{ secure_url?: unknown }> };
  if (typeof json.id !== 'string' || !json.id) throw new Error('O Mercado Livre não devolveu o id da foto enviada.');
  const pronta = String(json.status ?? '').toUpperCase() === 'ACTIVE'
    && (json.variations ?? []).some((v) => typeof v?.secure_url === 'string' && v.secure_url !== '');
  return { id: json.id, pronta };
}

// `GET /pictures/{id}`: bug real do Kit Virtual (2026-09-06) — o POST /items/kits recusa com
// `thumbnail.secureUrl must not be null` quando o payload manda só `thumbnail.id` (a doc oficial
// mostra o `id` sozinho, mas o ML exige os dois na prática). A resposta deste endpoint NÃO tem
// `secure_url` no topo (chaves reais: id, max_size, dominant_color, hash, crop, variations,
// status, origin) — só dentro de `variations[].secure_url`. Chamado sempre, tanto pro picture_id
// recém-subido quanto pro que já estava salvo de um upload anterior (D-5): não há retorno de
// upload pra reaproveitar nesse segundo caso.
export async function buscarSecureUrlFotoML(accessToken: string, pictureId: string): Promise<string> {
  const resp = await fetch(`https://api.mercadolibre.com/pictures/${pictureId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`Falha ao buscar a foto no Mercado Livre (${resp.status}): ${await resp.text()}`);
  }
  const json = await resp.json().catch(() => ({})) as { variations?: { secure_url?: unknown }[] };
  const secureUrl = json.variations?.[0]?.secure_url;
  if (typeof secureUrl !== 'string' || !secureUrl) {
    throw new Error('O Mercado Livre não devolveu a URL segura (secure_url) da foto.');
  }
  return secureUrl;
}

// Galeria da cor (ADR-0201, Task 14): a foto subida já está pronta? (`status` ACTIVE com `secure_url`, R9.2). Nunca
// re-sobe: quem chama só consulta até ficar pronta. Qualquer falha de leitura = null (consulta de novo no próximo tick).
export async function lerFotoProntaML(accessToken: string, pictureId: string, f: typeof fetch = fetch): Promise<boolean | null> {
  try {
    const resp = await f(`https://api.mercadolibre.com/pictures/${encodeURIComponent(pictureId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => ({})) as { status?: unknown; variations?: Array<{ secure_url?: unknown }> };
    return String(json.status ?? '').toUpperCase() === 'ACTIVE'
      && (json.variations ?? []).some((v) => typeof v?.secure_url === 'string' && v.secure_url !== '');
  } catch {
    return null;
  }
}
