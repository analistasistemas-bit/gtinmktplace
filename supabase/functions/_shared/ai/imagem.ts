// ADR-0197 (Task 15): foto da combinação do kit com variação por IA. Teste real de 07/11: o pedido que descreve a
// construção da peça manteve a modelagem (gola, barra e punhos) no Nano Banana 2.1. Aqui a descrição vem de uma
// leitura por visão das fotos de origem, nunca do cliente. Nada aqui grava ou publica: é a edge `gerar-foto-kit`.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { openrouterClient } from './client.ts';
import { MODELO_VISION } from './modelos.ts';
import { PRECOS } from './tokens.ts';

/** Padrão decidido pelo Diego em 07/11. Igual ao primeiro de `src/lib/ai-modelos.ts::MODELOS_IMAGEM`. */
export const MODELO_IMAGEM_PADRAO = 'google/gemini-nano-banana-2.1';

/** Modelo de imagem da org (`configuracoes.ai_model_imagem`); sem escolha, sem preço ou erro de leitura → padrão. */
export async function resolverModeloImagem(admin: SupabaseClient, orgId: string): Promise<string> {
  try {
    const { data } = await admin.from('configuracoes').select('ai_model_imagem').eq('org_id', orgId).maybeSingle();
    const m = data?.ai_model_imagem as string | null | undefined;
    return m && PRECOS[m] ? m : MODELO_IMAGEM_PADRAO;
  } catch {
    return MODELO_IMAGEM_PADRAO;
  }
}

const PEDIDO_DESCRICAO = 'These photos show the same product in different colors. In English, in up to 80 words, '
  + 'describe only how the product is built, so an image model can reproduce it exactly: type of product, length and '
  + 'cut, collar or neckline, sleeves, cuffs, hem, closures, fabric thickness and texture, distinctive details. Ignore '
  + 'colors, background, people, mannequins and any text. Answer with the description only.';

/** Pedido de imagem: a descrição da peça vai junto, senão o modelo muda a modelagem (teste de 07/11). */
export function montarPedidoImagem(p: { cores: string[]; descricao: string }): string {
  const n = p.cores.length;
  return `Using the reference photos (one per color, in this order: ${p.cores.join(', ')}), create ONE e-commerce `
    + `product photo of a ${n}-piece kit: exactly ${n} pieces of this same product, one in each of these colors: `
    + `${p.cores.join(', ')}. Laid flat side by side, no person, no mannequin. Preserve the product exactly as in the `
    + `photos and as described: ${p.descricao.trim()} Keep the exact colors of the reference photos. Plain white `
    + `background, soft studio light, all ${n} pieces fully visible and centered, vertical portrait framing. `
    + 'No text, no logos, no labels, no watermark, no extra items.';
}

interface UsoProvedor { prompt_tokens?: number; completion_tokens?: number; cost?: number }

/** Custo real do OpenRouter (`usage.cost`, US$); sem ele, estimativa por PRECOS. */
export function custoImagemUsd(modelo: string, usage: UsoProvedor | undefined): number {
  if (typeof usage?.cost === 'number' && usage.cost > 0) return usage.cost;
  const p = PRECOS[modelo];
  if (!p || !usage) return 0;
  return ((usage.prompt_tokens ?? 0) / 1000) * p.input + ((usage.completion_tokens ?? 0) / 1000) * p.output;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp' };

/** Imagem da resposta do OpenRouter (`message.images[0].image_url.url`, data URL). Sem imagem, lança. */
export function extrairImagem(resp: unknown): { bytes: Uint8Array; mime: string; ext: string } {
  // deno-lint-ignore no-explicit-any
  const url = (resp as any)?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  const m = typeof url === 'string' ? /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(url) : null;
  if (!m || !EXT[m[1]]) throw new Error('resposta da IA sem imagem');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: m[1], ext: EXT[m[1]] };
}

/** Largura e altura de PNG ou JPEG pelo cabeçalho; outro formato → null. */
export function dimensoesImagem(b: Uint8Array): { largura: number; altura: number } | null {
  const u32 = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { largura: u32(16), altura: u32(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length && b[i] === 0xff) {
      const marca = b[i + 1];
      const tam = (b[i + 2] << 8) | b[i + 3];
      // SOF0..SOF15, menos DHT (C4), JPG (C8) e DAC (CC).
      if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
        return { altura: (b[i + 5] << 8) | b[i + 6], largura: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + tam;
    }
  }
  return null;
}

/** ML: foto vertical ou quadrada, lado menor ≥ 500 px (mínimo da plataforma). */
export function adequadaAoML(d: { largura: number; altura: number } | null): boolean {
  return !!d && d.altura >= d.largura && Math.min(d.largura, d.altura) >= 500;
}

/** Descrição da construção da peça, lida por visão das fotos de origem (data URLs). */
export async function descreverPeca(fotos: string[]): Promise<{ texto: string; custoUsd: number }> {
  const resp = await openrouterClient().chat.completions.create({
    model: MODELO_VISION,
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: PEDIDO_DESCRICAO }, ...fotos.map((url) => ({ type: 'image_url', image_url: { url } }))],
    }],
    max_tokens: 200,
    temperature: 0,
    usage: { include: true },
    // deno-lint-ignore no-explicit-any
  } as any, { signal: AbortSignal.timeout(45_000) });
  // deno-lint-ignore no-explicit-any
  const r = resp as any;
  const texto = String(r.choices?.[0]?.message?.content ?? '').trim();
  if (!texto) throw new Error('visão sem descrição');
  return { texto, custoUsd: custoImagemUsd(MODELO_VISION, r.usage) };
}

/** Gera a foto do kit. Lança em falha do provedor ou resposta sem imagem (nada a cobrar). */
export async function gerarImagem(modelo: string, pedido: string, fotos: string[]) {
  const resp = await openrouterClient().chat.completions.create({
    model: modelo,
    modalities: ['image', 'text'],
    // Vertical, como no teste de 07/11 (896×1200). O ML aceita vertical ou quadrada.
    image_config: { aspect_ratio: '3:4' },
    usage: { include: true },
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: pedido }, ...fotos.map((url) => ({ type: 'image_url', image_url: { url } }))],
    }],
    // deno-lint-ignore no-explicit-any
  } as any, { signal: AbortSignal.timeout(120_000) });
  // deno-lint-ignore no-explicit-any
  const usage = (resp as any).usage as UsoProvedor | undefined;
  return { ...extrairImagem(resp), custoUsd: custoImagemUsd(modelo, usage) };
}
