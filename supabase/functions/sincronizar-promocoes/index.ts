// ADR-0170 — sync da Central de Promoções. Modos:
//  - QStash {} (schedule 6/6 h): fan-out, 1 mensagem { etapa: 'lista', org_id } por org com o módulo.
//  - QStash { etapa: 'lista', org_id }: etapa de lista da org (trava se já está sincronizando).
//  - QStash { etapa: 'promocao', ... }: leitura de uma promoção (lotes + continuação).
//  - Usuário logado ("Atualizar agora"): etapa de lista da própria org, com throttle de 2 min.
// No ML só GET de promoção/item/tarifa/frete; o único POST é o refresh OAuth de token.ts.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { qstashClient, verificarAssinatura } from '../_shared/queue.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { sincronizarLista, sincronizarPromocao, type MsgLeitura } from '../_shared/promocoes/sincronizar.ts';
import { depsLeitura, depsLista } from '../_shared/promocoes/deps.ts';

const LEITURA = { limiteMs: 90_000, lote: 20, concorrencia: 6 };
const THROTTLE_MS = 2 * 60_000;
const TRAVA_LISTA_MS = 5 * 60_000;

type Admin = ReturnType<typeof adminClient>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

async function conexaoDaOrg(admin: Admin, orgId: string) {
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao?.contaExternaId) return null;
  return { orgId, mlUserId: conexao.contaExternaId, token: await getValidAccessTokenConexao(conexao) };
}

async function gravarSync(admin: Admin, linha: Record<string, unknown>) {
  const { error } = await admin.from('ml_promocoes_sync').upsert(linha, { onConflict: 'org_id' });
  if (error) throw new Error(`ml_promocoes_sync: ${error.message}`);
}

async function etapaLista(admin: Admin, orgId: string) {
  const { data: atual } = await admin.from('ml_promocoes_sync').select('estado, iniciado_em').eq('org_id', orgId).maybeSingle();
  const desde = atual?.iniciado_em ? Date.now() - Date.parse(atual.iniciado_em) : Infinity;
  if (atual?.estado === 'sincronizando' && desde < TRAVA_LISTA_MS) return { estado: 'sincronizando' as const, enfileiradas: [] };
  const rodada = new Date().toISOString();
  await gravarSync(admin, { org_id: orgId, estado: 'sincronizando', iniciado_em: rodada });
  let cx: Awaited<ReturnType<typeof conexaoDaOrg>>;
  try {
    cx = await conexaoDaOrg(admin, orgId);
  } catch (e) {
    // Refresh do token/rede falhou: é falha transitória, não "sem conexão" (não mandar reconectar em Canais).
    const erro = e instanceof Error ? e.message : String(e);
    console.error('[sincronizar-promocoes] conexão ML', { orgId, erro });
    await gravarSync(admin, { org_id: orgId, estado: 'erro', erro, ultimo_erro_em: new Date().toISOString() });
    return { estado: 'erro' as const, enfileiradas: [] };
  }
  if (!cx) {
    await gravarSync(admin, { org_id: orgId, estado: 'sem_acesso', erro: 'Organização sem conexão com o Mercado Livre.', ultimo_erro_em: new Date().toISOString() });
    return { estado: 'sem_acesso' as const, enfileiradas: [] };
  }
  return sincronizarLista(depsLista(admin, cx), { orgId, rodada });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  const admin = adminClient();

  try {
    if (req.headers.get('upstash-signature')) {
      if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
      let payload: Partial<MsgLeitura> & { etapa?: string; org_id?: string } = {};
      try { payload = body ? JSON.parse(body) : {}; } catch { /* body vazio */ }

      if (!payload.org_id) {
        const { data: orgs, error } = await admin.from('organizations').select('id').contains('modulos_habilitados', ['promocoes']);
        if (error) throw new Error(`orgs com módulo: ${error.message}`);
        const alvo = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sincronizar-promocoes`;
        for (const o of orgs ?? []) await qstashClient().publishJSON({ url: alvo, body: { etapa: 'lista', org_id: o.id }, retries: 1 });
        return json({ ok: true, orgs: (orgs ?? []).length });
      }
      if (!(await exigirModulo(admin, payload.org_id, 'promocoes'))) return json({ ok: false, erro: 'Módulo desabilitado.' }, 403);
      if (payload.etapa === 'promocao') {
        const cx = await conexaoDaOrg(admin, payload.org_id);
        if (!cx) return json({ ok: false, erro: 'sem conexão' });
        const r = await sincronizarPromocao(depsLeitura(admin, cx, payload as MsgLeitura), payload as MsgLeitura, LEITURA);
        return json({ ok: true, ...r });
      }
      // ADR-0171: falha de conexão na etapa 'lista' devolve 500 só aqui (ramo QStash) — o
      // fan-out publica com `retries: 1`, então o QStash tenta de novo ~12s depois (cobre um
      // tropeço de rede; o 429 do refresh em si é resolvido pelo worker renovar-tokens-ml). O
      // caminho "Atualizar agora" (abaixo) não muda: usuário já vê o estado 'erro' na tela.
      const resultadoLista = await etapaLista(admin, payload.org_id);
      return json({ ok: true, ...resultadoLista }, resultadoLista.estado === 'erro' ? 500 : 200);
    }

    let orgId: string;
    try {
      ({ orgId } = await requireUserOrg(req, { access: 'write' }));
    } catch (resp) {
      if (resp instanceof Response) return resp;
      throw resp;
    }
    if (!(await exigirModulo(admin, orgId, 'promocoes'))) {
      return json({ ok: false, erro: 'A Central de Promoções não está habilitada para esta organização.' }, 403);
    }
    const { data: estado } = await admin.from('ml_promocoes_sync').select('iniciado_em').eq('org_id', orgId).maybeSingle();
    const ultimo = estado?.iniciado_em ? Date.parse(estado.iniciado_em) : NaN;
    if (Number.isFinite(ultimo) && Date.now() - ultimo < THROTTLE_MS) {
      return json({ ok: false, erro: 'Atualização feita há menos de 2 minutos. Tente de novo em instantes.' }, 429);
    }
    return json({ ok: true, ...(await etapaLista(admin, orgId)) });
  } catch (e) {
    console.error('[sincronizar-promocoes]', e);
    return json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
