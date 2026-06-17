export function humanizarErroVendasML(raw: string, scope?: string | null): string {
  const msg = String(raw || '').trim();
  const norm = msg.toLowerCase();
  const scopeNorm = (scope ?? '').toLowerCase();
  const semRead = !!scopeNorm && !scopeNorm.split(/\s+/).includes('read');

  if (
    /ml \/orders (401|403)/.test(norm) ||
    /policyagent|forbidden|not authorized|not_authorized|unauthorized|insufficient_scope/.test(norm)
  ) {
    const detalheScope = semRead
      ? ' O token atual também não traz o escopo OAuth `read`.'
      : '';
    return `Sem acesso aos pedidos do Mercado Livre. Habilite a permissão de Pedidos no app do Dev Center, reconecte a conta em Configurações e atualize esta tela.${detalheScope}`;
  }

  if (/ml \/users\/me 401|oauth\/token|access token|refresh token|credencial|token ml/.test(norm)) {
    return 'A credencial do Mercado Livre expirou, foi revogada ou não pôde ser renovada. Reconecte a conta em Configurações e tente novamente.';
  }

  return msg || 'Não foi possível ler as vendas do Mercado Livre.';
}
