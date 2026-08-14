// Contrato do matcher confirm do ML, extraído do bundle optin-user-products (2026-08-13).
// REPLICA getMappedGroups literalmente: variations.filter(e => !e.status), entity_id sem
// conversão de tipo, match?.product?.id || null. Ver spec 2026-08-12, seção "Contrato".
// Puro: sem chrome.*, sem DOM — testado por vitest, importado pelo painel via ESM.

export function extrairEstadoOptin(ctx) {
  // Busca estrutural pelo initialOptinData ({step, step_data, ...contexto}) no JSON SSR da
  // página — o invólucro exato do __NORDIC_RENDERING_CTX__ não é documentado, a forma interna é.
  const visto = new Set();
  const fila = [ctx];
  while (fila.length) {
    const atual = fila.shift();
    if (!atual || typeof atual !== 'object' || visto.has(atual)) continue;
    visto.add(atual);
    if ('step' in atual && 'step_data' in atual) {
      const { step, step_data: stepData, ...contextData } = atual;
      return { step, stepData, contextData };
    }
    for (const v of Object.values(atual)) fila.push(v);
  }
  return null;
}

export function montarPlanoAnuncio(estado, variacoesRisco, vinculos) {
  if (!estado) return { tipo: 'manual', motivo: 'estado_nao_encontrado' };
  const groups = estado.stepData?.groups;
  if (!Array.isArray(groups) || groups.length === 0) return { tipo: 'manual', motivo: 'sem_groups_no_estado' };
  const productId = estado.stepData?.parent_catalog_product?.id
    ?? estado.contextData?.original_catalog_product_id ?? null;
  if (!productId) return { tipo: 'manual', motivo: 'sem_parent_product_id' };
  const flow = estado.contextData?.flow ?? estado.contextData?.flow_type ?? null;
  if (!flow) return { tipo: 'manual', motivo: 'sem_flow' };

  const risco = new Set(variacoesRisco.map(String));
  const confirmedProductMatches = [];
  const resumo = { null_enviados: [], preservados: [], excluidos_por_status: [], risco_ausente: [] };

  for (const g of groups) {
    const todas = Array.isArray(g?.variations) ? g.variations : [];
    const matches = [];
    for (const v of todas) {
      if (v?.status) { resumo.excluidos_por_status.push(String(v.id)); continue; } // filtro do ML
      if (v?.id == null) return { tipo: 'manual', motivo: 'variacao_sem_id' };
      const id = String(v.id);
      const naPagina = v?.match?.product?.id ?? null;
      const confirmado = vinculos[id];

      // Vínculo confirmado tem PRECEDÊNCIA sobre a lista de risco. Motivo (medido na Linha Liza
      // MLB7159179348, 2026-08-13): o mesmo ml_variation_id existe em duas famílias do mesmo
      // anúncio (CREATE + UPDATE) e pode carregar status contraditórios — 'vinculado' numa linha
      // e 'nao_elegivel' na outra. Com o risco vencendo, a variação que está competindo iria como
      // null e o vínculo bom seria desfeito — exatamente o dano que este código existe para evitar.
      if (confirmado) {
        if (!naPagina) return { tipo: 'manual', motivo: `vinculo_sem_match_na_pagina:${id}` };
        if (confirmado !== naPagina) return { tipo: 'manual', motivo: `vinculo_divergente:${id}` };
        matches.push({ entity_id: v.id, catalog_product_id: naPagina }); // preserva
        resumo.preservados.push(id);
        continue;
      }

      if (risco.has(id)) {
        matches.push({ entity_id: v.id, catalog_product_id: null }); // "Não encontro minha variação"
        resumo.null_enviados.push(id);
        continue;
      }
      if (!naPagina) return { tipo: 'manual', motivo: `variacao_sem_decisao:${id}` };
      return { tipo: 'manual', motivo: `match_nao_confirmado:${id}` };
    }
    confirmedProductMatches.push({
      group_attributes: (g?.match_product?.attributes ?? []).map(
        ({ id, name, value_id, value_name }) => ({ id, name, value_id, value_name }),
      ),
      matches,
    });
  }

  for (const id of risco) if (!resumo.null_enviados.includes(id)) resumo.risco_ausente.push(id);
  if (resumo.null_enviados.length === 0) return { tipo: 'manual', motivo: 'nenhuma_variacao_risco_no_matcher', resumo };
  return { tipo: 'ok', productId, flow, confirmedProductMatches, resumo };
}

export function montarUrlOptinUp(basePath, itemId, recurso) {
  return `${String(basePath).replace(/\/+$/, '')}/api/optin-up/${itemId}/${recurso}`;
}

const mesmoConjunto = (a, b) =>
  JSON.stringify([...a].map(String).sort()) === JSON.stringify([...b].map(String).sort());

export function interpretarRespostaMatcher(corpo, plano) {
  const sd = corpo?.step_data;
  if (!sd) return { acao: 'manual', motivo: 'resposta_sem_product_associations' };
  if (sd.add_invoice) return { acao: 'manual', motivo: 'exige_invoice' };
  if (sd.anatel_data) return { acao: 'manual', motivo: 'exige_anatel' };

  // Caminho de INVALIDAÇÃO (observado em produção no 1º envio, MLB7066697288 em 2026-08-13):
  // quando TODAS as variações vão como null, o ML não devolve MULTI_VARIATION_SUMMARY e sim
  // INVALIDATION_SUMMARY, e a 2ª chamada vira POST invalidate_summary_confirm. Mesmo guard de
  // eco: a lista que o servidor computou tem que ser exatamente a que mandamos como null.
  if (Array.isArray(sd.invalidate_variations)) {
    if (!mesmoConjunto(sd.invalidate_variations, plano?.resumo?.null_enviados ?? [])) {
      return { acao: 'manual', motivo: 'eco_divergente' };
    }
    const productId = sd.product_association?.catalog_product_id;
    if (!productId) return { acao: 'manual', motivo: 'resposta_sem_parent_product' };
    return {
      acao: 'invalidate',
      productId,
      variationId: sd.product_association?.variation_id ?? null,
      invalidateVariations: sd.invalidate_variations,
    };
  }

  if (!Array.isArray(sd.product_associations)) return { acao: 'manual', motivo: 'resposta_sem_product_associations' };
  const parentProductId = sd.parent_catalog_product?.id;
  if (!parentProductId) return { acao: 'manual', motivo: 'resposta_sem_parent_product' };
  // Guard de eco: o conjunto de variações que o servidor computou como null tem que ser
  // exatamente o que o plano mandou como null. Divergiu → o servidor entendeu outra coisa; parar.
  // A variação é identificada por `variation_id` — no MASSIVE_SUMMARY real o `entity_id` é o ITEM,
  // repetido em todas as linhas (medido na Linha Liza, 2026-08-13). O fallback para entity_id
  // cobre o item plano, que não tem variação.
  const idDaAssociacao = (a) => String(a?.variation_id ?? a?.entity_id);
  const nullServidor = sd.product_associations.filter((a) => !a?.catalog_product_id).map(idDaAssociacao);
  if (!mesmoConjunto(nullServidor, plano?.resumo?.null_enviados ?? [])) {
    return { acao: 'manual', motivo: 'eco_divergente' };
  }
  return { acao: 'summary', parentProductId, productAssociations: sd.product_associations };
}
