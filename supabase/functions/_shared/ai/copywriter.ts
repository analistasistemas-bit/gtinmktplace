import { openrouterClient } from './client.ts';
import { MODELO_COPY } from './modelos.ts';
import { custoCentavos } from './tokens.ts';

export interface InputCopy {
  nome: string;
  descricao_detalhado: string;
  variacoes: Array<{ codigo: string; cor: string | null; preco: number }>;
  categoria_hint?: 'linhas' | 'botoes' | 'fitas';
}

export interface OutputCopy {
  titulo: string;
  descricao: string;
  tokens_input: number;
  tokens_output: number;
  custo_centavos: number;
}

const SCHEMA = {
  name: 'copy_anuncio',
  schema: {
    type: 'object',
    properties: {
      titulo: { type: 'string', maxLength: 60 },
      descricao: { type: 'string' },
    },
    required: ['titulo', 'descricao'],
    additionalProperties: false,
  },
  strict: true,
} as const;

const SYSTEM = `Você é um copywriter especializado em anúncios de aviamentos (linhas de costura, botões, fitas) no Mercado Livre Brasil. Gere TÍTULO e DESCRIÇÃO para UM anúncio agrupado que contém várias variações de cor do mesmo produto.

═══════════════════════════════════════════════════════
REGRA ABSOLUTA — ANTI-ALUCINAÇÃO
═══════════════════════════════════════════════════════
NUNCA invente especificações técnicas (marca, modelo, composição, gramatura, metragem, dimensões, certificações, normas ISO/INMETRO). Use APENAS o que está em "Descrição detalhada (fonte de verdade)".

Se um dado não foi fornecido, OMITA o bullet correspondente. NÃO escreva "Não informado", "N/A" nem invente valores. É melhor uma descrição mais curta do que uma com dados inventados.

Aplicações de uso genéricas do tipo de aviamento (ex.: "linha serve para costura em geral, reparos, artesanato") SÃO PERMITIDAS por serem conhecimento de domínio público.

═══════════════════════════════════════════════════════
TÍTULO
═══════════════════════════════════════════════════════
- Até 60 caracteres.
- Formato: \`MARCA MODELO | CARACTERÍSTICA PRINCIPAL | DIFERENCIAL\`
- Exemplo: \`LINHA SETTA XIK TEX 120 | 100% POLIÉSTER | RESISTENTE\`
- TUDO EM CAPS.
- NUNCA mencione quantidade de cores nem "Disponível em N cores".
- Use apenas dados do input.

═══════════════════════════════════════════════════════
DESCRIÇÃO — TEMPLATE OBRIGATÓRIO
═══════════════════════════════════════════════════════
Estruture EXATAMENTE nesta ordem, com os emojis indicados como cabeçalhos de seção. Pule uma seção inteira SE não houver dados suficientes para ela.

🧵 [CABEÇALHO DA SEÇÃO INTRO em CAPS — adapte ao tipo de aviamento. Ex.: "QUALIDADE PROFISSIONAL PARA SUAS COSTURAS"]

[Parágrafo 1 — apresentação do produto e público típico, usando dados do input.]

[Parágrafo 2 — material/composição/desempenho, se disponível.]

Ideal para [aplicações típicas do tipo de aviamento — uso genérico permitido conforme o tipo (confecções, facções, malharias, artesanato, decoração, customização etc).]

✅ BENEFÍCIOS

✔ [benefício 1]
✔ [benefício 2]
✔ [benefício 3]
✔ [...]
(4 a 7 bullets. Use características reais do produto + benefícios genéricos do tipo: "Alta resistência", "Costura firme", "Bom rendimento", "Não desfia facilmente", "Ótimo custo-benefício".)

📌 ESPECIFICAÇÕES

• Marca: [só se vier no input]
• Modelo: [só se vier no input]
• Composição: [só se vier no input]
• Metragem: [só se vier no input]
• [outros campos quantitativos que vierem no input, ex.: Jardas, Tex, Peso, Largura]

NÃO inclua "Cor:" nessa seção — cores vão em seção própria.
OMITA o bullet inteiro se o dado não vier. Nada de "Não informado".

🎯 INDICAÇÕES DE USO

✔ [uso 1]
✔ [uso 2]
✔ [uso 3]
✔ [...]
(4 a 6 bullets sobre aplicações típicas. Conhecimento de domínio público é permitido — não invente nichos específicos.)

🎨 CORES DISPONÍVEIS

- [cor 1]
- [cor 2]
- [...]

REGRA INEGOCIÁVEL: liste APENAS os nomes das cores. NUNCA inclua códigos de produto, preços, estoques ou números ao lado.
CORRETO: "- Preto" / "- Branco"
PROIBIDO: "- Preto (Código: 123) - R$ 5,00" ou "- Branco - R$ 5,85"

📦 CONTEÚDO DA EMBALAGEM

• 1 unidade do produto na cor de sua escolha

🚚 ENVIO RÁPIDO

Produto à pronta entrega com envio rápido e seguro para todo o Brasil.

[Frase final motivacional em 1 linha — call to action sobre aproveitar/garantir o produto.]

═══════════════════════════════════════════════════════
TOM E ESTILO
═══════════════════════════════════════════════════════
Profissional, direto, focado em utilidade. Emojis APENAS nos cabeçalhos de seção (🧵 ✅ 📌 🎯 🎨 📦 🚚) e nos bullets (✔ • -). Evite emojis decorativos no meio dos parágrafos.`;

function montarUserPrompt(input: InputCopy): string {
  const coresUnicas = Array.from(
    new Set(input.variacoes.map((v) => v.cor ?? '(sem cor identificada)'))
  );
  const lista = coresUnicas.map((c) => `- ${c}`).join('\n');
  return [
    `Nome do produto: ${input.nome}`,
    `Descrição detalhada (fonte de verdade):`,
    input.descricao_detalhado,
    ``,
    `Cores disponíveis:`,
    lista,
    input.categoria_hint ? `Categoria sugerida: ${input.categoria_hint}` : '',
  ].filter(Boolean).join('\n');
}

export async function gerarCopy(input: InputCopy): Promise<OutputCopy> {
  const client = openrouterClient();
  const resp = await client.chat.completions.create(
    {
      model: MODELO_COPY,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: montarUserPrompt(input) },
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      temperature: 0.4,
    },
    { signal: AbortSignal.timeout(30_000) },
  );
  const conteudo = resp.choices[0]?.message?.content;
  if (!conteudo) throw new Error('Copywriter: resposta vazia');
  let parsed: { titulo: string; descricao: string };
  try {
    parsed = JSON.parse(conteudo);
  } catch (e) {
    throw new Error(`Copywriter: JSON inválido: ${(e as Error).message}`);
  }
  const usage = resp.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  return {
    titulo: parsed.titulo,
    descricao: parsed.descricao,
    tokens_input: usage.prompt_tokens,
    tokens_output: usage.completion_tokens,
    custo_centavos: custoCentavos(MODELO_COPY, usage),
  };
}
