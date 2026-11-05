// ADR-0135 D-1 — porta de dados fiscais do canal ML (fiscal_information + can_invoice).
// Payload conforme developers.mercadolivre.com.br/pt_br/envio-dos-dados-fiscais.
// ⚠ Semântica de upsert (POST→409→PUT): "A verificar #2" do ADR — validar em conta real.
// Peso (contrato lido em 20/10/2026): `net_weight`/`gross_weight` em kg ficam DENTRO de
// tax_information; só enviamos gross_weight (peso_gramas é peso de pacote, não há peso líquido real).
import { gtinValido } from '../nfe/regras.ts';
import { caminhoMultiget, comoEnvelopeAntigo } from '../ml/multiget.ts';

const BASE = 'https://api.mercadolibre.com';

function erroMl(op: string, status: number, corpo: string): Error & { status: number } {
  const e = new Error(`${op} → ${status}: ${corpo.slice(0, 300)}`) as Error & { status: number };
  e.status = status;
  return e;
}

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
});

export interface FamiliaFiscalPush {
  nome_pai: string; unidade: string | null; ncm: string | null; cest: string | null;
  origem_nfe: number | null; fci: string | null; ex_tipi: string | null;
  tributacao_icms: string | null;
  /** ADR-0181 D-5: texto da nota de venda. null/vazio = usa nome_pai. */
  descricao_fiscal: string | null;
}
export interface VariacaoFiscalPush {
  codigo: string; gtin: string | null; peso_gramas: number | null; ml_variation_id: string | null;
  cor?: string | null;
}

/** Emenda ADR-0181 D-5 (05/11/2026): o `title` vira o xProd da nota e é gravado por SKU. Texto da
 *  família que cita uma cor dela (nome herdado de quando só existia aquela cor) sairia igual em
 *  todas as variações; aqui a cor citada vira a do SKU. Texto neutro não muda.
 *  ponytail: só reconhece cores cadastradas na família ("Short Azul" com cor "Azul Claro" passa). */
function tituloDoSku(texto: string, corSku: string | null | undefined, coresFamilia: string[]): string {
  const cores = [...new Set(coresFamilia.map((c) => c.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (cores.length === 0) return texto;
  const citada = new RegExp(`(?<![\\p{L}\\p{N}])(?:${cores.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  return texto.replace(citada, corSku?.trim() ?? '').replace(/\s+/g, ' ').trim() || texto;
}

export function montarFiscalInformation(
  familia: FamiliaFiscalPush,
  variacao: VariacaoFiscalPush,
  empresa: { origin_type: string | null },
  coresFamilia: string[] = [],
): Record<string, unknown> {
  const tax: Record<string, unknown> = {
    ncm: familia.ncm,
    origin_detail: String(familia.origem_nfe),
    csosn: familia.tributacao_icms, // v1 é Simples-only; o gate (D-7) garante isso antes.
    // ML exige aqui dentro (400 "tax_information.origin_type is required", Zaven 17/10); o da
    // raiz foi aceito sem erro e fica por compatibilidade.
    origin_type: empresa.origin_type,
  };
  // M2 (auditoria fiscal 19/10): gross_weight na raiz era ignorado/recusado pelo ML.
  if (variacao.peso_gramas != null) tax.gross_weight = Number((variacao.peso_gramas / 1000).toFixed(3));
  if (familia.cest) tax.cest = familia.cest;
  if (familia.fci) tax.fci = familia.fci;
  if (familia.ex_tipi) tax.ex_tipi = familia.ex_tipi;
  // A5 (auditoria fiscal 19/10): EAN fiscal só com GTIN real — `3000…` é código interno e
  // dígito verificador errado/comprimento inválido o ML recusaria. Valida o MESMO valor enviado.
  const ean = variacao.gtin?.trim();
  if (ean && !ean.startsWith('3000') && gtinValido(ean)) tax.ean = ean;
  return {
    sku: variacao.codigo,
    title: tituloDoSku(familia.descricao_fiscal?.trim() || familia.nome_pai, variacao.cor, coresFamilia),
    type: 'single',
    measurement_unit: (familia.unidade ?? 'UN').toUpperCase().trim(),
    origin_type: empresa.origin_type,
    tax_information: tax,
  };
}

/** Upsert por SKU: POST cria; 409 (SKU já existe) → PUT atualiza. Idempotente por natureza. */
export async function empurrarFiscalSku(token: string, payload: Record<string, unknown>): Promise<void> {
  const post = await fetch(`${BASE}/items/fiscal_information`, {
    method: 'POST', headers: headers(token), body: JSON.stringify(payload),
  });
  if (post.ok) return;
  if (post.status === 409) {
    const put = await fetch(`${BASE}/items/fiscal_information/${payload.sku}`, {
      method: 'PUT', headers: headers(token), body: JSON.stringify(payload),
    });
    if (put.ok) return;
    throw erroMl('PUT fiscal_information', put.status, await put.text());
  }
  throw erroMl('POST fiscal_information', post.status, await post.text());
}

export async function vincularSkuAnuncio(
  token: string, v: { sku: string; item_id: string; variation_id?: string },
): Promise<void> {
  const resp = await fetch(`${BASE}/items/fiscal_information/items`, {
    method: 'POST', headers: headers(token), body: JSON.stringify(v),
  });
  // 409 = vínculo já existe (replay do QStash) — sucesso idempotente.
  if (resp.ok || resp.status === 409) return;
  throw erroMl('POST fiscal_information/items', resp.status, await resp.text());
}

export interface RelacaoItem { id: string; variation_id: string | null }

/** Emenda 01/11/2026 — `item_relations` de cada anúncio (cópias de catálogo). 404 no lote é
 *  definitivo; envelope inválido vira 502 (transitório): nunca pode virar recusa definitiva. */
export async function lerRelacoes(token: string, itemIds: string[]): Promise<Map<string, RelacaoItem[]>> {
  const out = new Map<string, RelacaoItem[]>();
  const ids = [...new Set(itemIds)];
  for (let i = 0; i < ids.length; i += 20) {
    const bloco = ids.slice(i, i + 20);
    const resp = await fetch(`${BASE}${caminhoMultiget(bloco, 'id,item_relations')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw erroMl('GET items/bulk', resp.status, await resp.text());
    const arr = comoEnvelopeAntigo(await resp.json(), bloco);
    for (const e of Array.isArray(arr) ? arr : [null]) {
      const { code, body } = (e ?? {}) as { code?: number; body?: { id?: string; item_relations?: unknown } };
      if (code === 404) throw erroMl('GET items/bulk', 404, JSON.stringify(e));
      if (code !== 200 || typeof body?.id !== 'string') throw erroMl('GET items/bulk', 502, JSON.stringify(e));
      const rels = Array.isArray(body.item_relations) ? body.item_relations as Array<{ id?: unknown; variation_id?: unknown }> : [];
      out.set(body.id, rels.filter((r) => typeof r.id === 'string').map((r) => ({
        id: r.id as string, variation_id: r.variation_id == null ? null : String(r.variation_id),
      })));
    }
  }
  return out;
}

/** Emenda D-10 (19/10/2026): `GET /can_invoice/items/{id}` dá 403 PolicyAgent pro app mesmo com o
 *  emissor configurado (Zaven) — a prontidão passa a vir do `can_invoice` do SKU em
 *  fiscal_information. 404 = SKU nunca aceito no ML (ex.: NCM recusado) → pendência, não falha. */
export async function lerCanInvoice(
  token: string, sku: string,
): Promise<{ pronto: boolean; causa: string | null } | null> {
  const resp = await fetch(`${BASE}/items/fiscal_information/${encodeURIComponent(sku)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 404) return { pronto: false, causa: 'SKU sem dados fiscais no ML' };
  if (!resp.ok) {
    console.warn(`fiscal_information ${resp.status} para SKU ${sku}`);
    return null;
  }
  const j = await resp.json() as { can_invoice?: boolean } & Record<string, unknown>;
  const pronto = j.can_invoice === true;
  return { pronto, causa: pronto ? null : JSON.stringify(j).slice(0, 500) };
}
