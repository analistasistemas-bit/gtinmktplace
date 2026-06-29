import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUser } from '../_shared/auth.ts';

const MENU_KEYS = ['dashboard', 'lotes', 'revisao', 'publicados', 'faturamento', 'financeiro', 'viabilidade', 'configuracoes'];

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

  // Só admin opera aqui.
  const { data: me } = await db.from('profiles').select('is_admin').eq('id', caller.id).single();
  if (!me?.is_admin) return json({ error: 'forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  const action = body.action as string;
  const sanitizeMenus = (m: unknown) => (Array.isArray(m) ? m.filter((x) => MENU_KEYS.includes(x)) : []);

  switch (action) {
    case 'invite': {
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!email) return json({ error: 'email obrigatório' }, 400);
      const appUrl = Deno.env.get('APP_URL') ?? '';
      const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
        data: { nome: String(body.nome ?? ''), allowed_menus: sanitizeMenus(body.allowed_menus) },
        redirectTo: `${appUrl}/#/definir-senha`,
      });
      if (error) {
        const duplicado = /already.*registered/i.test(error.message);
        return json(
          { error: duplicado ? 'Esse e-mail já tem cadastro. Para reenviar, remova o usuário e convide de novo.' : error.message },
          duplicado ? 409 : 400,
        );
      }
      // Convidado como admin: o trigger já criou o profile; promovemos.
      if (body.is_admin === true && data.user?.id) {
        await db.from('profiles').update({ is_admin: true, updated_at: new Date().toISOString() }).eq('id', data.user.id);
      }
      return json({ ok: true, id: data.user?.id });
    }
    case 'update_menus': {
      const { error } = await db.from('profiles')
        .update({ allowed_menus: sanitizeMenus(body.allowed_menus), nome: body.nome ?? undefined, updated_at: new Date().toISOString() })
        .eq('id', body.id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    case 'set_active': {
      if (body.id === caller.id && !body.is_active) return json({ error: 'não pode se desativar' }, 400);
      const { error } = await db.from('profiles')
        .update({ is_active: !!body.is_active, updated_at: new Date().toISOString() })
        .eq('id', body.id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    case 'set_admin': {
      if (body.id === caller.id && !body.is_admin) return json({ error: 'não pode se rebaixar' }, 400);
      const { error } = await db.from('profiles')
        .update({ is_admin: !!body.is_admin, updated_at: new Date().toISOString() })
        .eq('id', body.id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    default:
      return json({ error: 'ação inválida' }, 400);
  }
});
