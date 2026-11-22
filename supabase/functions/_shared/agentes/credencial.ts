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

/** Só `Authorization: Bearer pai_…` no formato exato; qualquer outra coisa (JWT inclusive) = null. */
export function extrairChave(req: Request): string | null {
  const m = /^Bearer (\S+)$/.exec(req.headers.get('Authorization') ?? '');
  return m && FORMATO.test(m[1]) ? m[1] : null;
}

export type LinhaConexao = { id: string; org_id: string; expira_em: string; revogada_em: string | null };

/** Revogada vence expirada; expira exatamente em `agora` já é expirada. */
export function situacaoDaConexao(l: LinhaConexao, agora: Date): 'ok' | 'revogada' | 'expirada' {
  if (l.revogada_em) return 'revogada';
  return new Date(l.expira_em).getTime() <= agora.getTime() ? 'expirada' : 'ok';
}
