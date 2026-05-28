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

const SYSTEM = `Você é um copywriter especializado em anúncios de aviamentos (linhas de costura, botões, fitas) no Mercado Livre Brasil. Sua tarefa: gerar título e descrição para UM anúncio agrupado que contém várias variações de cor do mesmo produto.

REGRAS INEGOCIÁVEIS:
1. NUNCA invente especificações que não estão no input (composição, gramatura, dimensões, marca, certificações). Use APENAS o que está em "DESCRICAO_DETALHADO".
2. Título: até 60 caracteres, frase comercial, idealmente menciona a quantidade de cores disponíveis no final.
3. Descrição: use os dados de DESCRICAO_DETALHADO como verdade absoluta. Pode reorganizar, formatar em parágrafos, adicionar separadores, mas NÃO acrescentar informações novas.
4. Tom: profissional, direto, focado em utilidade do produto.
5. Liste as cores disponíveis em uma seção da descrição.`;

function montarUserPrompt(input: InputCopy): string {
  const lista = input.variacoes
    .map((v) => `- ${v.codigo}: ${v.cor ?? '(sem cor)'} — R$ ${v.preco.toFixed(2)}`)
    .join('\n');
  return [
    `Nome do produto: ${input.nome}`,
    `Descrição detalhada (fonte de verdade):`,
    input.descricao_detalhado,
    ``,
    `Variações disponíveis (${input.variacoes.length} cores):`,
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
