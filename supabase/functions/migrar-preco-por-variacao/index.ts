// ADR-0161 — "Migrar para preço por variação": dispara o UPtin no Mercado Livre.
//
// Ação IRREVERSÍVEL: o ML encerra o anúncio original e cria um anúncio por cor. Admin-only, com
// confirmação explícita na UI. Toda a decisão de recusar mora em `processar.ts` (testável sem HTTP);
// aqui ficam auth, portas e transporte.

import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { buscarItemML } from '../_shared/ml/atualizar-item.ts';
import { validarElegibilidadeUPtin, dispararUPtin, type VariacaoSnapshot } from '../_shared/ml/migracao-pxv.ts';
import { enfileirarAcompanhamentoMigracaoPxv } from '../_shared/queue.ts';
import { dispararMigracaoPxv, type PortasDisparo } from './processar.ts';

const CANAL = 'mercado_livre';
/** Primeira consulta de acompanhamento. A migração é assíncrona e sem SLA publicado. */
const PRIMEIRO_DELAY_S = 120;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
  try {
    const r = context = await requireUserOrg(req, { access: 'write' });
    // Admin-only, como pausar/reativar (ADR-0060) — e com razão mais forte: aquilo é reversível,
    // isto não é.
    if (!r.isAdmin && r.support?.scope !== 'full') {
      await auditarOperacaoSuporte(adminClient(), context, { type: 'org', id: r.orgId }, 'denied');
      throw new Response('Somente administradores podem migrar um anúncio', { status: 403 });
    }
    orgId = r.orgId;
  } catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { familia_id } = await req.json().catch(() => ({}));
  if (!familia_id) {
    return new Response('familia_id obrigatório', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();
  const conexao = await resolverConexao(admin, orgId, CANAL);
  if (!conexao) {
    return new Response(JSON.stringify({ erro: 'Conecte sua conta ML nas Configurações.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const getToken = () => getValidAccessTokenConexao(conexao);

  const portas: PortasDisparo = {
    carregarContexto: async (familiaId) => {
      // Escopo por org na PRÓPRIA consulta: o molde desta função (atualizar-status-publicado)
      // aceita um ml_item_id qualquer e escreve nele. Aqui, id de outra organização simplesmente
      // não é encontrado.
      const { data: fam } = await admin.from('familias')
        .select('id, org_id, codigo_pai, ml_item_id, status')
        .eq('id', familiaId).eq('org_id', orgId).maybeSingle();
      if (!fam) {
        return { familia: null, particoes: [], mlItemIdMaisNovo: null, algumaPublicando: false, emKitVirtual: false };
      }
      const codigoPai = fam.codigo_pai as string;

      const { data: parts } = await admin.from('anuncios_externos')
        .select('particao, item_externo_id, migracao_pxv_status')
        .eq('org_id', orgId).eq('canal', CANAL).eq('codigo_pai', codigoPai);

      // Todas as linhas de `familias` do pai: a mais nova é a que o ingest usaria, e o status de
      // qualquer uma em publicação impede migrar no meio de um envio.
      const { data: irmas } = await admin.from('familias')
        .select('ml_item_id, status, criado_em')
        .eq('org_id', orgId).eq('codigo_pai', codigoPai)
        .order('criado_em', { ascending: false });
      const maisNovaComItem = (irmas ?? []).find((f) => f.ml_item_id != null);

      const { data: kit } = await admin.from('kits_virtuais_componentes')
        .select('id').eq('item_externo_id', fam.ml_item_id as string).limit(1);

      return {
        familia: {
          id: fam.id as string, orgId: fam.org_id as string, codigoPai,
          mlItemId: (fam.ml_item_id as string | null) ?? null,
          status: (fam.status as string | null) ?? null,
        },
        particoes: (parts ?? []).map((p) => ({
          particao: p.particao as number,
          itemExternoId: (p.item_externo_id as string | null) ?? null,
          migracaoStatus: (p.migracao_pxv_status as string | null) ?? null,
        })),
        mlItemIdMaisNovo: (maisNovaComItem?.ml_item_id as string | null) ?? null,
        algumaPublicando: (irmas ?? []).some((f) => f.status === 'publicando'),
        emKitVirtual: (kit ?? []).length > 0,
      };
    },

    validarElegibilidade: async (mlItemId) => {
      const r = await validarElegibilidadeUPtin(fetch as never, await getToken(), mlItemId);
      return { elegivel: r.elegivel, causas: r.causas };
    },

    lerVariacoes: async (mlItemId) => {
      const item = await buscarItemML(await getToken(), mlItemId);
      return item.variations.map((v): VariacaoSnapshot => ({
        id: String(v.id),
        // `?? null`: o ML não exige `seller_custom_field`, e `undefined` no snapshot viraria uma
        // chave que o casamento não sabe distinguir de "ausente".
        sku: v.seller_custom_field ?? null,
        // `buscarItemML` já resolve COLOR — mesma leitura do resto do app.
        cor: v.cor ?? null,
      }));
    },

    // Claim atômico: `is null` no WHERE é o que impede clique duplo e dois admins simultâneos.
    // Check-then-set não serve — ambos leriam `null` e ambos disparariam uma migração irreversível.
    reservar: async ({ codigoPai, snapshot, mlItemIdAnterior }) => {
      const { data } = await admin.from('anuncios_externos')
        .update({
          migracao_pxv_status: 'solicitada',
          migracao_pxv_solicitada_em: new Date().toISOString(),
          migracao_pxv_snapshot: snapshot,
          migracao_pxv_erro: null,
          migracao_pxv_tentativa: 0,
          ml_item_id_anterior: mlItemIdAnterior,
        })
        .eq('org_id', orgId).eq('canal', CANAL).eq('codigo_pai', codigoPai).eq('particao', 0)
        .is('migracao_pxv_status', null)
        .select('id');
      return (data ?? []).length > 0;
    },

    dispararNoML: async (mlItemId) => {
      await dispararUPtin(fetch as never, await getToken(), mlItemId);
    },

    registrarFalha: async (codigoPai, motivo) => {
      await admin.from('anuncios_externos')
        .update({ migracao_pxv_erro: motivo })
        .eq('org_id', orgId).eq('canal', CANAL).eq('codigo_pai', codigoPai).eq('particao', 0);
    },

    enfileirarAcompanhamento: async (codigoPai) => {
      await enfileirarAcompanhamentoMigracaoPxv(
        { org_id: orgId, codigo_pai: codigoPai, tentativa: 1 }, PRIMEIRO_DELAY_S,
      );
    },
  };

  const resultado = await dispararMigracaoPxv(portas, familia_id as string);

  if (resultado.tipo === 'recusado') {
    await auditarOperacaoSuporte(admin, context, { type: 'item', id: familia_id }, 'denied');
    return new Response(JSON.stringify({ erro: resultado.motivo }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  if (resultado.tipo === 'falha_ml') {
    await auditarOperacaoSuporte(admin, context, { type: 'item', id: familia_id }, 'failed');
    // 502 com aviso honesto: pode ter começado. O worker vai apurar.
    return new Response(JSON.stringify({
      erro: `Falha ao pedir a migração ao Mercado Livre: ${resultado.motivo}. `
        + 'O app vai verificar se ela começou mesmo assim — acompanhe pelo sino. Não clique de novo.',
    }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  await auditarOperacaoSuporte(admin, context, { type: 'item', id: familia_id }, 'succeeded');
  return new Response(JSON.stringify({ ok: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
