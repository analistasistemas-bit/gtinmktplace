import type { ErroCanal, ErroCanalCodigo } from '../canais/contrato.ts';

/**
 * A Shopee responde HTTP 200 mesmo em erro de negócio, com corpo
 * `{ error, message, request_id }`. `classificarErroShopee` traduz o campo
 * `error` (string) para o código canônico + `retentavel`.
 *
 * Retentável: auth expirado, rate-limit, 5xx e `error_server` (transientes).
 */
export interface CorpoErroShopee {
  error?: string;
  message?: string;
  request_id?: string;
}

interface Regra {
  codigo: ErroCanalCodigo;
  retentavel: boolean;
}

// Match por substring no campo `error` (lowercase). Ordem importa: mais
// específico primeiro. A Shopee usa prefixos como `error_auth`, `error_param`,
// `error_permission`, `error_not_found`, `error_server`, além de variações de
// rate-limit (`error_rate_limit`, `error_busy`, `too_many_request`).
const REGRAS: Array<[RegExp, Regra]> = [
  [/rate.?limit|too.?many|error_busy|throttl/, { codigo: 'RATE_LIMIT', retentavel: true }],
  [/auth|token|access_token|invalid_access/, { codigo: 'AUTENTICACAO', retentavel: true }],
  [/permission|not_auth|no_permission/, { codigo: 'AUTENTICACAO', retentavel: false }],
  [/server|internal|system_error/, { codigo: 'INDISPONIVEL', retentavel: true }],
  [/category|cat_id/, { codigo: 'CATEGORIA', retentavel: false }],
  [/image|picture|media/, { codigo: 'FOTO', retentavel: false }],
  [/stock|quantity/, { codigo: 'ESTOQUE', retentavel: false }],
  [/price/, { codigo: 'PRECO', retentavel: false }],
  [/attribute|attr/, { codigo: 'ATRIBUTO', retentavel: false }],
  [/not_found|not_exist/, { codigo: 'INDISPONIVEL', retentavel: false }],
  [/param/, { codigo: 'ATRIBUTO', retentavel: false }],
];

export function classificarErroShopee(body: CorpoErroShopee | null | undefined, httpStatus?: number): ErroCanal {
  const error = (body?.error ?? '').toLowerCase().trim();
  const mensagemOperador = body?.message || body?.error || 'Erro desconhecido da Shopee';

  // 5xx HTTP sempre retentável (transiente de rede/infra), independente do corpo.
  const http5xx = typeof httpStatus === 'number' && httpStatus >= 500;
  const http429 = httpStatus === 429;

  let codigo: ErroCanalCodigo = 'DESCONHECIDO';
  let retentavel = http5xx || http429;

  if (error) {
    const regra = REGRAS.find(([re]) => re.test(error))?.[1];
    if (regra) {
      codigo = regra.codigo;
      retentavel = retentavel || regra.retentavel;
    }
  }
  if (http429) codigo = 'RATE_LIMIT';

  return { codigo, mensagemOperador, retentavel, status: httpStatus, raw: body };
}
