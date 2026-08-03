import { describe, it, expect } from 'vitest';
import { aplicarGuardsTitulo, normalizarSlots, validarSlotsAncorados, type DadosFonteTitulo } from '../titulo-guards';
import { SLOTS_VAZIOS, type TituloSlots } from '../titulo-slots';

const slots = (p: Partial<TituloSlots>): TituloSlots => ({ ...SLOTS_VAZIOS, ...p });
const fonte = (p: Partial<DadosFonteTitulo>): DadosFonteTitulo => ({
  nomePai: '', descricaoPai: '', tipoProdutoBusca: '', cores: [], fornecedor: null, ...p,
});

describe('normalizarSlots', () => {
  it('expande abreviação de planilha', () => {
    const s = normalizarSlots(slots({ produto: 'COLCHETE C/GANCHO', compatibilidade: 'P/ZIPER DE NYLON' }));
    expect(s.produto).toBe('COLCHETE COM GANCHO');
    expect(s.compatibilidade).toBe('PARA ZIPER DE NYLON');
  });

  it('descarta ruído de planilha sem valor de busca', () => {
    expect(normalizarSlots(slots({ modelo: 'TAM UND' })).modelo).toBe('');
    expect(normalizarSlots(slots({ modelo: 'TAM VR' })).modelo).toBe('');
    expect(normalizarSlots(slots({ variacao: 'CORES' })).variacao).toBe('');
  });

  it('remove código interno de estoque', () => {
    expect(normalizarSlots(slots({ modelo: 'T-007' })).modelo).toBe('');
    expect(normalizarSlots(slots({ modelo: 'BAR-03-VR' })).modelo).toBe('');
  });

  it('preserva numeração que o consumidor usa', () => {
    expect(normalizarSlots(slots({ modelo: 'N.3' })).modelo).toBe('N.3');
    expect(normalizarSlots(slots({ modelo: '4/6' })).modelo).toBe('4/6');
    expect(normalizarSlots(slots({ modelo: 'TEX 29' })).modelo).toBe('TEX 29');
  });

  it('colapsa espaço e apara', () => {
    expect(normalizarSlots(slots({ produto: '  NOVELO   LINHA  ' })).produto).toBe('NOVELO LINHA');
  });
});

describe('aplicarGuardsTitulo', () => {
  it('crava a metragem do nome quando a IA a omitiu', () => {
    const s = aplicarGuardsTitulo(slots({ produto: 'FITA CETIM' }), fonte({ nomePai: 'FITA CETIM N.3 100MT' }));
    expect(s.medida).toContain('100m');
  });

  it('corrige metragem arredondada pela IA', () => {
    const s = aplicarGuardsTitulo(slots({ produto: 'BORDADO', medida: '13,7m' }), fonte({ nomePai: 'BORDADO C/13,71MT' }));
    expect(s.medida).toContain('13,71m');
    expect(s.medida).not.toContain('13,7m ');
  });

  it('preserva dimensão composta quando a IA a traz SOZINHA', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'SACO DE ORGANZA', medida: '10X15CM' }),
      fonte({ nomePai: 'SACO DE ORGANZA 10X15CM CORES C/10UND', descricaoPai: 'LARGURA: 10CM.' }),
    );
    expect(s.medida).toContain('10X15CM');
  });

  it('preserva dimensão composta quando a IA a traz JUNTO com a metragem — o caso que se perdia', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'FITA', medida: '10X20CM 50m' }),
      fonte({ nomePai: 'FITA 10X20CM C/50MT' }),
    );
    expect(s.medida).toContain('10X20CM');
    expect(s.medida).toContain('50m');
  });

  it('não duplica a medida que a dimensão composta já expressa (Tecido Helanca real)', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'TECIDO HELANCA LIGHT', medida: '3,00 X 1,80' }),
      fonte({ nomePai: 'Tecido Helanca Light  Lycra Tensionada 3,00 X 1,80 Metros' }),
    );
    expect(s.medida).toContain('3,00 X 1,80');
    expect(s.medida.match(/1,80/g)).toHaveLength(1);
  });

  it('não confunde a inicial de "Metros" por extenso com unidade da dimensão', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'TECIDO HELANCA LIGHT', medida: '3,00 X 1,80 Metros' }),
      fonte({ nomePai: 'Tecido Helanca Light  Lycra Tensionada 3,00 X 1,80 Metros' }),
    );
    expect(s.medida).not.toMatch(/\bM$/);
    expect(s.medida).toContain('3,00 X 1,80');
  });

  it('acrescenta a largura grounded à medida', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'LANTEJOULA', medida: '50m' }),
      fonte({ nomePai: 'LANTEJOULAS C/50MT', descricaoPai: 'LARGURA: 6MM.' }),
    );
    expect(s.medida).toContain('6mm');
  });

  it('crava a quantidade grounded', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'SACO DE ORGANZA' }),
      fonte({ nomePai: 'SACO DE ORGANZA 10X15CM CORES C/10UND' }),
    );
    expect(s.quantidade).toBe('10un');
  });

  it('crava a cor no slot variacao quando há exatamente uma', () => {
    const s = aplicarGuardsTitulo(slots({ produto: 'FITA' }), fonte({ cores: ['Branco'] }));
    expect(s.variacao).toBe('Branco');
  });

  it('não crava cor quando há várias (o comprador escolhe)', () => {
    const s = aplicarGuardsTitulo(slots({ produto: 'FITA', variacao: 'AZUL' }), fonte({ cores: ['Branco', 'Preto'] }));
    expect(s.variacao).toBe('');
  });

  it('crava o tipo de produto quando o nome não diz o que o produto é', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'EUROROMA 4/6' }),
      fonte({ nomePai: 'EUROROMA 4/6 CORES 600G', descricaoPai: 'BARBANTE PARA CROCHE', tipoProdutoBusca: 'barbante' }),
    );
    expect(s.produto.toUpperCase()).toContain('BARBANTE');
  });

  it('usa o mapa para corrigir a grafia da marca', () => {
    const s = aplicarGuardsTitulo(
      slots({ produto: 'FITA CETIM', marca: 'BUFALO' }),
      fonte({ nomePai: 'FITA CETIM BUFALO N.3', fornecedor: 'BUFALO' }),
    );
    expect(s.marca).toBe('Búfalo');
  });
});

describe('validarSlotsAncorados', () => {
  it('remove marca que não aparece na fonte', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'FITA', marca: 'Detallia' }),
      fonte({ nomePai: 'FITAS DE VELUDO 20MM CORES', descricaoPai: 'FITA DE VELUDO.' }),
    );
    expect(s.marca).toBe('');
  });

  it('mantém marca ancorada, ignorando acento na comparação', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'FITA', marca: 'Búfalo' }),
      fonte({ nomePai: 'FITA CETIM BUFALO N.3', descricaoPai: '' }),
    );
    expect(s.marca).toBe('Búfalo');
  });

  it('NUNCA deixa nome da loja passar como marca', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'FITA', marca: 'Avil' }),
      fonte({ nomePai: 'FITA AVIL', descricaoPai: 'PRODUTO AVIL' }),
    );
    expect(s.marca).toBe('');
  });

  it('remove adjetivo vazio de qualquer slot', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'FITA', aplicacao: 'ALTA RESISTENCIA', sinonimo: 'QUALIDADE PREMIUM' }),
      fonte({ nomePai: 'FITA', descricaoPai: 'FITA DE CETIM.' }),
    );
    expect(s.aplicacao).toBe('');
    expect(s.sinonimo).toBe('');
  });

  it('remove sinônimo que não está na fonte', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'BARBANTE', sinonimo: 'CORDAO' }),
      fonte({ nomePai: 'BARBANTE EUROROMA', descricaoPai: 'BARBANTE PARA CROCHE.' }),
    );
    expect(s.sinonimo).toBe('');
  });

  it('mantém sinônimo presente na fonte', () => {
    const s = validarSlotsAncorados(
      slots({ produto: 'TECIDO HELANCA', sinonimo: 'HELANQUINHA' }),
      fonte({ nomePai: 'TECIDO HELANCA LIGHT', descricaoPai: 'CONHECIDO COMO HELANQUINHA.' }),
    );
    expect(s.sinonimo).toBe('HELANQUINHA');
  });
});
