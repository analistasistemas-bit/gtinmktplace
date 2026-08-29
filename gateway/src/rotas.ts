// Roteamento e envelope de resposta do Gateway (ADR-0132 D-8).
//
// A API é versionada sob /v1 e expõe operação de domínio — nunca `tool` + `args`. Não existe
// proxy MCP genérico (D-9): cada rota nova é uma decisão, não um parâmetro.
//
// Este arquivo é deliberadamente sem framework: são poucas rotas e o `node:http` resolve. Trocar
// por um roteador quando houver rota com path param que justifique.

import type { IncomingMessage } from 'node:http'
import { autorizar, statusDe, type DepsAutorizacao, type MotivoRecusa } from './autorizacao.js'

export const VERSAO_CONTRATO = 'v1'

export interface Resposta {
  status: number
  corpo: unknown
}

/** Envelope único de erro. Código é para a máquina; mensagem, para o humano. */
export function erro(codigo: MotivoRecusa | string, mensagem: string, status: number): Resposta {
  return { status, corpo: { erro: { codigo, mensagem } } }
}

const MENSAGEM: Record<MotivoRecusa, string> = {
  sem_token: 'Requisição sem token de autenticação.',
  token_invalido: 'Token inválido ou expirado.',
  perfil_ausente: 'Perfil não encontrado.',
  perfil_inativo: 'Perfil inativo.',
  sem_org: 'Perfil sem organização.',
  // D-13: este estado é distinto dos demais e a UI depende disso para dizer ao operador que a
  // funcionalidade existe mas não está habilitada — não que ele perdeu o acesso.
  modulo_desligado: 'Módulo Análise PubliAI não habilitado para esta organização.',
}

export interface DepsRotas extends DepsAutorizacao {
  /** Versão do serviço, exposta no health check para conferir o que está no ar. */
  versao: string
}

export async function tratar(
  metodo: string | undefined,
  caminho: string,
  headerAutorizacao: string | null | undefined,
  deps: DepsRotas,
): Promise<Resposta> {
  if (metodo !== 'GET') {
    return erro('metodo_nao_suportado', `Método ${metodo ?? '?'} não suportado.`, 405)
  }

  // Health check é público de propósito: o Render precisa dele antes de qualquer credencial
  // existir, e ele não revela nada sobre organização nenhuma.
  if (caminho === '/health') {
    return { status: 200, corpo: { ok: true, versao: deps.versao, contrato: VERSAO_CONTRATO } }
  }

  if (caminho === `/${VERSAO_CONTRATO}/sessao`) {
    const auth = await autorizar(headerAutorizacao, deps)
    if (!auth.ok) return erro(auth.motivo, MENSAGEM[auth.motivo], statusDe(auth.motivo))
    // Devolve o que o Gateway concluiu por conta própria — é o contrato de que o gate é
    // server-side, e serve de diagnóstico quando a UI e o Gateway discordam.
    return {
      status: 200,
      corpo: {
        org_id: auth.chamador.orgId,
        is_admin: auth.chamador.isAdmin,
        modulo_habilitado: true,
      },
    }
  }

  return erro('rota_desconhecida', 'Rota não encontrada.', 404)
}

/** Caminho sem query string. `req.url` do node:http vem relativo, então a base é descartável. */
export function caminhoDe(req: Pick<IncomingMessage, 'url'>): string {
  return new URL(req.url ?? '/', 'http://gateway.invalid').pathname
}
