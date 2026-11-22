// Acesso de agentes (ADR-0210, fatia 1): o administrador cria, lista e revoga conexões de agente pela tela de
// Configurações. Único lugar em que a chave nasce: volta UMA vez na resposta de `criar`; no banco, só o hash.
// Regra e banco em `_shared/agentes/conexoes.ts`; aqui só a fiação. Nunca logar chave, hash nem `e.message`.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { gerarChave } from '../_shared/agentes/credencial.ts';
import {
  LIMITE_CONEXOES_ATIVAS, contarAtivas, expiraEm, idValido, inserirConexao, listarChamadas, listarConexoes, revogarConexao,
  validarNova,
} from '../_shared/agentes/conexoes.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const NAO_ENCONTRADA = { erro: 'Conexão não encontrada.' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    let ctx: Awaited<ReturnType<typeof requireUserOrg>>;
    try {
      ctx = await requireUserOrg(req, { access: 'write' });
    } catch (r) {
      if (r instanceof Response) return r;
      throw r;
    }
    const { userId, orgId, isAdmin, support } = ctx;
    // Administração da plataforma não cria nem vê conexão em loja de cliente.
    if (support != null) return json({ erro: 'Indisponível em sessão de suporte.' }, 403);
    if (!isAdmin) return json({ erro: 'Somente administradores gerenciam conexões de agentes.' }, 403);
    const admin = adminClient();
    if (!(await exigirModulo(admin, orgId, 'agentes'))) return json({ erro: 'Módulo de agentes desligado.' }, 403);

    let body: Record<string, unknown> = {};
    try { body = (await req.json()) ?? {}; } catch { /* corpo vazio */ }

    switch (body.acao) {
      case 'listar':
        return json(await listarConexoes(admin, orgId));
      case 'criar': {
        const v = validarNova(body);
        if ('erro' in v) {
          return json({ erro: v.erro === 'nome_invalido' ? 'Nome deve ter de 1 a 60 caracteres.' : 'Validade inválida.' }, 400);
        }
        const agora = new Date();
        if ((await contarAtivas(admin, orgId, agora)) >= LIMITE_CONEXOES_ATIVAS) {
          return json({ erro: `Limite de ${LIMITE_CONEXOES_ATIVAS} conexões ativas. Revogue uma antes de criar outra.` }, 409);
        }
        const { chave, prefixo, hash } = await gerarChave();
        const expira_em = expiraEm(agora, v.dias);
        const { id } = await inserirConexao(admin, orgId, { nome: v.nome, prefixo, hash, criada_por: userId, expira_em });
        return json({ id, chave, prefixo, expira_em });
      }
      case 'revogar':
        if (!idValido(body.id) || !(await revogarConexao(admin, orgId, body.id, new Date()))) return json(NAO_ENCONTRADA, 404);
        return json({ ok: true });
      case 'chamadas':
        if (!idValido(body.id)) return json(NAO_ENCONTRADA, 404);
        return json(await listarChamadas(admin, orgId, body.id));
      default:
        return json({ erro: 'Ação inválida.' }, 400);
    }
  } catch {
    console.error('[agente-conexoes] falha interna');
    return json({ erro: 'Não foi possível concluir. Tente de novo.' }, 500);
  }
});
