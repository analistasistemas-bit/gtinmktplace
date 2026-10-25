// Contrato de erro da edge `extensao` (ADR-0189 D-18). Puro: sem imports de runtime.

export type CodigoErro =
  | 'sessao_expirada'
  | 'sessao_suporte_expirada'
  | 'modulo_desligado'
  | 'limite'
  | 'payload_invalido'
  | 'identidade_mudou'
  | 'sem_acesso'
  | 'interno';

export interface CorpoErro {
  erro: CodigoErro;
  mensagem?: string;
}

export const MENSAGEM_LIMITE = 'Muitas análises em sequência. Aguarde um minuto.';

/** Erro de domínio lançado pela edge; `normalizarErro` o traduz para o contrato. */
export class ErroExtensao extends Error {
  constructor(readonly codigo: CodigoErro, readonly status: number) {
    super(codigo);
  }
}

/** Mapeia qualquer exceção para status + `{ erro }`. Nunca vaza mensagem/stack/token.
 *  `protocolo` 2 (extensão 0.3.0+): 403 sem marca vira `sem_acesso`; sem ele, contrato da 0.2.x intacto. */
export function normalizarErro(e: unknown, protocolo?: number): { status: number; corpo: CorpoErro } {
  if (e instanceof ErroExtensao) {
    const corpo: CorpoErro = { erro: e.codigo };
    if (e.codigo === 'limite') corpo.mensagem = MENSAGEM_LIMITE;
    return { status: e.status, corpo };
  }
  if (e instanceof Response) {
    if (e.status === 401) return { status: 401, corpo: { erro: 'sessao_expirada' } };
    // `requireUserOrg` marca com header a sessão de suporte ausente/expirada (_shared/auth.ts).
    if (e.status === 403 && e.headers.get('x-motivo') === 'sessao_suporte') {
      return { status: 403, corpo: { erro: 'sessao_suporte_expirada' } };
    }
    // Perfil inativo/sem org ou suporte só-leitura tentando escrever: sem código próprio no contrato.
    if (e.status === 403) return { status: 403, corpo: { erro: protocolo === 2 ? 'sem_acesso' : 'interno' } };
  }
  return { status: 500, corpo: { erro: 'interno' } };
}
