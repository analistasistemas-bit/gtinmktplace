import { openrouterClient } from './client.ts';
import { MODELO_VISION } from './modelos.ts';
import { custoCentavos } from './tokens.ts';

const CORES_VALIDAS = new Set([
  'Preto', 'Branco', 'Vermelho', 'Azul Royal', 'Azul Marinho', 'Azul Claro',
  'Verde Bandeira', 'Verde Musgo', 'Verde Claro', 'Amarelo', 'Laranja',
  'Rosa', 'Pink', 'Roxo', 'Marrom', 'Bege', 'Cru', 'Cinza', 'Prata',
  'Dourado', 'Rosa Neon', 'Verde Neon', 'Outra',
]);

const PROMPT = `Você é um identificador de cor de produto. Recebe a foto de um produto têxtil (linha de costura, botão, fita ou similar).

Responda APENAS com o nome da cor predominante, em português, escolhendo entre estas opções canônicas:
[Preto, Branco, Vermelho, Azul Royal, Azul Marinho, Azul Claro, Verde Bandeira, Verde Musgo, Verde Claro, Amarelo, Laranja, Rosa, Pink, Roxo, Marrom, Bege, Cru, Cinza, Prata, Dourado, Rosa Neon, Verde Neon, Outra]

Se não conseguir identificar, responda "Outra".
Não explique, não adicione contexto, devolva apenas o nome da cor.`;

export interface ResultadoVision {
  cor: string;
  custo_centavos: number;
  tokens_input: number;
  tokens_output: number;
}

export async function extrairCorPorVision(imagemUrl: string): Promise<ResultadoVision> {
  const client = openrouterClient();
  const resp = await client.chat.completions.create(
    {
      model: MODELO_VISION,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: imagemUrl, detail: 'low' } },
          ],
        },
      ],
      max_tokens: 10,
      temperature: 0,
    },
    { signal: AbortSignal.timeout(30_000) },
  );
  const bruto = (resp.choices[0]?.message?.content ?? '').trim();
  const cor = CORES_VALIDAS.has(bruto) ? bruto : 'Outra';
  const usage = resp.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  return {
    cor,
    tokens_input: usage.prompt_tokens,
    tokens_output: usage.completion_tokens,
    custo_centavos: custoCentavos(MODELO_VISION, usage),
  };
}
