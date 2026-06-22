// Sugestão de resposta a pergunta de comprador (ADR-0037). Revisão humana antes de enviar.
import { openrouterClient } from './client.ts';
import { MODELO_COPY } from './modelos.ts';

export interface InputSugestao {
  pergunta: string;
  itemTitulo: string | null;
  /** Contexto extra do anúncio (atributos, descrição), opcional. */
  contexto?: string | null;
}

const SYSTEM = [
  'Você é um vendedor profissional no Mercado Livre respondendo perguntas de compradores.',
  'Responda em português do Brasil, de forma cordial, objetiva e curta (1-3 frases).',
  'Use só informações do anúncio fornecido; se não souber, diga que vai verificar e peça um detalhe.',
  'Não invente prazos, preços, estoque ou características que não estejam no contexto.',
  'Não use saudações longas nem assinatura. Vá direto ao ponto.',
].join(' ');

/** Gera uma sugestão de resposta (texto puro). Lança em erro/timeout. */
export async function sugerirResposta(input: InputSugestao): Promise<string> {
  const user = [
    `Anúncio: ${input.itemTitulo ?? '(sem título)'}`,
    input.contexto ? `Contexto: ${input.contexto}` : '',
    `Pergunta do comprador: "${input.pergunta}"`,
    'Escreva apenas a resposta a enviar.',
  ].filter(Boolean).join('\n');

  const client = openrouterClient();
  const resp = await client.chat.completions.create(
    {
      model: MODELO_COPY,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      temperature: 0.5,
    },
    { signal: AbortSignal.timeout(30_000) },
  );
  const txt = resp.choices[0]?.message?.content?.trim();
  if (!txt) throw new Error('resposta vazia da IA');
  return txt;
}
