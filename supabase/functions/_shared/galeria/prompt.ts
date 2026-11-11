// Prompt da cena (R3 contrato em todo prompt, R5.2 capa, R5.4 bloco técnico, R6.3 cena sem texto, ADR §11 Moda) e
// corpo da chamada ao OpenRouter com 3:4 (o `gerarImagem` de _shared/ai/imagem.ts fixa 1:1). Puro.
import { BLOCO_TECNICO, missoesDisponiveis } from './regras.ts';
import type { MissaoRoteiro, Roteiro } from './roteiro.ts';

/** Área reservada ao texto que o PubliAI compõe depois (descrição para o gerador; vem de `layout-area.ts`). */
export interface LayoutCena { areaTexto: string }

const NOMES = new Map(
  [false, true].map((moda) => [moda, new Map(missoesDisponiveis(moda, ['frente', 'costas', 'lateral']).map((m) => [m.missao, m.nome]))]),
);

/**
 * Nunca leva o texto do roteiro (headline, benefícios…): o gerador faz só a cena (R6.3). Fora de Moda e fora da capa
 * pede a área do layout limpa; em Moda nenhuma imagem leva texto. Termina literalmente com o BLOCO_TECNICO.
 */
export function montarPromptCena(m: MissaoRoteiro, r: Roteiro, moda: boolean, cor: string, layout: LayoutCena | null): string {
  const capa = m.missao === 1;
  return [
    `Product photo for a marketplace listing. Image ${m.missao}: ${NOMES.get(moda)!.get(m.missao) ?? ''}.`,
    `Scene: ${m.cena}`,
    `Identity contract (respect it exactly): ${r.contrato}`,
    `Color variant: ${cor}. Reproduce exactly the color of the reference photo.`,
    'The reference photo is the only source of the product: keep shape, proportions, color, packaging, label, logo, '
      + 'texture, quantity, components and scale. Show only views the reference supports.',
    capa
      ? 'Isolated product on a pure white #FFFFFF background, real proportions, discreet shadow, product filling about '
        + '85% of the frame; keep the real packaging printing legible.'
      : null,
    'Do not add any text, letters, numbers, badges or marketing copy; only printing that exists on the real product may appear.',
    !moda && !capa && layout ? `Keep ${layout.areaTexto} clean and free of objects.` : null,
    'Vertical 3:4 composition.',
    BLOCO_TECNICO,
  ].filter((l): l is string => !!l).join('\n');
}

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
