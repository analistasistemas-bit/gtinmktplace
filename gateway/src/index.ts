// Ponto de entrada do Gateway de mercado (ADR-0132 D-2, D-14).
//
// Web Service separado no Render. Ainda NÃO fala com a JoomPulse: esta primeira entrega estabelece
// identidade, org e gate do módulo. A allowlist de ferramentas MCP (D-9) e o cache (D-11) entram
// depois, sobre esta base.

import { createServer } from 'node:http'
import { cabecalhosCors, origemPermitida, origensDaEnv } from './cors.js'
import { caminhoDe, erro, tratar, type DepsRotas } from './rotas.js'
import { criarClienteAdmin, depsDoSupabase } from './supabase.js'

/** Falha no boot é melhor que 500 na primeira requisição de produção. */
function obrigatoria(nome: string): string {
  const valor = process.env[nome]
  if (!valor) throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`)
  return valor
}

function main(): void {
  const url = obrigatoria('SUPABASE_URL')
  const serviceRoleKey = obrigatoria('SUPABASE_SERVICE_ROLE_KEY')
  const origens = origensDaEnv(process.env.ORIGENS_PERMITIDAS)
  const porta = Number(process.env.PORT ?? 10000)

  if (origens.length === 0) {
    // Sem allowlist o Gateway sobe mas nenhum browser consegue usá-lo. Avisar alto é melhor que
    // deixar o time caçando um erro de CORS no console do usuário.
    console.warn('[gateway] ORIGENS_PERMITIDAS vazio: nenhuma origem de browser será aceita.')
  }

  const deps: DepsRotas = {
    ...depsDoSupabase(criarClienteAdmin(url, serviceRoleKey)),
    versao: process.env.RENDER_GIT_COMMIT?.slice(0, 8) ?? 'dev',
  }

  const servidor = createServer((req, res) => {
    const origem = origemPermitida(req.headers.origin, origens)
    const cors = cabecalhosCors(origem)

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end()
      return
    }

    void tratar(req.method, caminhoDe(req), req.headers.authorization, deps)
      .then((resposta) => {
        res.writeHead(resposta.status, { ...cors, 'Content-Type': 'application/json' })
        res.end(JSON.stringify(resposta.corpo))
      })
      .catch((e: unknown) => {
        // Nunca vazar a mensagem original: ela pode carregar fragmento de token ou de query.
        console.error('[gateway] erro nao tratado', e)
        const r = erro('erro_interno', 'Erro interno no Gateway.', 500)
        res.writeHead(r.status, { ...cors, 'Content-Type': 'application/json' })
        res.end(JSON.stringify(r.corpo))
      })
  })

  servidor.listen(porta, () => console.log(`[gateway] ouvindo na porta ${porta}`))
}

main()
