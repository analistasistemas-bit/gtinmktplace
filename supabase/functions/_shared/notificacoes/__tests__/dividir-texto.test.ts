import { afterEach, describe, expect, it, vi } from 'vitest';
import { dividirTexto, enviarTelegram, LIMITE_TELEGRAM } from '../telegram.ts';

describe('dividirTexto (limite de 4096 do sendMessage)', () => {
  it('texto no limite sai inteiro', () => {
    const t = 'x'.repeat(LIMITE_TELEGRAM);
    expect(dividirTexto(t)).toEqual([t]);
  });

  it('quebra entre blocos, na ordem, sem perder conteúdo', () => {
    const blocos = Array.from({ length: 30 }, (_, i) => `• Item ${i}\nMotivo: ${'m'.repeat(150)}`);
    const texto = ['🚫 30 anúncios moderados', ...blocos].join('\n\n');
    const partes = dividirTexto(texto);
    expect(partes.length).toBeGreaterThan(1);
    for (const p of partes) expect(p.length).toBeLessThanOrEqual(LIMITE_TELEGRAM);
    expect(partes.join('\n\n')).toBe(texto);
    // Nenhum bloco partido ao meio.
    for (const p of partes) expect(p.split('\n\n').every((b) => b === '🚫 30 anúncios moderados' || blocos.includes(b))).toBe(true);
  });

  it('bloco maior que o limite quebra entre linhas', () => {
    const linhas = Array.from({ length: 100 }, (_, i) => `• linha ${i} ${'y'.repeat(60)}`);
    const texto = linhas.join('\n');
    const partes = dividirTexto(texto);
    for (const p of partes) expect(p.length).toBeLessThanOrEqual(LIMITE_TELEGRAM);
    expect(partes.join('\n')).toBe(texto);
  });

  it('linha gigante é cortada sem partir emoji (par substituto)', () => {
    const texto = 'a'.repeat(LIMITE_TELEGRAM - 1) + '📦' + 'b'.repeat(10);
    const partes = dividirTexto(texto);
    expect(partes.join('')).toBe(texto);
    expect(partes[0].length).toBe(LIMITE_TELEGRAM - 1);
    expect(partes[1].startsWith('📦')).toBe(true);
  });

  it.each(['👩‍💻', '👍🏽', '🇧🇷'])('linha gigante não separa o emoji composto %s', (emoji) => {
    const texto = 'a'.repeat(LIMITE_TELEGRAM - 2) + emoji + 'b';
    const partes = dividirTexto(texto);
    expect(partes.join('')).toBe(texto);
    for (const p of partes) expect(p.length).toBeLessThanOrEqual(LIMITE_TELEGRAM);
    expect(partes[1].startsWith(emoji)).toBe(true);
  });
});

describe('enviarTelegram com texto longo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('envia as partes na ordem e para na primeira falha', async () => {
    const enviados: string[] = [];
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      enviados.push(JSON.parse(init.body).text);
      return new Response('{}', { status: ++n === 2 ? 429 : 200 });
    }));
    const texto = ['A'.repeat(3000), 'B'.repeat(3000), 'C'.repeat(3000)].join('\n\n');
    expect(await enviarTelegram('t', '1', texto)).toBe(false);
    expect(enviados).toEqual(['A'.repeat(3000), 'B'.repeat(3000)]);
  });

  it('texto curto continua numa chamada só', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await enviarTelegram('t', '1', 'oi')).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
