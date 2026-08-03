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

  it('valida a ancoragem DEPOIS de cravar — marca do mapa sem menção na fonte não vaza', () => {
    // A ordem é o desenho: aplicarGuardsTitulo escreve a marca do mapa (grafia), e só então
    // validarSlotsAncorados a derruba por falta de respaldo na fonte. Invertida, a marca vaza.
    const t = posProcessarTitulo(
      slots({ produto: 'LINHA', material: '100% ALGODAO' }),
      fonte({ nomePai: 'LINHA CONES CORES', descricaoPai: 'LINHA PARA COSTURA.', fornecedor: 'CIRCULO S.A.' }),
    );
    expect(t).not.toContain('Círculo');
    expect(t).toContain('Linha');
  });

  it('cor única vira discriminador protegido; várias cores não', () => {
    const base = {
      produto: 'LINHA ESPECIAL PARA RENASCENCA BORDADA MANUAL',
      material: '100% ALGODAO MERCERIZADO',
    };
    const fonteBase = {
      nomePai: 'LINHA ESP. P/RENASCENCA BORDADA MANUAL C/10UND',
      descricaoPai: 'LINHA 100% ALGODAO MERCERIZADO PARA BORDADO A MAO.',
    };
    const umaCor = posProcessarTitulo(slots(base), fonte({ ...fonteBase, cores: ['Bege Clarinho'] }));
    const variasCores = posProcessarTitulo(slots(base), fonte({ ...fonteBase, cores: ['Bege', 'Branco'] }));

    expect(umaCor).toContain('Bege Clarinho');   // protegida do corte
    expect(variasCores).not.toContain('Bege');   // nem entra: o comprador escolhe
    expect(umaCor).not.toBe(variasCores);
  });

  it('nenhum pipe sobrevive ao pipeline, venha de onde vier', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'FITA | CETIM', material: '100% POLIESTER' }),
      fonte({ nomePai: 'FITA CETIM 10MT', descricaoPai: '100% POLIESTER.' }),
    );
    expect(t).not.toContain('|');
  });

  it('cor indefinida não vira discriminador nem aparece no título', () => {
    const t = posProcessarTitulo(
      slots({ produto: 'COLA LIQUIDA SILICONE', medida: '100ml' }),
      fonte({ nomePai: 'COLA LIQUIDA SILICONE 100ML', descricaoPai: 'COLA DE SILICONE.', cores: ['Outra'] }),
    );
    expect(t).not.toContain('Outra');
  });
});
