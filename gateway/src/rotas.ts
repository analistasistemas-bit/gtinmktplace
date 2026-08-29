// Roteamento e envelope de resposta do Gateway (ADR-0132 D-8).
//
// A API é versionada sob /v1 e expõe operação de domínio — nunca `tool` + `args`. Não existe
// proxy MCP genérico (D-9): cada rota nova é uma decisão, não um parâmetro.
//
// Sem framework de propósito: são poucas rotas e o `node:http` resolve. Trocar por um roteador
// quando aparecer rota com path param que justifique.

import type { IncomingMessage } from 'node:http'
import { autorizar, statusDe, type DepsAutorizacao, type MotivoRecusa } from './autorizacao.js'
import {
  carregarCredencial, consumirEstado, salvarCredencial,
  type RepositorioCredenciais,
} from './credenciais.js'
import { iniciar, trocarCodePorToken, type BuscarHttp, type ClienteOAuth } from './oauth.js'

export const VERSAO_CONTRATO = 'v1'

export interface Resposta {
  status: number
  corpo?: unknown
  /** Redirect: usado só no callback do OAuth, que termina no browser e não em JSON. */
  redirecionarPara?: string
}

export function erro(codigo: string, mensagem: string, status: number): Resposta {
  return { status, corpo: { erro: { codigo, mensagem } } }
}

const MENSAGEM: Record<MotivoRecusa, string> = {
  sem_token: 'Requisição sem token de autenticação.',
  token_invalido: 'Token inválido ou expirado.',
  perfil_ausente: 'Perfil não encontrado.',
  perfil_inativo: 'Perfil inativo.',
  sem_org: 'Perfil sem organização.',
  // D-13: distinto dos demais — a UI diz que a funcionalidade existe mas não está habilitada,
  // não que a pessoa perdeu acesso.
  modulo_desligado: 'Módulo Análise PubliAI não habilitado para esta organização.',
}

export interface DepsRotas extends DepsAutorizacao {
  versao: string
  repo: RepositorioCredenciais
  cliente: ClienteOAuth
  chaveCredencial: Buffer
  buscar: BuscarHttp
  /** Para onde devolver o browser depois do callback. */
  urlAppCanais: string
  agora?: () => Date
}

export interface Pedido {
  metodo: string | undefined
  caminho: string
  query: URLSearchParams
  headerAutorizacao: string | null | undefined
}

async function exigirAdmin(p: Pedido, deps: DepsRotas) {
  const auth = await autorizar(p.headerAutorizacao, deps)
  if (!auth.ok) return { erro: erro(auth.motivo, MENSAGEM[auth.motivo], statusDe(auth.motivo)) }
  // D-5: conectar e desconectar são de admin da organização; usar é de qualquer membro.
  if (!auth.chamador.isAdmin) {
    return { erro: erro('somente_admin', 'Somente o administrador da organização pode conectar ou desconectar.', 403) }
  }
  return { chamador: auth.chamador }
}

export async function tratar(p: Pedido, deps: DepsRotas): Promise<Resposta> {
  const agora = deps.agora ?? (() => new Date())

  if (p.metodo === 'GET' && p.caminho === '/health') {
    return { status: 200, corpo: { ok: true, versao: deps.versao, contrato: VERSAO_CONTRATO } }
  }

  if (p.caminho === `/${VERSAO_CONTRATO}/sessao`) {
    if (p.metodo !== 'GET') return erro('metodo_nao_suportado', 'Use GET.', 405)
    const auth = await autorizar(p.headerAutorizacao, deps)
    if (!auth.ok) return erro(auth.motivo, MENSAGEM[auth.motivo], statusDe(auth.motivo))
    const cred = await deps.repo.lerCredencial(auth.chamador.orgId)
    return {
      status: 200,
      corpo: {
        org_id: auth.chamador.orgId,
        is_admin: auth.chamador.isAdmin,
        modulo_habilitado: true,
        // D-13: "não conectado" é estado próprio, distinto de módulo desligado.
        conectado: cred !== null,
        expira_em: cred?.expiraEm?.toISOString() ?? null,
      },
    }
  }

  if (p.caminho === `/${VERSAO_CONTRATO}/oauth/iniciar`) {
    if (p.metodo !== 'POST') return erro('metodo_nao_suportado', 'Use POST.', 405)
    const r = await exigirAdmin(p, deps)
    if (r.erro) return r.erro

    const i = iniciar(deps.cliente, agora())
    await deps.repo.gravarEstado({
      state: i.state,
      orgId: r.chamador.orgId,
      iniciadoPor: r.chamador.userId,
      codeVerifier: i.codeVerifier,
      redirectUri: deps.cliente.redirectUri,
      expiraEm: i.expiraEm,
    })
    // A URL vai para o browser; o verifier fica no servidor. É o ponto do PKCE.
    return { status: 200, corpo: { url_autorizacao: i.urlAutorizacao, expira_em: i.expiraEm.toISOString() } }
  }

  if (p.caminho === `/${VERSAO_CONTRATO}/oauth/callback`) {
    if (p.metodo !== 'GET') return erro('metodo_nao_suportado', 'Use GET.', 405)
    return await callback(p, deps, agora())
  }

  if (p.caminho === `/${VERSAO_CONTRATO}/oauth/conexao`) {
    if (p.metodo !== 'DELETE') return erro('metodo_nao_suportado', 'Use DELETE.', 405)
    const r = await exigirAdmin(p, deps)
    if (r.erro) return r.erro
    await deps.repo.apagarCredencial(r.chamador.orgId)
    // D-27: apagar aqui não revoga do lado da JoomPulse — o metadado do provedor não anuncia
    // revocation_endpoint. A UI precisa dizer isso; o Gateway não pode fingir que revogou.
    return { status: 200, corpo: { desconectado: true, revogado_no_provedor: false } }
  }

  return erro('rota_desconhecida', 'Rota não encontrada.', 404)
}

/**
 * Callback do provedor. Chega pelo browser SEM o JWT do usuário: o `state` é a única prova de
 * identidade, e é por isso que ele é aleatório, de uso único e curto.
 *
 * Termina sempre em redirect para o app — o usuário está numa janela de navegador, não numa
 * chamada de API, e uma tela de JSON cru seria um beco sem saída.
 */
async function callback(p: Pedido, deps: DepsRotas, agora: Date): Promise<Resposta> {
  const voltar = (resultado: string) => {
    const u = new URL(deps.urlAppCanais)
    u.searchParams.set('joompulse', resultado)
    return { status: 302, redirecionarPara: u.toString() }
  }

  // O provedor sinaliza recusa do usuário por `error`, não por status HTTP.
  if (p.query.get('error')) return voltar('recusado')

  const code = p.query.get('code')
  const state = p.query.get('state') ?? ''
  if (!code) return voltar('sem_code')

  const consumo = await consumirEstado(state, deps.repo, agora)
  if (!consumo.ok) return voltar(`estado_${consumo.motivo}`)

  try {
    const tokens = await trocarCodePorToken(
      deps.cliente, code, consumo.estado.codeVerifier, deps.buscar, agora)
    await salvarCredencial(
      consumo.estado.orgId, consumo.estado.iniciadoPor, tokens, deps.chaveCredencial, deps.repo)
  } catch (e) {
    // Nada do erro original vai para a URL: ele pode carregar fragmento do code.
    console.error('[gateway] falha ao trocar code por token', e)
    return voltar('falha_troca')
  }

  return voltar('conectado')
}

/** Caminho e query de `req.url`, que no node:http vem relativo — a base é descartável. */
export function pedidoDe(
  req: Pick<IncomingMessage, 'url' | 'method' | 'headers'>,
): Pedido {
  const u = new URL(req.url ?? '/', 'http://gateway.invalid')
  return {
    metodo: req.method,
    caminho: u.pathname,
    query: u.searchParams,
    headerAutorizacao: req.headers.authorization,
  }
}

export { carregarCredencial }
