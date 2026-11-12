import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/edge-erro', () => ({ corpoDoErroDaEdge: vi.fn() }));

const { MENSAGEM_GENERICA, mensagemErro } = await import('../api');

describe('mensagemErro', () => {
  it.each([
    ['roteiro_trocado', 'Os dados do anúncio mudaram enquanto a imagem era gerada. Gere de novo.'],
    ['queda_repetida', 'A geração caiu duas vezes. Tente de novo.'],
    ['cena_inutil', 'O gerador devolveu uma imagem inválida. Tente de novo.'],
    ['provedor_indisponivel', 'O gerador de imagens está fora do ar. Tente de novo em instantes.'],
    ['prazo_esgotado', 'A geração demorou demais. Tente de novo.'],
    ['roteiro_nao_aprovado', 'Estas imagens são de uma versão anterior. Gere e aprove de novo.'],
  ])('%s → %s', (codigo, texto) => {
    expect(mensagemErro(codigo)).toBe(texto);
  });

  it('provedor_* fora do mapa usa a mensagem de provedor_indisponivel', () => {
    const fora = 'O gerador de imagens está fora do ar. Tente de novo em instantes.';
    expect(mensagemErro('provedor_400')).toBe(fora);
    expect(mensagemErro('provedor_falhou')).toBe(fora);
  });

  it('código desconhecido → genérica', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mensagemErro('xyz')).toBe(MENSAGEM_GENERICA);
  });
});
