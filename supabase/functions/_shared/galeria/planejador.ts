// Planejador de IA da galeria (ADR-0203): paleta + 7 prompts a partir dos DADOS e da foto. O código valida (plano.ts).
// Roda igual na edge (Deno) e no vitest.
import { createHash } from 'node:crypto'
import { openrouterClient } from '../ai/client.ts'
import { EXEMPLO_CAMISETA, EXEMPLO_FITA } from './plano-exemplos.ts'
import { validarPlano, type Plano } from './plano.ts'

export interface DadosPlanejador {
  nome: string; descricao_fornecedor: string | null; marca: string | null
  ficha_do_anuncio: Record<string, string>
  total_de_cores: number; conteudo_da_embalagem: '1 unidade na cor escolhida'
}

export const TIMEOUT_PLANO_MS = [60_000, 30_000] as const // medido 12/11: 34 s na 1ª chamada; a edge galeria-gerar tem de caber em 150 s

export const hashDados = (dados: DadosPlanejador): string => createHash('sha256').update(JSON.stringify(dados)).digest('hex')

const SISTEMA = `Você é diretor de arte e redator de anúncios de marketplace brasileiro. Recebe os DADOS de um produto e a foto real dele e planeja as 7 imagens do anúncio. O plano vale para todas as cores do anúncio.

FUNÇÕES (estrutura padrão; adapte a função 3 e a 6 ao tipo de produto, como nos exemplos):
1 capa sem texto, fundo branco puro, só o produto; 2 contexto de uso; 3 quebra da principal objeção de compra; 4 benefícios (até 3); 5 ficha técnica; 6 como usar / como escolher; 7 detalhes e acabamento.

REGRAS DE CONTEÚDO (invioláveis):
- Use SOMENTE fatos presentes nos DADOS ou visíveis na foto. Nunca invente medida, composição, certificação, quantidade, garantia, selo, desconto, avaliação.
- Se duas fontes dos DADOS se contradizem sobre um fato, NÃO use esse fato e liste-o em "conflitos".
- Sem superlativo nem promessa sem prova ("o melhor", "não desfia", "alta resistência", "durável").
- Benefício = característica verificável dita do jeito do comprador. Até 3 por imagem, até 6 palavras cada.
- Headline em CAIXA ALTA, até 5 palavras. Subheadline até 8 palavras. Português do Brasil com acentuação correta.
- Na ficha técnica, só linhas "Rótulo: valor" tiradas dos DADOS, sem título.
- Escreva {{COR}} onde a cor do produto aparecer no prompt. Nunca cite a cor, nem código de cor, dentro de "textos".
- Se os DADOS não sustentam uma posição (ex.: ficha técnica com menos de 2 linhas), devolva nela "indisponivel" com o motivo em uma frase, "textos": [] e "prompt": "".

DIREÇÃO DE ARTE: a paleta sai da embalagem/rótulo/marca vistos na foto (2 cores fortes da marca + branco). Não use azul-marinho e vermelho por padrão: só se forem as cores da marca.

PROMPT DE CADA IMAGEM: em português, no formato dos exemplos: tipo de imagem e formato vertical; "Produto: ..." com os fatos; a cena/composição fotográfica; os textos, cada um entre aspas, precedidos de "Inserir exatamente os textos:"; e uma linha final "Não inserir/Não inventar ...". Não descreva cores de layout nem tipografia no prompt (isso vem da direção de arte). Não coloque entre aspas nada que não deva aparecer escrito na imagem.

Responda APENAS JSON:
{"formato": 2, "conflitos": ["..."],
 "paleta": {"cor1": {"nome": "...", "hex": "#..."}, "cor2": {"nome": "...", "hex": "#..."}},
 "imagens": [{"posicao": 1, "funcao": "...", "textos": ["cada texto exato que aparece na imagem"], "prompt": "..."}, ... 7 itens]}`

const LINHA_MODA = 'MODA: nenhuma imagem leva texto ("textos": [] em todas). Só vistas que a foto sustenta; nunca invente costas ou lateral.'

export function montarMensagens(dados: DadosPlanejador, refUrl: string, moda: boolean): unknown[] {
  const texto = 'EXEMPLO A (fita de velcro), prompts 1 a 7:\n' + EXEMPLO_FITA + '\n\nEXEMPLO B (camiseta):\n' + EXEMPLO_CAMISETA +
    '\n\nAGORA PLANEJE ESTE PRODUTO.\nDADOS:\n' + JSON.stringify(dados, null, 1)
  return [
    { role: 'system', content: moda ? `${SISTEMA}\n${LINHA_MODA}` : SISTEMA },
    { role: 'user', content: [{ type: 'text', text: texto }, { type: 'image_url', image_url: { url: refUrl } }] },
  ]
}

// Código de `validarPlano` → instrução que o modelo entende (":N" = número da imagem).
const EXPLICA: Record<string, string> = {
  formato: 'JSON fora do formato pedido',
  paleta: 'paleta com nome e hex #RRGGBB nas duas cores',
  posicoes: 'exatamente 7 imagens, posições 1 a 7, sem repetir',
  capa_com_texto: 'a imagem 1 (capa) não leva texto: "textos": []',
  moda_com_texto: 'em Moda nenhuma imagem leva texto: "textos": [] em todas',
  textos_demais: 'no máximo 8 textos',
  texto_longo: 'cada texto com no máximo 60 caracteres',
  termo_proibido: 'há termo proibido (preço, desconto, frete, garantia, selo, "premium", promessa "100% ...")',
  numero_fora_dos_dados: 'há número que não está nos DADOS; use só números que aparecem nos DADOS',
  cor_no_texto: 'há nome de cor em "textos"; a cor nunca aparece nos textos',
  texto_fora_do_prompt: 'cada item de "textos" tem de aparecer literalmente, entre aspas, no "prompt" da mesma imagem',
}
export function explicarErros(erros: string[]): string {
  return erros.map((e) => {
    const [codigo, n] = e.split(':')
    return `${n ? `imagem ${n}: ` : ''}${EXPLICA[codigo] ?? codigo}`
  }).join('; ')
}

type Resultado ={ plano: Plano } | { erro: 'plano_ia_falhou' | 'plano_invalido'; erros?: string[] }

export async function gerarPlanoIA(p: { modelo: string; dados: DadosPlanejador; refUrl: string; moda: boolean; cores: string[] }): Promise<Resultado> {
  const ctx = { moda: p.moda, dadosTexto: JSON.stringify(p.dados), cores: p.cores, dadosHash: hashDados(p.dados) }
  const mensagens = montarMensagens(p.dados, p.refUrl, p.moda)
  let erros: string[] = []
  for (let tentativa = 0; tentativa < TIMEOUT_PLANO_MS.length; tentativa++) {
    let conteudo: string
    try {
      const resp = await openrouterClient().chat.completions.create({
        model: p.modelo, messages: [...mensagens], response_format: { type: 'json_object' }, temperature: 0.4, max_tokens: 6000,
        // deno-lint-ignore no-explicit-any
      } as any, { maxRetries: 0, signal: AbortSignal.timeout(TIMEOUT_PLANO_MS[tentativa]) })
      // deno-lint-ignore no-explicit-any
      conteudo = String((resp as any)?.choices?.[0]?.message?.content ?? '')
    } catch {
      return { erro: 'plano_ia_falhou' }
    }
    let bruto: unknown = null
    try { bruto = JSON.parse(conteudo) } catch { /* vira erro de formato abaixo */ }
    const r = validarPlano(bruto, ctx)
    if ('plano' in r) return r
    erros = r.erros
    mensagens.push({ role: 'assistant', content: conteudo }, { role: 'user', content: `Corrija: ${explicarErros(erros)}. Responda de novo o JSON completo.` })
  }
  return { erro: 'plano_invalido', erros }
}
