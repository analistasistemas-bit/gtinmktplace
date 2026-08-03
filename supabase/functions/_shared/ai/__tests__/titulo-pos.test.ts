import { describe, it, expect } from 'vitest';
import { posProcessarTitulo } from '../titulo-pos';
import { type DadosFonteTitulo } from '../titulo-guards';
import { SLOTS_VAZIOS, type TituloSlots } from '../titulo-slots';

const slots = (p: Partial<TituloSlots>): TituloSlots => ({ ...SLOTS_VAZIOS, ...p });
const fonte = (p: Partial<DadosFonteTitulo>): DadosFonteTitulo => ({
  nomePai: '', descricaoPai: '', tipoProdutoBusca: '', cores: [], fornecedor: null, ...p,
});

describe('posProcessarTitulo', () => {
  it('produz título no padrão ML, sem pipe e com unidade canônica', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'FITA CETIM', marca: 'BUFALO', modelo: 'N.3', material: '100% POLIESTER' }),
      fonte({ nomePai: 'FITA CETIM BUFALO N.3 16MM CORES 10MT', descricaoPai: 'LARGURA: 16MM. 100% POLIESTER.', fornecedor: 'BUFALO' }),
    );
    expect(t).not.toContain('|');
    expect(t).toContain('10m');
    expect(t).toContain('Búfalo');
    expect(t.length).toBeLessThanOrEqual(60);
  });

  it('é IDEMPOTENTE — mesma entrada, mesmo título, qualquer número de execuções', () => {
    const s = slots({ produto: 'LANTEJOULA', marca: 'BUFALO', material: 'PVC' });
    const f = fonte({ nomePai: 'LANTEJOULAS TAM 8 CORES C/50MT', descricaoPai: 'LANTEJOULA BÚFALO. LARGURA: 8MM.', fornecedor: 'BUFALO', cores: ['Prata'] });
    const um = posProcessarTitulo(s, f);
    const dois = posProcessarTitulo(s, f);
    const tres = posProcessarTitulo(s, f);
    expect(dois).toBe(um);
    expect(tres).toBe(um);
  });

  it('remove o adjetivo vazio que a IA insistiu em mandar', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'FITA VELUDO', material: '100% POLIESTER', aplicacao: 'ALTA RESISTENCIA' }),
      fonte({ nomePai: 'FITAS VELUDO 16MM CORES C/25MTS', descricaoPai: '100% POLIESTER.' }),
    );
    expect(t.toLowerCase()).not.toContain('resist');
  });

  it('nunca deixa nome da loja virar marca', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'FITA', marca: 'AVIL' }),
      fonte({ nomePai: 'FITA AVIL 10MT', descricaoPai: 'PRODUTO AVIL.', fornecedor: 'AVIL' }),
    );
    expect(t).not.toContain('Avil');
  });

  it('preserva a cor como discriminador quando a família é mono-cor', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'LINHA ESPECIAL PARA RENASCENCA', marca: 'CIRCULO', material: '100% ALGODAO' }),
      fonte({ nomePai: 'LINHA ESP. P/RENASCENCA COR BEGE C/10UND', descricaoPai: 'LINHA CÍRCULO 100% ALGODÃO.', fornecedor: 'CIRCULO S.A.', cores: ['Bege'] }),
    );
    expect(t).toContain('Bege');
    expect(t.length).toBeLessThanOrEqual(60);
  });
});
