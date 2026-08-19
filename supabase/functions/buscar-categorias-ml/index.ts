import { requireUserOrg } from '../_shared/auth.ts'
import { resolverConexao } from '../_shared/canais/conexao.ts'
import { corsHeaders, handleOptions } from '../_shared/cors.ts'
import { buscarCategoriaPreditor } from '../_shared/ml/domain-discovery.ts'
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts'
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
    const conexao = await resolverConexao(adminClient(), orgId, 'mercado_livre')
    if (!conexao) return json({ categorias: [] })

    const token = await getValidAccessTokenConexao(conexao)
    const categorias = await buscarCategoriaPreditor(token, query)
    return json({
      categorias: categorias.slice(0, 8).map((categoria) => ({
        id: categoria.categoriaId,
        nome: categoria.categoriaNome,
        ...(categoria.domainName ? { caminho: categoria.domainName } : {}),
      })),
    })
  } catch (error) {
    console.error('buscar-categorias-ml falhou:', error)
    return json({ error: 'Busca de categorias indisponível.' }, 503)
  }
})
