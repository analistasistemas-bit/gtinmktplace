// Acesso de agentes (ADR-0210, fatia 1): tratamento HTTP da edge `agente-conexoes`, com IO injetado para teste.
// Portões na ordem: identificar → suporte 403 → não-admin 403 → módulo 403 → ação. `orgId`/`userId` vêm SÓ de
// `identificar`; o corpo nunca escolhe organização nem autor. A chave só sai em `criar`; `hash` nunca sai (as
// respostas são projetadas aqui, não confiam no formato que as ações devolvem). Nunca logar `e.message`.
import { corsHeaders, handleOptions } from '../cors.ts';
import {
  type Chamada, type ConexaoLista, LIMITE_CONEXOES_ATIVAS, idValido, projetarConexao, validarNova, validarPermissoes,
} from './conexoes.ts';
import type { Permissao } from './credencial.ts';

export type DepsConexoes = {
  /** Pode lançar `Response` (401/403), como `requireUserOrg`. */
  identificar(req: Request): Promise<{ userId: string; orgId: string; isAdmin: boolean; support: unknown | null }>;
  moduloLigado(orgId: string): Promise<boolean>;
  acoes: {
    contarAtivas(orgId: string): Promise<number>;
    criar(orgId: string, userId: string, e: { nome: string; dias: number | null; permissoes: Permissao[] }): Promise<{ id: string; chave: string; prefixo: string; expira_em: string | null }>;
    listar(orgId: string): Promise<ConexaoLista[]>;
    /** `false` = não existe nesta org. */
    revogar(orgId: string, id: string): Promise<boolean>;
    /** `false` = não existe nesta org ou já revogada. */
    alterarPermissoes(orgId: string, id: string, p: Permissao[]): Promise<boolean>;
    chamadas(orgId: string, id: string): Promise<Chamada[]>;
  };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const NAO_ENCONTRADA = { erro: 'Conexão não encontrada.' };
const PERMISSOES_INVALIDAS = { erro: 'Escolha ao menos uma permissão válida.' };
const ERRO_NOVA = {
  nome_invalido: { erro: 'Nome deve ter de 1 a 60 caracteres.' },
  validade_invalida: { erro: 'Validade inválida.' },
  permissoes_invalidas: PERMISSOES_INVALIDAS,
};

export async function tratarConexoes(req: Request, d: DepsConexoes): Promise<Response> {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    let ctx: Awaited<ReturnType<DepsConexoes['identificar']>>;
    try {
      ctx = await d.identificar(req);
    } catch (r) {
      if (r instanceof Response) return r;
      throw r;
    }
    const { userId, orgId, isAdmin, support } = ctx;
    // Administração da plataforma não cria nem vê conexão em loja de cliente.
    if (support != null) return json({ erro: 'Indisponível em sessão de suporte.' }, 403);
    if (!isAdmin) return json({ erro: 'Somente administradores gerenciam conexões de agentes.' }, 403);
    if (!(await d.moduloLigado(orgId))) return json({ erro: 'Módulo de agentes desligado.' }, 403);

    let body: Record<string, unknown> = {};
    try { body = (await req.json()) ?? {}; } catch { /* corpo inválido cai em ação inválida */ }
    const { acoes } = d;

    switch (body.acao) {
      case 'listar':
        return json((await acoes.listar(orgId)).map(projetarConexao));
      case 'criar': {
        const v = validarNova(body);
        if ('erro' in v) return json(ERRO_NOVA[v.erro], 400);
        if ((await acoes.contarAtivas(orgId)) >= LIMITE_CONEXOES_ATIVAS) {
          return json({ erro: `Limite de ${LIMITE_CONEXOES_ATIVAS} conexões ativas. Revogue uma antes de criar outra.` }, 409);
        }
        const c = await acoes.criar(orgId, userId, v);
        return json({ id: c.id, chave: c.chave, prefixo: c.prefixo, expira_em: c.expira_em });
      }
      case 'revogar':
        if (!idValido(body.id) || !(await acoes.revogar(orgId, body.id))) return json(NAO_ENCONTRADA, 404);
        return json({ ok: true });
      case 'permissoes': {
        if (!idValido(body.id)) return json(NAO_ENCONTRADA, 404);
        const p = validarPermissoes(body.permissoes);
        if (!p) return json(PERMISSOES_INVALIDAS, 400);
        if (!(await acoes.alterarPermissoes(orgId, body.id, p))) return json(NAO_ENCONTRADA, 404);
        return json({ ok: true });
      }
      case 'chamadas':
        if (!idValido(body.id)) return json(NAO_ENCONTRADA, 404);
        return json((await acoes.chamadas(orgId, body.id)).map((c) => ({
          criado_em: c.criado_em, ferramenta: c.ferramenta, alvo: c.alvo, resultado: c.resultado,
        })));
      default:
        return json({ erro: 'Ação inválida.' }, 400);
    }
  } catch {
    console.error('[agente-conexoes] falha interna');
    return json({ erro: 'Não foi possível concluir. Tente de novo.' }, 500);
  }
}
