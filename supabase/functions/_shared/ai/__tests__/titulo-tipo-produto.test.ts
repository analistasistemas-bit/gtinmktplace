import { describe, it, expect } from 'vitest';
import { garantirTipoProdutoTitulo } from '../titulo';

describe('garantirTipoProdutoTitulo', () => {
  it('prefixa o tipo quando ausente do título', () => {
    const r = garantirTipoProdutoTitulo('EUROROMA 4/6 600G 610MT | 85% ALGODÃO | ALTA RESISTÊNCIA', 'barbante');
    expect(r.startsWith('BARBANTE ')).toBe(true);
    expect(r.length).toBeLessThanOrEqual(60);
  });

  it('não duplica quando o tipo já está no título', () => {
    const r = garantirTipoProdutoTitulo('BAINHA INSTANTÂNEA 4MT UND | RESISTENTE', 'bainha instantânea');
    expect(r).toBe('BAINHA INSTANTÂNEA 4MT UND | RESISTENTE');
  });

  it('tipoProdutoBusca vazio → título intacto', () => {
    expect(garantirTipoProdutoTitulo('X | Y', '')).toBe('X | Y');
  });

  it('corta o diferencial antes do texto-base para caber em 60 chars', () => {
    const r = garantirTipoProdutoTitulo('EUROROMA 4/6 600G 610MT NOVELO PREMIUM | 85% ALGODÃO RECICLADO | ALTA RESISTÊNCIA E DURABILIDADE', 'barbante de crochê');
    expect(r.length).toBeLessThanOrEqual(60);
    expect(r.startsWith('BARBANTE DE CROCHÊ')).toBe(true);
  });

  it('BUG a evitar: tipoProdutoBusca sem palavra >=3 letras não duplica (não prefixa às cegas)', () => {
    const r = garantirTipoProdutoTitulo('FIO DE COSTURA 100M', 'e a');
    expect(r).toBe('FIO DE COSTURA 100M');
  });

  it('tipo com palavra curta real (3 letras) já presente no título não duplica', () => {
    const r = garantirTipoProdutoTitulo('FIO DE COSTURA 100M | RESISTENTE', 'fio de bordar');
    expect(r).toBe('FIO DE COSTURA 100M | RESISTENTE');
  });
});
