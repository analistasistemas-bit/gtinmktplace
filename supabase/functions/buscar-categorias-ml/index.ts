import { requireUserOrg } from '../_shared/auth.ts'
import { resolverConexao } from '../_shared/canais/conexao.ts'
import { corsHeaders, handleOptions } from '../_shared/cors.ts'
import { buscarCategoriaPreditor } from '../_shared/ml/domain-discovery.ts'
import { adminClient } from '../_shared/supabase.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions()
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  let orgId: string
  try { ({ orgId } = await requireUserOrg(req)) }
  catch (resp) { if (resp instanceof Response) return resp; throw resp }

  const body = await req.json().catch(() => ({})) as { query?: unknown }
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (query.length < 3 || query.length > 120) {
    return json({ error: 'Informe uma busca entre 3 e 120 caracteres.' }, 400)
  }

  try {
    const admin = adminClient()
    const conexao = await resolverConexao(admin, orgId, 'mercado_livre')
    if (!conexao) return json({ categorias: [] })

    // Leitura deliberada: getValidAccessTokenConexao pode renovar/persistir o token.
    // Esta sugestão é opcional, portanto token vencido cai no fallback manual sem mutação.
    const { data, error } = await admin.rpc('get_connection_tokens', { p_connection_id: conexao.id })
    if (error) throw new Error('get_connection_tokens indisponível')
    const tokenAtual = (data as Array<{ access_token?: unknown; expires_at?: unknown }> | null)?.[0]
    const expiresAt = typeof tokenAtual?.expires_at === 'string' ? Date.parse(tokenAtual.expires_at) : Number.NaN
    if (typeof tokenAtual?.access_token !== 'string' || !tokenAtual.access_token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return json({ categorias: [] })
    }

    const categorias = await buscarCategoriaPreditor(tokenAtual.access_token, query)
    return json({
      categorias: categorias.slice(0, 8).map((categoria) => ({
        id: categoria.categoriaId,
        nome: categoria.categoriaNome,
        ...(categoria.domainName ? { caminho: categoria.domainName } : {}),
      })),
    })
  } catch {
    console.error('buscar-categorias-ml: falha ao consultar preditor')
    return json({ error: 'Busca de categorias indisponível.' }, 503)
  }
})
