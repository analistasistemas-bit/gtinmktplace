// Ponto de entrada do Gateway de mercado (ADR-0132 D-2, D-14).
//
// Web Service separado no Render. Nesta entrega ele já conecta a conta JoomPulse por OAuth e
// guarda a credencial cifrada. Ainda NÃO consulta o MCP: a allowlist de ferramentas (D-9) e o
// cache (D-11) entram depois, sobre esta base.

import { createServer } from 'node:http'
import { CAMINHO_CIMD, cimdCoerente, ehCimd } from './cimd.js'
import { chaveDaEnv } from './cripto.js'
import { cabecalhosCors, origemPermitida, origensDaEnv } from './cors.js'
import { erro, pedidoDe, tratar, type DepsRotas } from './rotas.js'
import { criarClienteAdmin, depsDoSupabase, repositorioDoSupabase } from './supabase.js'

/** Falha no boot é melhor que 500 na primeira requisição de produção. */
function obrigatoria(nome: string): string {
  const valor = process.env[nome]
  if (!valor) throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`)
  return valor
}

function main(): void {
  const url = obrigatoria('SUPABASE_URL')
  const serviceRoleKey = obrigatoria('SUPABASE_SERVICE_ROLE_KEY')
  // Falha alto se ausente ou do tamanho errado: chave inválida jamais pode degradar para
  // "guardar sem cifrar".
  const chaveCredencial = chaveDaEnv(obrigatoria('CREDENCIAL_CHAVE_BASE64'))
  const clientId = obrigatoria('JOOMPULSE_CLIENT_ID')
  const redirectUri = obrigatoria('GATEWAY_REDIRECT_URI')
  const urlAppCanais = obrigatoria('APP_URL_CANAIS')
  const origens = origensDaEnv(process.env.ORIGENS_PERMITIDAS)
  const porta = Number(process.env.PORT ?? 10000)

  // Modo CIMD: o client_id é a URL onde ESTE serviço publica o documento do cliente. A
  // especificação exige que o id declarado no documento seja idêntico à URL que o serviu, então
  // um client_id https apontando para outro caminho nunca funcionaria. Falhar aqui é muito melhor
  // que descobrir no meio da conexão de um cliente.
  if (!cimdCoerente(clientId)) {
    throw new Error(
      `JOOMPULSE_CLIENT_ID é uma URL (modo CIMD) mas não termina em ${CAMINHO_CIMD}: ${clientId}`)
  }
  if (ehCimd(clientId)) {
    console.log(`[gateway] modo CIMD: documento do cliente publicado em ${CAMINHO_CIMD}`)
  }

  if (origens.length === 0) {
    console.warn('[gateway] ORIGENS_PERMITIDAS vazio: nenhuma origem de browser será aceita.')
  }

  const admin = criarClienteAdmin(url, serviceRoleKey)
  const deps: DepsRotas = {
    ...depsDoSupabase(admin),
    repo: repositorioDoSupabase(admin),
    // Sem secret o provedor aceita client público (`none` está em
    // token_endpoint_auth_methods_supported), e o PKCE segue protegendo o code.
    cliente: { clientId, clientSecret: process.env.JOOMPULSE_CLIENT_SECRET, redirectUri },
    chaveCredencial,
    buscar: fetch,
    urlAppCanais,
    uriApp: process.env.APP_URL,
    versao: process.env.RENDER_GIT_COMMIT?.slice(0, 8) ?? 'dev',
  }

  const servidor = createServer((req, res) => {
    const origem = origemPermitida(req.headers.origin, origens)
    const cors = cabecalhosCors(origem)

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end()
      return
    }

    void tratar(pedidoDe(req), deps)
      .then((resposta) => {
        if (resposta.redirecionarPara) {
          res.writeHead(resposta.status, { ...cors, Location: resposta.redirecionarPara }).end()
          return
        }
        res.writeHead(resposta.status, { ...cors, 'Content-Type': 'application/json' })
        res.end(JSON.stringify(resposta.corpo))
      })
      .catch((e: unknown) => {
        // Nunca vazar a mensagem original: pode carregar fragmento de token, code ou query.
        console.error('[gateway] erro nao tratado', e)
        const r = erro('erro_interno', 'Erro interno no Gateway.', 500)
        res.writeHead(r.status, { ...cors, 'Content-Type': 'application/json' })
        res.end(JSON.stringify(r.corpo))
      })
  })

  servidor.listen(porta, () => console.log(`[gateway] ouvindo na porta ${porta}`))
}

main()
