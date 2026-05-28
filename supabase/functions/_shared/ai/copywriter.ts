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
1. NUNCA invente ESPECIFICAÇÕES TÉCNICAS que não estão no input (composição, gramatura exata, dimensões, marca, certificações, normas ISO/INMETRO). Use APENAS o que está em "DESCRICAO_DETALHADO" para essas especificações.
2. Título: até 60 caracteres, frase comercial focada no produto. NUNCA mencione quantidade de cores nem use expressões como "Disponível em N cores", "N Cores Disponíveis" ou similares no título.
3. Descrição: use os dados de DESCRICAO_DETALHADO como verdade absoluta para especificações técnicas. Pode reorganizar, formatar em parágrafos e adicionar separadores.
4. SEMPRE inclua uma seção "Aplicações" ou "Para que serve" na descrição com 1-2 frases sobre o uso típico do tipo de aviamento (ex.: linha de costura serve para costura em geral, reparos, artesanato; fita de cetim serve para acabamento, embalagens, decoração; botão serve para fechamento de peças, customização). Essas aplicações genéricas SÃO PERMITIDAS por serem conhecimento de domínio público — só não invente specs técnicas.
5. Tom: profissional, direto, focado em utilidade do produto.
6. Liste APENAS os nomes das cores disponíveis em uma seção da descrição. NUNCA inclua códigos de produto, preços, estoques ou qualquer número ao lado das cores. Exemplo CORRETO: "- Preto" / "- Branco". Exemplo PROIBIDO: "- Preto (Código: 123) - R$ 5,00" ou "- Branco - R$ 5,85".`;

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
