// Métricas do Mercado Ads por período (plano ads-redesign §5): leitura sob demanda, SÓ GET no ML.
// Lógica e autorização em handler.ts (vitest); aqui só a fiação de IO. Token só em memória, nunca na resposta.
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { exigirModulo } from '../_shared/produto/modulo.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { buscarML } from '../_shared/trafego/fiacao.ts';
import { ML_API, getComReautenticacao } from '../_shared/ads/fiacao.ts';
import { depsRedisAds } from '../_shared/ads/metricas-cache.ts';
import { tratar } from './handler.ts';

Deno.serve((req) => tratar(req, {
  autenticar: (r) => requireUserOrg(r, { access: 'read' }),
  moduloAds: (orgId) => exigirModulo(adminClient(), orgId, 'ads'),
  conexao: (orgId) => resolverConexao(adminClient(), orgId, 'mercado_livre'),
  ml(conexao) {
    // Token preguiçoso: cache hit não dispara refresh. 401 → descarta e pede de novo, uma vez (mesma rota do coletor).
    let token: string | null = null;
    const tokenML = async () => (token ??= await getValidAccessTokenConexao(conexao));
    return (path, headers, sinal) => getComReautenticacao(tokenML, () => { token = null; }, (t) =>
      buscarML(`${ML_API}${path}`, t, (u, init) =>
        fetch(u, { ...init, signal: sinal && init?.signal ? AbortSignal.any([init.signal, sinal]) : init?.signal }), headers));
  },
  cache: depsRedisAds,
  agora: () => new Date(),
  esperar: (ms) => new Promise((ok) => setTimeout(ok, ms)),
}));
