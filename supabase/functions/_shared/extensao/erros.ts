// Contrato de erro da edge `extensao` (ADR-0189 D-18). Puro: sem imports de runtime.

export type CodigoErro =
  | 'sessao_expirada'
  | 'sessao_suporte_expirada'
  | 'modulo_desligado'
  | 'limite'
  | 'payload_invalido'
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

/** Mapeia qualquer exceção para status + `{ erro }`. Nunca vaza mensagem/stack/token. */
export function normalizarErro(e: unknown): { status: number; corpo: CorpoErro } {
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
    if (e.status === 403) return { status: 403, corpo: { erro: 'interno' } };
  }
  return { status: 500, corpo: { erro: 'interno' } };
}
