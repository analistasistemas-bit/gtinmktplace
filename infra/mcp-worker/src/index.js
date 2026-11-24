// mcp.publiai.daludi.com.br (ADR-0210, Emenda 1): endereço com a marca para a edge `agentes`. Só repassa; toda
// regra (chave, organização, limites, auditoria) continua na edge. Não lê, guarda nem registra cabeçalho.
const DESTINO = 'https://txvncrgkoynoxwopfkbp.supabase.co/functions/v1/agentes';
const ICONE = 'https://app.publiai.daludi.com.br/apple-touch-icon.png';

export default {
  async fetch(req) {
    const { pathname } = new URL(req.url);
    // Ícone do conector no claude.ai e afins (buscam o favicon do domínio).
    if (pathname === '/favicon.ico' || pathname === '/favicon.png' || pathname === '/apple-touch-icon.png') {
      const r = await fetch(ICONE);
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
    }
    if (pathname !== '/' && pathname !== '/mcp') return new Response('Not found', { status: 404 });

    const headers = new Headers(req.headers);
    headers.delete('host');
    return fetch(DESTINO, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
      redirect: 'manual',
    });
  },
};
