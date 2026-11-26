// Chave de agente (ADR-0210, fatia 1): `pai_<8 hex>_<43 base64url>`. Só o hash SHA-256 vai ao banco; o prefixo
// identifica a chave na tela sem expô-la. Web Crypto puro (Deno e Node do vitest).
const FORMATO = /^pai_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const base64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function hashChave(chave: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chave))));
}

export async function gerarChave(): Promise<{ chave: string; prefixo: string; hash: string }> {
  const prefixo = hex(crypto.getRandomValues(new Uint8Array(4)));
  const chave = `pai_${prefixo}_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  return { chave, prefixo, hash: await hashChave(chave) };
}

/** `Authorization: Bearer pai_…` (Bearer em qualquer caixa) ou a chave sozinha (Emenda 1: cada cliente manda de
 *  um jeito). A chave tem de casar o formato exato; JWT, `Bearer Bearer …` e outros esquemas = null. */
export function extrairChave(req: Request): string | null {
  const m = /^(?:bearer +)?(\S+)$/i.exec((req.headers.get('Authorization') ?? '').trim());
  return m && FORMATO.test(m[1]) ? m[1] : null;
}

/** Permissões por chave (Emenda 6). `publiai_loja` não exige nenhuma; nenhuma dá escrita. */
export type Permissao = 'margens' | 'catalogo';
export const PERMISSOES: readonly Permissao[] = ['margens', 'catalogo'];

/** Fecha em dado ruim (Emenda 6): não-lista, lista vazia ou qualquer valor desconhecido → nenhuma; repetidos válidos saem uma vez. */
export function permissoesDaLinha(x: unknown): Permissao[] {
  if (!Array.isArray(x) || !x.every((p) => PERMISSOES.includes(p))) return [];
  return [...new Set(x as Permissao[])];
}

/** `expira_em` null = vale até revogar (Emenda 1). `permissoes` cru do banco: lido por `permissoesDaLinha`. */
export type LinhaConexao = {
  id: string; org_id: string; expira_em: string | null; revogada_em: string | null; permissoes: unknown;
};

/** Revogada vence expirada; expira exatamente em `agora` já é expirada. Fecha em dado ruim: `revogada_em` não nulo
 *  (mesmo não parseável) = revogada; `expira_em` ou `agora` inválidos = expirada; só `null` exato é "sem validade". */
export function situacaoDaConexao(l: LinhaConexao, agora: Date): 'ok' | 'revogada' | 'expirada' {
  if (l.revogada_em !== null) return 'revogada';
  if (l.expira_em === null) return 'ok';
  return new Date(l.expira_em).getTime() > agora.getTime() ? 'ok' : 'expirada'; // NaN > x é falso
}
