import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUser } from '../_shared/auth.ts';
import { sanitizarDestinatario } from '../_shared/notificacoes/destinatario.ts';
import { pendenciasAtivacaoFiscal } from '../_shared/fiscal/ativacao.ts';

// Espelho de src/lib/menus.ts. Divergir daqui faz `allowed_menus` sanitizar e descartar
// silenciosamente a permissão do menu novo.
const MENU_KEYS = ['dashboard', 'lotes', 'revisao', 'publicados', 'estoque', 'pulse', 'faturamento', 'financeiro', 'viabilidade', 'canais', 'configuracoes'];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let caller;
  try { caller = await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const db = adminClient();
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  // E7: identidade org do chamador. Só admin ativo com org opera aqui.
  const { data: me } = await db.from('profiles')
    .select('is_admin, is_super_admin, is_active, org_id').eq('id', caller.id).single();
  if (!me || !me.is_active) return json({ error: 'forbidden' }, 403);
  const platformAction = ['list_orgs', 'create_org', 'set_canais_org', 'set_modulos_org', 'set_tipo_pessoa_org', 'delete_org'].includes(action);
  if (!(me.is_super_admin && !me.org_id && platformAction)) {
    if (!me.org_id || !me.is_admin) return json({ error: 'forbidden' }, 403);
  }
  const orgId = me.org_id as string;
  const sanitizeMenus = (m: unknown) => (Array.isArray(m) ? m.filter((x) => MENU_KEYS.includes(x)) : []);
  const appUrl = Deno.env.get('APP_URL') ?? '';

  switch (action) {
    case 'invite': {
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!email) return json({ error: 'email obrigatório' }, 400);
      // E7: novo usuário herda a org do admin que convida (handle_new_user consome org_id).
      const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
        data: { nome: String(body.nome ?? ''), allowed_menus: sanitizeMenus(body.allowed_menus), org_id: orgId },
        redirectTo: `${appUrl}/#/definir-senha`,
      });
      if (error) {
        const duplicado = /already.*registered/i.test(error.message);
        return json(
          { error: duplicado ? 'Esse e-mail já tem cadastro. Para reenviar, remova o usuário e convide de novo.' : error.message },
          duplicado ? 409 : 400,
        );
      }
      // Convidado como admin: o trigger já criou o profile (com org_id); promovemos.
      if (body.is_admin === true && data.user?.id) {
        await db.from('profiles').update({ is_admin: true, updated_at: new Date().toISOString() }).eq('id', data.user.id);
      }
      return json({ ok: true, id: data.user?.id });
    }
    case 'update_menus': {
      // E7: só atua em perfis da MESMA org do chamador.
      const { error } = await db.from('profiles')
        .update({ allowed_menus: sanitizeMenus(body.allowed_menus), nome: body.nome ?? undefined, updated_at: new Date().toISOString() })
        .eq('id', body.id).eq('org_id', orgId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    case 'update_notificacoes': {
      // Destinatário Telegram: chat_id (numérico, opcional) + categorias assinadas. Só na MESMA org.
      const san = sanitizarDestinatario(body);
      if (!san.ok) return json({ error: san.erro }, 400);
      const { error } = await db.from('profiles')
        .update({ telegram_chat_id: san.chatId, telegram_categorias: san.categorias, updated_at: new Date().toISOString() })
        .eq('id', body.id).eq('org_id', orgId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    case 'set_active': {
      if (body.id === caller.id && !body.is_active) return json({ error: 'não pode se desativar' }, 400);
      const { data: alvo } = await db.from('profiles').select('is_super_admin')
        .eq('id', body.id).eq('org_id', orgId).maybeSingle();
      if (alvo?.is_super_admin && !me.is_super_admin) {
        return json({ error: 'apenas super-admin altera super-admin' }, 403);
      }
      const { error } = await db.from('profiles')
        .update({ is_active: !!body.is_active, updated_at: new Date().toISOString() })
        .eq('id', body.id).eq('org_id', orgId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    case 'set_admin': {
      if (body.id === caller.id && !body.is_admin) return json({ error: 'não pode se rebaixar' }, 400);
      const { data: alvo } = await db.from('profiles').select('is_super_admin')
        .eq('id', body.id).eq('org_id', orgId).maybeSingle();
      if (alvo?.is_super_admin && !me.is_super_admin) {
        return json({ error: 'apenas super-admin altera super-admin' }, 403);
      }
      const { error } = await db.from('profiles')
        .update({ is_admin: !!body.is_admin, updated_at: new Date().toISOString() })
        .eq('id', body.id).eq('org_id', orgId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    // ---- Ações de super-admin (D-E7.8): gestão de organizações ---------------
    case 'list_orgs': {
      if (!me.is_super_admin) return json({ error: 'forbidden' }, 403);
      const [{ data: orgs }, { data: profiles }] = await Promise.all([
        db.from('organizations').select('id, nome, slug, criado_em, canais_habilitados, modulos_habilitados, is_test, tipo_pessoa').order('criado_em'),
        db.from('profiles').select('org_id'),
      ]);
      const counts = new Map<string, number>();
      for (const member of profiles ?? []) counts.set(member.org_id, (counts.get(member.org_id) ?? 0) + 1);
      const result = (orgs ?? []).map((o) => ({
          id: o.id, nome: o.nome, slug: o.slug, criado_em: o.criado_em,
          canais_habilitados: o.canais_habilitados, modulos_habilitados: o.modulos_habilitados ?? [],
          is_test: o.is_test, membros: counts.get(o.id) ?? 0, tipo_pessoa: o.tipo_pessoa,
      }));
      return json({ orgs: result });
    }
    case 'create_org': {
      if (!me.is_super_admin) return json({ error: 'forbidden' }, 403);
      const nome = String(body.nome ?? '').trim();
      const slug = String(body.slug ?? '').trim().toLowerCase();
      const marcaPadrao = body.marca_padrao ? String(body.marca_padrao) : null;
      const adminEmail = String(body.admin_email ?? '').trim().toLowerCase();
      const adminNome = String(body.admin_nome ?? '');
      if (!nome || !slug || !adminEmail) return json({ error: 'nome, slug e admin_email obrigatórios' }, 400);

      const { data: org, error: orgErr } = await db.from('organizations')
        .insert({ nome, slug, marca_padrao: marcaPadrao }).select('id').single();
      if (orgErr) {
        const dup = /duplicate|unique/i.test(orgErr.message);
        return json({ error: dup ? 'Já existe uma empresa com esse slug.' : orgErr.message }, dup ? 409 : 400);
      }

      // Convida o primeiro admin da org nova; o trigger cria o profile com a org.
      const { data: inv, error: invErr } = await db.auth.admin.inviteUserByEmail(adminEmail, {
        data: { nome: adminNome, allowed_menus: MENU_KEYS, org_id: org.id },
        redirectTo: `${appUrl}/#/definir-senha`,
      });
      if (invErr) {
        await db.from('organizations').delete().eq('id', org.id); // rollback: org sem admin não serve
        const dup = /already.*registered/i.test(invErr.message);
        return json({ error: dup ? 'Esse e-mail já tem cadastro em outra empresa.' : invErr.message }, dup ? 409 : 400);
      }
      if (inv.user?.id) {
        await db.from('profiles').update({ is_admin: true, org_id: org.id, updated_at: new Date().toISOString() }).eq('id', inv.user.id);
      }
      return json({ ok: true, org_id: org.id });
    }
    case 'set_canais_org': {
      if (!me.is_super_admin) return json({ error: 'forbidden' }, 403);
      const alvo = String(body.org_id ?? '');
      if (!alvo) return json({ error: 'org_id obrigatório' }, 400);
      // Mesmos ids do registry do frontend (src/lib/canais.ts) — manter em sincronia.
      const CANAIS_VALIDOS = ['mercado_livre', 'shopee', 'magalu', 'amazon', 'casas_bahia'];
      const canais = Array.isArray(body.canais)
        ? (body.canais as string[]).filter((c) => CANAIS_VALIDOS.includes(c))
        : [];
      const canaisUnicos = [...new Set(canais)];
      if (!canaisUnicos.includes('mercado_livre')) {
        return json({ error: 'mercado_livre não pode ser desabilitado' }, 400);
      }
      const { error } = await db.from('organizations')
        .update({ canais_habilitados: canaisUnicos, atualizado_em: new Date().toISOString() })
        .eq('id', alvo);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    case 'set_modulos_org': {
      if (!me.is_super_admin) return json({ error: 'forbidden' }, 403);
      const alvo = String(body.org_id ?? '');
      if (!alvo) return json({ error: 'org_id obrigatório' }, 400);
      // Mesmos ids do registry do frontend (src/lib/modulos.ts) — manter em sincronia.
      const MODULOS_VALIDOS = ['estoque', 'pulse', 'fiscal'];
      const modulos = Array.isArray(body.modulos)
        ? (body.modulos as string[]).filter((m) => MODULOS_VALIDOS.includes(m))
        : [];
      // ADR-0135 D-2/D-7.3: ligar o módulo fiscal exige o checklist completo — as
      // pendências saem TODAS de uma vez. A constraint fiscal_exige_pj é a rede no banco;
      // esta é a mensagem legível.
      if (modulos.includes('fiscal')) {
        const [{ data: org }, { data: empresa }, { data: cfg }] = await Promise.all([
          db.from('organizations').select('tipo_pessoa').eq('id', alvo).maybeSingle(),
          db.from('empresa_fiscal').select('*').eq('org_id', alvo).maybeSingle(),
          db.from('configuracoes').select('uf_empresa').eq('org_id', alvo).maybeSingle(),
        ]);
        const pendencias = pendenciasAtivacaoFiscal(
          { tipoPessoa: (org?.tipo_pessoa ?? 'pf') as 'pf' | 'pj' },
          empresa ?? null,
          cfg?.uf_empresa ?? null,
        );
        if (pendencias.length) {
          return json({ error: `Módulo fiscal não pode ser ligado:\n- ${pendencias.join('\n- ')}` }, 400);
        }
      }
      // Diferente de set_canais_org: NÃO há módulo obrigatório. Lista vazia é estado
      // válido (org sem nenhum módulo) e é o default de toda org.
      const { error } = await db.from('organizations')
        .update({ modulos_habilitados: [...new Set(modulos)], atualizado_em: new Date().toISOString() })
        .eq('id', alvo);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    case 'set_tipo_pessoa_org': {
      if (!me.is_super_admin) return json({ error: 'forbidden' }, 403);
      const alvo = String(body.org_id ?? '');
      const tipo = String(body.tipo_pessoa ?? '');
      if (!alvo || !['pf', 'pj'].includes(tipo)) {
        return json({ error: 'org_id e tipo_pessoa (pf|pj) obrigatórios' }, 400);
      }
      if (tipo === 'pf') {
        // A constraint recusaria de qualquer forma; aqui a mensagem explica a ordem certa.
        const { data: o } = await db.from('organizations')
          .select('modulos_habilitados').eq('id', alvo).maybeSingle();
        if (((o?.modulos_habilitados ?? []) as string[]).includes('fiscal')) {
          return json({ error: 'Desligue o módulo fiscal antes de voltar a organização para pessoa física.' }, 400);
        }
      }
      const { error } = await db.from('organizations')
        .update({ tipo_pessoa: tipo, atualizado_em: new Date().toISOString() }).eq('id', alvo);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    case 'delete_org': {
      if (!me.is_super_admin) return json({ error: 'forbidden' }, 403);
      const alvo = String(body.org_id ?? '');
      if (!alvo) return json({ error: 'org_id obrigatório' }, 400);
      // Trava principal: nunca a própria org (protege a operação do super-admin, ex.: Avil).
      if (alvo === me.org_id) return json({ error: 'Não é possível excluir a sua própria empresa.' }, 400);

      const { data: alvoOrg } = await db.from('organizations').select('id').eq('id', alvo).single();
      if (!alvoOrg) return json({ error: 'Empresa não encontrada.' }, 404);

      const { data: membros } = await db.from('profiles').select('id').eq('org_id', alvo);

      // Dados por org: org_id → organizations é NO ACTION, então deleta explícito.
      // 'lotes' cascateia familias→variacoes; 'ml_vendas' cascateia ml_vendas_itens.
      // Vault: o secret da conexão não é removido aqui (órfão inofensivo). Os anúncios
      // no marketplace NÃO são despublicados — isto apaga só os registros locais da org.
      const tabelas = ['lotes', 'ml_vendas', 'anuncios_externos', 'ml_perguntas', 'ml_devolucoes',
        'ml_moderacao', 'ml_webhook_eventos', 'ml_credentials', 'configuracoes', 'marketplace_connections'];
      for (const t of tabelas) {
        const { error } = await db.from(t).delete().eq('org_id', alvo);
        // tolera tabela já removida (ex.: ml_credentials após cleanup do E7)
        if (error && !/does not exist|could not find the table|42P01/i.test(error.message)) {
          return json({ error: `Falha ao limpar ${t}: ${error.message}` }, 500);
        }
      }
      await db.from('profiles').delete().eq('org_id', alvo);
      for (const m of membros ?? []) await db.auth.admin.deleteUser(m.id as string);
      const { error: eOrg } = await db.from('organizations').delete().eq('id', alvo);
      if (eOrg) return json({ error: eOrg.message }, 500);
      return json({ ok: true });
    }
    default:
      return json({ error: 'ação inválida' }, 400);
  }
});
