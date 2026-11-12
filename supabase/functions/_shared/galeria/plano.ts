// Plano da galeria (formato 2, ADR-0203): a IA planeja as 7 imagens; o código valida e monta o prompt final.
// Roda igual na edge (Deno) e no vitest.
import { BLOCO_TECNICO, termosProibidos } from './regras.ts'
import { NUM, numero } from './fatos.ts'

export interface CorPaleta { nome: string; hex: string }
export interface ImagemPlano { posicao: 1 | 2 | 3 | 4 | 5 | 6 | 7; funcao: string; textos: string[]; prompt: string; indisponivel?: string }
export interface Plano { formato: 2; dados_hash: string; paleta: { cor1: CorPaleta; cor2: CorPaleta }; conflitos: string[]; imagens: ImagemPlano[] }

const FIDELIDADE = 'Utilize as fotografias reais do produto anexadas como referência obrigatória: formato, cor, textura e, principalmente, o RÓTULO devem ser idênticos aos das fotos (mesmo logotipo, mesmas palavras, mesmas cores), nítido e legível. Não invente nem altere nada do rótulo.'
const estilo = (c1: CorPaleta, c2: CorPaleta) => `ESTILO VISUAL OBRIGATÓRIO (arte publicitária de marketplace brasileiro, alto impacto, acabamento profissional):
- REGRA PRINCIPAL DE TEXTO: a imagem final deve conter EXATAMENTE os textos pedidos entre aspas acima e nenhum outro (fora o rótulo do próprio produto). É PROIBIDO criar cartões, etiquetas, selos, legendas, títulos, subtítulos ou frases para informações que não foram pedidas entre aspas, mesmo que sejam verdadeiras. Nunca escreva na imagem trechos destas instruções. Os elementos gráficos abaixo são um vocabulário: use somente os necessários para exibir os textos pedidos.
- Mostrar apenas UMA unidade do produto com rótulo, salvo se o pedido acima disser outra coisa.
- Paleta fixa: ${c1.nome} (${c1.hex}) como cor principal, ${c2.nome} (${c2.hex}) como cor de destaque, branco e cinza muito claro. Texto de apoio em cinza-escuro.
- Headline em CAIXA ALTA, fonte sans-serif geométrica extra-bold (peso Black, estilo Montserrat Black), muito grande, ocupando quase toda a largura do topo: texto branco dentro de uma faixa na cor principal de cantos arredondados com um detalhe curvo na cor de destaque (ou, em cena fotográfica, texto na cor principal direto sobre a área clara). Logo abaixo, um traço curvo fino na cor de destaque.
- Subheadline em sans-serif regular, cinza-escuro, grande e legível no celular.
- Blocos de informação: cartões brancos de cantos bem arredondados com sombra suave; à esquerda um quadrado na cor principal com ícone de linha branco; um filete vertical na cor de destaque; rótulo na cor principal bold e valor na cor de destaque bold, letras grandes.
- Etapas numeradas: número branco grande dentro de um quadrado na cor de destaque; faixa na cor principal com o título da etapa em branco caixa alta; fotografia ampla ao lado com cantos arredondados.
- Rótulos de detalhe: etiquetas na cor principal com texto branco em caixa alta, ligadas ao ponto por linha fina na cor de destaque; ampliações macro dentro de círculo com borda na cor de destaque.
- Rodapé com curva decorativa nas duas cores.
- Produto grande e dominante (cerca de metade da imagem), foco perfeito, fundo branco com leve degradê cinza e sombra suave de estúdio.
- Nenhum texto nem elemento importante a menos de 4% das bordas da imagem.
- Todo texto com ortografia e acentuação perfeitas em português do Brasil, exatamente como escrito entre aspas.`

const MAX_TEXTOS = 8
const MAX_CHARS = 60
const HEX = /^#[0-9A-F]{6}$/i
// Nome da cor da paleta entra no prompt da imagem: só nome de cor, nunca instrução.
const NOME_COR = /^[\p{L}][\p{L} -]{0,39}$/u
// Trechos entre aspas duplas (retas ou tipográficas) do prompt: o que o gerador escreve na imagem. Aspas simples e
// apóstrofo ("d'água") ficam de fora.
const ASPAS = /"([^"]*)"|“([^”]*)”/g

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
// Números do texto como tokens inteiros (NUM casa "254", "1,5", "1.500"); comparação por valor via `numero`.
const numeros = (s: string) => (s.match(new RegExp(NUM, 'g')) ?? []).map(numero)
const posicaoInteira = (i: unknown) => isObj(i) && Number.isInteger(i.posicao)

export function ehPlano(conteudo: unknown): conteudo is Plano {
  return isObj(conteudo) && conteudo.formato === 2 && Array.isArray(conteudo.imagens) && conteudo.imagens.length === 7
    && conteudo.imagens.every(posicaoInteira)
}

export function validarPlano(
  bruto: unknown,
  ctx: { moda: boolean; dadosTexto: string; cores: string[]; dadosHash: string },
): { plano: Plano } | { erros: string[] } {
  if (!isObj(bruto) || !Array.isArray(bruto.imagens) || !isObj(bruto.paleta)) return { erros: ['formato'] }
  const erros: string[] = []
  const p = bruto as unknown as Plano

  const paletaOk = (c: unknown) => isObj(c) && typeof c.nome === 'string' && NOME_COR.test(c.nome.trim()) && typeof c.hex === 'string' && HEX.test(c.hex)
  if (!paletaOk(p.paleta.cor1) || !paletaOk(p.paleta.cor2)) erros.push('paleta')

  const imagens = p.imagens.filter(isObj) as unknown as ImagemPlano[]
  const posicoes = imagens.map((i) => i.posicao).sort()
  if (imagens.length !== 7 || !imagens.every(posicaoInteira) || posicoes.join() !== '1,2,3,4,5,6,7') erros.push('posicoes')

  const dados = new Set(numeros(ctx.dadosTexto))
  // Cor cadastrada vem com código interno ("Carmim Und 3528"): compara o nome sem o código, por palavra inteira.
  // Pontuação vira espaço nos dois lados ("Azul-Marinho" casa "AZUL-MARINHO" e "AZUL MARINHO").
  const semPontuacao = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, ' ')
  const cores = ctx.cores.map((c) => semPontuacao(norm(c)).split(/\s+/).filter((w) => w !== '' && w !== 'und' && !/^\d+$/.test(w)).join(' ')).filter((c) => c !== '')
  const temCor = (nt: string) => cores.some((c) => ` ${semPontuacao(nt)} `.includes(` ${c} `))
  const limpas: ImagemPlano[] = []
  for (const i of imagens) {
    const n = i.posicao
    const funcao = typeof i.funcao === 'string' ? i.funcao : ''
    if (typeof i.indisponivel === 'string' && i.indisponivel.trim() !== '') {
      limpas.push({ posicao: n, funcao, textos: [], prompt: '', indisponivel: i.indisponivel.trim() })
      continue
    }
    const textos = Array.isArray(i.textos) && i.textos.every((t) => typeof t === 'string') ? i.textos : null
    if (!textos || typeof i.prompt !== 'string' || i.prompt.trim() === '') { erros.push(`formato:${n}`); continue }
    limpas.push({ posicao: n, funcao, textos, prompt: i.prompt })
    if (ctx.moda && textos.length > 0) erros.push('moda_com_texto')
    else if (n === 1 && textos.length > 0) erros.push('capa_com_texto')
    if (textos.length > MAX_TEXTOS) erros.push(`textos_demais:${n}`)
    for (const t of textos) {
      if (t.length > MAX_CHARS) erros.push(`texto_longo:${n}`)
      if (termosProibidos(t, 'geral').length > 0) erros.push(`termo_proibido:${n}`)
      // Numeração de etapa ("1. MEÇA") só é ignorada de 1 até a quantidade de textos da imagem.
      const etapa = /^(\d)\.\s/.exec(t)
      const semEtapa = etapa && Number(etapa[1]) >= 1 && Number(etapa[1]) <= textos.length ? t.slice(etapa[0].length) : t
      if (numeros(semEtapa).some((x) => !dados.has(x))) erros.push(`numero_fora_dos_dados:${n}`)
      if (t.includes('{{COR}}') || temCor(norm(t))) erros.push(`cor_no_texto:${n}`)
      if (!i.prompt.includes(t)) erros.push(`texto_fora_do_prompt:${n}`)
    }
    // Todo trecho entre aspas duplas tem de ser um dos `textos` (sem textos, como a capa e Moda: nenhum).
    const pedidos = new Set(textos.map((t) => t.trim()))
    for (const m of i.prompt.matchAll(ASPAS)) {
      if (!pedidos.has((m[1] ?? m[2]).trim())) erros.push(`aspas_fora_dos_textos:${n}`)
    }
  }
  if (erros.length > 0) return { erros: [...new Set(erros)] }
  // Só os campos do formato: o que a IA mandar a mais não é gravado.
  const conflitos = Array.isArray(p.conflitos) ? p.conflitos.filter((c): c is string => typeof c === 'string') : []
  return {
    plano: {
      formato: 2, dados_hash: ctx.dadosHash, conflitos,
      paleta: { cor1: { nome: p.paleta.cor1.nome.trim(), hex: p.paleta.cor1.hex }, cor2: { nome: p.paleta.cor2.nome.trim(), hex: p.paleta.cor2.hex } },
      imagens: limpas.sort((a, b) => a.posicao - b.posicao),
    },
  }
}

export function montarPromptImagem(plano: Plano, posicao: number, cor: string): string {
  const i = plano.imagens.find((x) => x.posicao === posicao)
  if (!i) throw new Error(`posicao_inexistente:${posicao}`)
  const partes = [i.prompt.replaceAll('{{COR}}', cor), FIDELIDADE]
  if (i.textos.length > 0) partes.push(estilo(plano.paleta.cor1, plano.paleta.cor2))
  partes.push(BLOCO_TECNICO)
  return partes.join('\n\n')
}
