// Corpo da chamada ao OpenRouter com formato e tamanho no corpo (o `gerarImagem` de _shared/ai/imagem.ts fixa 1:1). Puro.

/** Corpo do chat.completions do OpenRouter: formato da imagem no corpo (padrão 3:4), custo na resposta (`usage.cost`). */
export function corpoOpenRouter(
  modelo: string, prompt: string, referencias: string[], imagem: { aspecto: string; tamanho?: string } = { aspecto: '3:4' },
): Record<string, unknown> {
  return {
    model: modelo,
    modalities: ['image', 'text'],
    image_config: { aspect_ratio: imagem.aspecto, ...(imagem.tamanho ? { image_size: imagem.tamanho } : {}) },
    usage: { include: true },
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: prompt }, ...referencias.map((url) => ({ type: 'image_url', image_url: { url } }))],
    }],
  };
}
