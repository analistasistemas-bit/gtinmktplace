// ADR-0135 D-1 — porta de dados fiscais do canal ML (fiscal_information + can_invoice).
// Payload conforme developers.mercadolivre.com.br/pt_br/envio-dos-dados-fiscais.
// ⚠ Semântica de upsert (POST→409→PUT) e unidades de peso: "A verificar #2" do ADR —
// validar em conta real antes de ligar para cliente.
import { gtinValido } from '../nfe/regras.ts';

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
}

export function montarFiscalInformation(
  familia: FamiliaFiscalPush,
  variacao: VariacaoFiscalPush,
  empresa: { origin_type: string | null },
): Record<string, unknown> {
  const tax: Record<string, unknown> = {
    ncm: familia.ncm,
    origin_detail: String(familia.origem_nfe),
    csosn: familia.tributacao_icms, // v1 é Simples-only; o gate (D-7) garante isso antes.
    // ML exige aqui dentro (400 "tax_information.origin_type is required", Zaven 17/10); o da
    // raiz foi aceito sem erro e fica por compatibilidade.
    origin_type: empresa.origin_type,
  };
  if (familia.cest) tax.cest = familia.cest;
  if (familia.fci) tax.fci = familia.fci;
  if (familia.ex_tipi) tax.ex_tipi = familia.ex_tipi;
  // A5 (auditoria fiscal 19/10): EAN fiscal só com GTIN real — `3000…` é código interno e
  // dígito verificador errado/comprimento inválido o ML recusaria. Valida o MESMO valor enviado.
  const ean = variacao.gtin?.trim();
  if (ean && !ean.startsWith('3000') && gtinValido(ean)) tax.ean = ean;
  return {
    sku: variacao.codigo,
    title: familia.descricao_fiscal?.trim() || familia.nome_pai,
    type: 'single',
    measurement_unit: (familia.unidade ?? 'UN').toUpperCase().trim(),
    origin_type: empresa.origin_type,
    ...(variacao.peso_gramas != null
      ? { gross_weight: Number((variacao.peso_gramas / 1000).toFixed(3)) }
      : {}),
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
