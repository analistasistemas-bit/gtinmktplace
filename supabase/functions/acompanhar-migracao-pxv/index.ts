// ADR-0161 — worker QStash que acompanha a migração UPtin e adota os anúncios novos.
//
// Toda a decisão vive em `processar.ts` (testável sem rede); aqui ficam assinatura, portas e
// transporte. Sempre 200: o worker controla a própria repetição (re-enfileira com backoff e
// orçamento), então deixar o QStash retentar criaria uma segunda cadeia sobre o mesmo episódio.

import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura, enfileirarAcompanhamentoMigracaoPxv, enfileirarSincronizacaoEstoque, enfileirarVinculacaoCatalogo, type AcompanharMigracaoPxvJob } from '../_shared/queue.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { lerStatusUPtin, type VariacaoSnapshot } from '../_shared/ml/migracao-pxv.ts';
import { corDaVariacaoML } from '../_shared/ml/atualizar-item.ts';
import { criarPortasRevinculo } from '../_shared/user-products/portas-supabase.ts';
import { adotarFamiliaMigrada } from '../_shared/user-products/adotar-familia-migrada.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import {
  acompanharMigracaoPxv, DELAY_ATIVANDO_S, MAX_TENTATIVAS, type PortasAcompanhamento,
} from './processar.ts';

const CANAL = 'mercado_livre';
const API = 'https://api.mercadolibre.com';

Deno.serve(async (req) => {
  const body = await req.text();
  if (!await verificarAssinatura(req, body)) {
    return new Response('assinatura inválida', { status: 401, headers: corsHeaders });
  }
  const job = JSON.parse(body) as AcompanharMigracaoPxvJob;
  const { org_id: orgId, codigo_pai: codigoPai, tentativa } = job;

  const admin = adminClient();
  const conexao = await resolverConexao(admin, orgId, CANAL);
  if (!conexao) {
    console.error(`acompanhar-migracao-pxv: org ${orgId} sem conexão ML`);
    return new Response(JSON.stringify({ ok: false }), { headers: corsHeaders });
  }
  const getToken = () => getValidAccessTokenConexao(conexao);

  const atualizarRaiz = (patch: Record<string, unknown>) => admin.from('anuncios_externos')
    .update(patch)
    .eq('org_id', orgId).eq('canal', CANAL).eq('codigo_pai', codigoPai).eq('particao', 0);

  // A família representante do pai: a mais nova COM `ml_item_id` é a que o ingest usaria, e é a que
  // a adoção precisa re-apontar. Resolvida a cada rodada (o lote pode ter mudado entre elas).
  const familiaRepresentante = async () => {
    const { data } = await admin.from('familias')
      .select('id, user_id, ml_item_id, criado_em')
      .eq('org_id', orgId).eq('codigo_pai', codigoPai)
      .order('criado_em', { ascending: false });
    return (data ?? []).find((f) => f.ml_item_id != null) ?? (data ?? [])[0] ?? null;
  };

  const portas: PortasAcompanhamento = {
    carregarEstado: async () => {
      const { data } = await admin.from('anuncios_externos')
        .select('ml_item_id_anterior, migracao_pxv_snapshot, migracao_pxv_status, migracao_pxv_tentativa')
        .eq('org_id', orgId).eq('canal', CANAL).eq('codigo_pai', codigoPai).eq('particao', 0)
        .maybeSingle();
      if (!data?.ml_item_id_anterior) return null;
      return {
        mlItemIdAnterior: data.ml_item_id_anterior as string,
        snapshot: (data.migracao_pxv_snapshot as VariacaoSnapshot[] | null) ?? [],
        status: (data.migracao_pxv_status as string | null) ?? null,
        tentativa: (data.migracao_pxv_tentativa as number | null) ?? 0,
      };
    },

    // Claim atômico da rodada: `eq(tentativa, esperada - 1)` garante que só UMA cadeia avança. Um
    // 500 no worker faria o QStash retentar enquanto a rodada anterior já se re-enfileirou.
    assumirRodada: async (tentativaEsperada) => {
      const { data } = await admin.from('anuncios_externos')
        .update({ migracao_pxv_status: 'em_andamento', migracao_pxv_tentativa: tentativaEsperada })
        .eq('org_id', orgId).eq('canal', CANAL).eq('codigo_pai', codigoPai).eq('particao', 0)
        .eq('migracao_pxv_tentativa', tentativaEsperada - 1)
        .in('migracao_pxv_status', ['solicitada', 'em_andamento'])
        .select('id');
      return (data ?? []).length > 0;
    },

    lerStatus: async (mlItemId) => {
      const s = await lerStatusUPtin(fetch as never, await getToken(), mlItemId);
      return {
        encontrada: s.encontrada,
        migracaoCompleta: s.migracaoCompleta,
        ativacaoCompleta: s.ativacaoCompleta,
        novosItens: s.novosItens.map((n) => ({ itemId: n.itemId, variationId: n.variationId })),
      };
    },

    // Multiget: a COLOR dos anúncios NOVOS, para o degrau (b) do casamento. Só ids que o próprio ML
    // devolveu como filhos desta migração — nunca uma busca por título.
    lerCores: async (itemIds) => {
      const out = new Map<string, string | null>();
      if (itemIds.length === 0) return out;
      const token = await getToken();
      const url = `${API}/items?ids=${itemIds.join(',')}&attributes=id,attributes`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      // Lança em vez de devolver mapa vazio: um 5xx transitório do ML viraria "nenhuma cor lida" →
      // casamento falho → `erro` definitivo, com a migração já concluída do outro lado. O catch do
      // worker trata como transitório e reagenda dentro do orçamento.
      if (!resp.ok) throw new Error(`multiget de cores falhou (${resp.status})`);
      const json = await resp.json() as Array<{ code?: number; body?: { id?: string; attributes?: unknown } }>;
      for (const linha of json ?? []) {
        if (linha?.code !== 200 || !linha.body?.id) continue;
        out.set(String(linha.body.id), corDaVariacaoML(linha.body.attributes));
      }
      return out;
    },

    lerVariacoesLocais: async () => {
      const fam = await familiaRepresentante();
      if (!fam) return [];
      const { data } = await admin.from('variacoes')
        .select('codigo, ml_variation_id').eq('familia_id', fam.id as string);
      return (data ?? []).map((v) => ({
        codigo: v.codigo as string,
        mlVariationId: (v.ml_variation_id as string | null) ?? null,
      }));
    },

    adotar: async (itemPorSku) => {
      const fam = await familiaRepresentante();
      const estado = await portas.carregarEstado();
      if (!fam || !estado) return { ok: false, mensagem: 'Família não encontrada para adoção.' };

      // `familyNameObservado` sai de um GET num dos clones: o item original está encerrado e pode
      // não expor mais `family_name`.
      const primeiroClone = [...itemPorSku.values()][0];
      const resp = await fetch(`${API}/items/${primeiroClone}?attributes=family_name`, {
        headers: { Authorization: `Bearer ${await getToken()}` },
      });
      const familyName = resp.ok
        ? ((await resp.json() as { family_name?: string }).family_name ?? '')
        : '';
      // Nome vazio NÃO adota. A RPC grava `titulo` na raiz, e é dele que o próximo UPDATE UP tira o
      // `family_name` — adotar com `''` deixaria a família com um nome que o ML não reconhece, e o
      // erro só apareceria na próxima publicação. O caminho do ADR-0105 aborta pelo mesmo motivo.
      // Transitório: retentar é o certo.
      if (!familyName) {
        return { ok: false, retryavel: true, mensagem: 'Não foi possível ler o nome da família nos anúncios novos.' };
      }

      const portasAdocao = criarPortasRevinculo({
        admin, getToken, orgId,
        userId: fam.user_id as string,
        familiaId: fam.id as string,
        codigoPai,
        mlItemIdAntigo: estado.mlItemIdAnterior,
        itemPorSku,
      });
      const r = await adotarFamiliaMigrada(portasAdocao, {
        skus: [...itemPorSku.keys()],
        sellerEsperado: conexao.contaExternaId ?? '',
        mlItemIdAtual: estado.mlItemIdAnterior,
        familyNameObservado: familyName,
      });
      if (r.tipo === 'adotada') return { ok: true };
      // "ainda em migração" é transitório: a tag `_pending` do ML e `activation_completed` não caem
      // necessariamente juntos. Retentar é o certo; marcar erro mandaria o operador agir à toa.
      const retryavel = /migrando|ainda est/i.test(r.mensagem);
      return { ok: false, mensagem: r.mensagem, retryavel };
    },

    lerSaldos: async (itemPorSku) => {
      const fam = await familiaRepresentante();
      if (!fam) return [];
      const { data } = await admin.from('variacoes')
        .select('codigo, estoque').eq('familia_id', fam.id as string);
      const localPorSku = new Map((data ?? []).map((v) => [v.codigo as string, (v.estoque as number) ?? 0]));

      const ids = [...itemPorSku.values()];
      const vivoPorItem = new Map<string, number>();
      if (ids.length > 0) {
        const url = `${API}/items?ids=${ids.join(',')}&attributes=id,available_quantity`;
        const resp = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` } });
        if (resp.ok) {
          const json = await resp.json() as Array<{ code?: number; body?: { id?: string; available_quantity?: number } }>;
          for (const l of json ?? []) {
            if (l?.code === 200 && l.body?.id) vivoPorItem.set(String(l.body.id), l.body.available_quantity ?? 0);
          }
        }
      }
      const saldos: Array<{ sku: string; local: number; vivo: number }> = [];
      for (const [sku, itemId] of itemPorSku) {
        const vivo = vivoPorItem.get(itemId);
        // Sem leitura do vivo, trata como suspeito (não empurra): o silêncio aqui não pode virar
        // permissão para restaurar unidades vendidas.
        saldos.push({ sku, local: localPorSku.get(sku) ?? 0, vivo: vivo ?? -1 });
      }
      return saldos;
    },

    empurrarEstoque: async (skus) => {
      // `skus` é ESSENCIAL, não decorativo: sem ele o push cobriria o produto inteiro e arrastaria
      // junto os SKUs que o chamador classificou como suspeitos — restaurando unidades já vendidas
      // e anulando a trava anti-oversell. É o mesmo campo criado pelo incidente de 03/09/2026, em
      // que a entrada de 40 un. de uma cor empurrou o saldo do app para todas as cores do anúncio.
      if (skus.length === 0) return;
      await enfileirarSincronizacaoEstoque(
        { org_id: orgId, codigo_pai: codigoPai, canal_origem: null, skus }, orgId,
      );
    },

    reporEfeitosDaMigracao: async () => {
      const fam = await familiaRepresentante();
      if (!fam) return;
      // Catálogo: o listing do anúncio antigo (MLB próprio, ADR-0021) morreu com ele. Best-effort —
      // falhar aqui não desfaz uma migração que já concluiu.
      try { await enfileirarVinculacaoCatalogo(fam.id as string); }
      catch (e) { console.error(`catálogo pós-migração (${codigoPai}):`, (e as Error).message); }
      // Atacado: `aplicado` só seria verdade se o ML tivesse copiado o PxQ aos clones — não
      // documentado. Zerar faz a próxima publicação reaplicar, em vez de o app afirmar que há preço
      // de atacado no ar sem ninguém ter verificado.
      const { error } = await admin.from('familias')
        .update({ atacado_status: null, atacado_erro: null })
        .eq('org_id', orgId).eq('codigo_pai', codigoPai).eq('atacado_status', 'aplicado');
      if (error) console.error(`reset de atacado pós-migração (${codigoPai}):`, error.message);
    },

    reenfileirar: async (proxima, delayS) => {
      await enfileirarAcompanhamentoMigracaoPxv(
        { org_id: orgId, codigo_pai: codigoPai, tentativa: proxima }, delayS,
      );
    },

    // Estado transitório volta a `null` — mas o snapshot e o `ml_item_id_anterior` FICAM: o
    // faturamento os usa para reconhecer pedidos antigos do anúncio encerrado.
    concluir: async () => {
      await atualizarRaiz({
        migracao_pxv_status: null, migracao_pxv_erro: null, migracao_pxv_tentativa: 0,
      });
    },

    marcarErro: async (motivo) => {
      await atualizarRaiz({ migracao_pxv_status: 'erro', migracao_pxv_erro: motivo });
    },

    notificar: async (texto) => {
      try { await notificarCategoria(admin, orgId, 'integracao', texto); }
      catch (e) { console.error('notificar migração pxv falhou:', (e as Error).message); }
    },
  };

  try {
    const r = await acompanharMigracaoPxv(portas, tentativa);
    return new Response(JSON.stringify(r), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    // Falha inesperada (5xx do ML, refresh de token, rede) é TRANSITÓRIA por padrão. Encerrar o
    // episódio em `erro` aqui seria o pior desfecho: o ML segue migrando e encerra o item original,
    // o app nunca adota, e a única saída vira a descoberta por título — exatamente o caminho que
    // este ADR existe para evitar. Reagenda enquanto houver orçamento.
    const detalhe = (e as Error).message;
    console.error(`acompanhar-migracao-pxv (${codigoPai}): ${detalhe}`);
    if (tentativa < MAX_TENTATIVAS) {
      try {
        await enfileirarAcompanhamentoMigracaoPxv(
          { org_id: orgId, codigo_pai: codigoPai, tentativa: tentativa + 1 }, DELAY_ATIVANDO_S,
        );
        return new Response(JSON.stringify({ tipo: 'aguardando' }), { headers: corsHeaders });
      } catch (e2) {
        // Nem reagendar deu: aí sim o episódio precisa de gente.
        console.error(`reenfileirar falhou (${codigoPai}):`, (e2 as Error).message);
      }
    }
    const motivo = `Falha ao acompanhar a migração: ${detalhe}`;
    await portas.marcarErro(motivo);
    await portas.notificar(motivo);
    // Nunca 500: o claim por tentativa já protege contra duplicata, mas devolver erro faria o
    // QStash reentregar um episódio que acabou de ser encerrado.
    return new Response(JSON.stringify({ tipo: 'erro' }), { headers: corsHeaders });
  }
});
