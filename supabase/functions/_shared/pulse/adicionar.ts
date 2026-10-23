// Núcleo de "adicionar ao radar" (ADR-0119), usado pelo pulse-adicionar (app) e pela extensão (ADR-0189 D-10).
// Quem chama já validou sessão, escrita, módulo Pulse e a conexão ML. Só API oficial do ML (sem coleta, sem Apify).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
const API = 'https://api.mercadolibre.com';
export const MENSAGEM_ML_INDISPONIVEL = 'O Mercado Livre não respondeu agora. Tente de novo em instantes.';

/** Ficha do catálogo: só 404 prova que ela não existe; 5xx/timeout é falha transitória (o mlGet junta os dois). */
async function lerFicha(catalogProductId: string, token: string): Promise<{ nome: string | null } | 'inexistente' | 'falha'> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const r = await fetch(`${API}/products/${catalogProductId}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      if (r.status === 404) return 'inexistente';
      if (r.ok) return { nome: ((await r.json()) as { name?: string } | null)?.name ?? null };
      if (r.status !== 429 && r.status < 500) return 'falha';
      if (r.status === 429 && tentativa === 0) await new Promise((ok) => setTimeout(ok, 1500));
    } catch { /* timeout/rede: tenta mais uma vez */ }
  }
  return 'falha';
}

export type ResultadoAdicionar =
  | { ok: true; produtoId: string; jaExistia: boolean }
  | { ok: false; motivo: 'ficha_inexistente' | 'erro'; mensagem?: string };

/** `gtin` = o que o operador digitou (null → usa o da nossa variação vinculada à ficha). Idempotente. */
export async function adicionarAoRadar(
  admin: SupabaseClient, orgId: string, catalogProductId: string, token: string, gtinInformado: string | null,
): Promise<ResultadoAdicionar> {
  const ficha = await lerFicha(catalogProductId, token);
  // Ficha inexistente (link `/p/MLB999…` digitado errado) criava uma linha morta no radar: o
  // coletor devolve null para sempre e a tela fica em "Ainda sem a primeira coleta" eternamente.
  if (ficha === 'inexistente') return { ok: false, motivo: 'ficha_inexistente' };
  if (ficha === 'falha') return { ok: false, motivo: 'erro', mensagem: MENSAGEM_ML_INDISPONIVEL };
  const titulo = ficha.nome;

  // Já está no radar? Reaproveita a linha em vez de sobrescrevê-la. O upsert incondicional
  // rebaixava `origem` de 'auto' para 'manual' e forçava `status: 'ativo'` — e as consequências
  // são silenciosas: o tier quente pula produto manual, a referência de preço do ML congela, o
  // arquivamento automático não o alcança e a tela passa a dizer "você não vende este produto"
  // sobre produto que o operador vende. O `origem` voltaria sozinho no próximo tier completo
  // (`sincronizarRadar` reenvia 'auto'), mas o `status` não volta nunca: `sincronizarRadar` omite
  // `status` de propósito, para preservar o pausar/reativar do operador.
  const { data: existente, error: erroLeitura } = await admin.from('pulse_produtos')
    .select('id, status').eq('org_id', orgId).eq('catalog_product_id', catalogProductId).maybeSingle();
  // Leitura falhou: não cai no upsert (que rebaixaria `origem`/forçaria `status` de uma linha existente).
  if (erroLeitura) return { ok: false, motivo: 'erro', mensagem: erroLeitura.message };
  if (existente) {
    // Exceção deliberada: readicionar uma ficha arquivada é um pedido explícito de trazê-la de
    // volta. Só o `status` muda — `origem` continua o que era.
    if (existente.status === 'arquivado') {
      const { error } = await admin.from('pulse_produtos').update({ status: 'ativo' }).eq('id', existente.id).eq('org_id', orgId);
      if (error) return { ok: false, motivo: 'erro', mensagem: error.message };
    }
    return { ok: true, produtoId: existente.id as string, jaExistia: true };
  }

  // GTIN: o que o operador digitou, ou o da nossa variação vinculada a essa ficha (a ficha do ML
  // não expõe EAN nos atributos — verificado).
  let gtin = gtinInformado;
  if (!gtin) {
    const { data: v } = await admin.from('variacoes')
      .select('gtin').eq('org_id', orgId).eq('catalog_product_id', catalogProductId)
      .not('gtin', 'is', null).limit(1).maybeSingle();
    gtin = (v?.gtin as string | undefined) ?? null;
  }

  const { data, error } = await admin.from('pulse_produtos')
    .upsert(
      { org_id: orgId, catalog_product_id: catalogProductId, titulo, gtin, origem: 'manual', status: 'ativo' },
      { onConflict: 'org_id,catalog_product_id' },
    )
    .select('id').single();
  if (error) return { ok: false, motivo: 'erro', mensagem: error.message };
  return { ok: true, produtoId: data.id as string, jaExistia: false };
}
