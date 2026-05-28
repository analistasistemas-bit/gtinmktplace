import OpenAI from 'npm:openai@^4';

let cached: OpenAI | null = null;

export function openrouterClient(): OpenAI {
  if (cached) return cached;
  cached = new OpenAI({
    apiKey: Deno.env.get('OPENROUTER_API_KEY')!,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': Deno.env.get('PUBLIAI_PUBLIC_URL') ?? 'https://ean2marketplace-frontend.onrender.com',
      'X-Title': 'PubliAI',
    },
  });
  return cached;
}
