import { describe, it, expect } from 'vitest';
import { montarTitulo, TituloInviavelError } from '../titulo-montar';
import { SLOTS_VAZIOS, type TituloSlots } from '../titulo-slots';

const slots = (p: Partial<TituloSlots>): TituloSlots => ({ ...SLOTS_VAZIOS, ...p });
const semDiscriminador = { variacaoDiscrimina: false };
const comDiscriminador = { variacaoDiscrimina: true };

describe('montarTitulo — montagem', () => {
  it('junta na ordem de leitura, com um espaço', () => {
    const t = montarTitulo(slots({
      produto: 'BARBANTE', marca: 'BANDEIRANTE', modelo: '4/6',
      medida: '570m', material: '85% ALGODAO',
    }), semDiscriminador);
    expect(t).toBe('Barbante Bandeirante 4/6 570m 85% Algodao');
  });

  it('ignora slots vazios sem deixar espaço duplo', () => {
    const t = montarTitulo(slots({ produto: 'AGULHA DE CROCHE', medida: '3,5mm' }), semDiscriminador);
    expect(t).toBe('Agulha de Croche 3,5mm');
    expect(t).not.toMatch(/\s{2}/);
  });

  it('nunca emite pipe', () => {
    const t = montarTitulo(slots({ produto: 'FITA', material: '100% POLIESTER' }), semDiscriminador);
    expect(t).not.toContain('|');
  });
});

describe('montarTitulo — corte por prioridade', () => {
  it('remove o slot de menor prioridade primeiro', () => {
    const t = montarTitulo(slots({
      produto: 'TECIDO HELANCA LIGHT', medida: '10m', material: 'POLIESTER',
      variacao: 'PRETO', aplicacao: 'PARA FORRO', sinonimo: 'HELANQUINHA',
    }), semDiscriminador);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).not.toContain('Helanquinha'); // sinonimo sai antes de aplicacao
  });

  it('nunca trunca um token no meio', () => {
    const t = montarTitulo(slots({
      produto: 'BORDADO INGLES EM PECA REFERENCIA CORES',
      marca: 'BUFALO', medida: '13,71m', variacao: 'BRANCO', aplicacao: 'PARA ACABAMENTO',
    }), semDiscriminador);
    for (const token of t.split(' ')) {
      // 'em' minúsculo, não 'Em': é átona e não abre o título (tituloCase). Fixture original do
      // brief tinha 'Em' — defeito no fixture, não na implementação (ver task-5-report.md).
      expect(['Bordado', 'Ingles', 'em', 'Peca', 'Referencia', 'Cores', 'Bufalo',
              '13,71m', 'Branco', 'para', 'Acabamento']).toContain(token);
    }
  });

  it('medida sobrevive mesmo espremendo o resto', () => {
    const t = montarTitulo(slots({
      produto: 'TECIDO OXFORD LISO ESTAMPADO ESPECIAL',
      marca: 'DETALLIA', medida: '10m', material: '100% POLIESTER',
      aplicacao: 'PARA DECORACAO', sinonimo: 'OXFORDINHO',
    }), semDiscriminador);
    expect(t).toContain('10m');
    expect(t.length).toBeLessThanOrEqual(60);
  });

  it('variacao sobrevive quando discrimina, mesmo custando outros slots', () => {
    const t = montarTitulo(slots({
      produto: 'LINHA ESPECIAL PARA RENASCENCA',
      marca: 'CIRCULO', quantidade: '10un', material: '100% ALGODAO',
      variacao: 'BEGE', aplicacao: 'PARA BORDADO',
    }), comDiscriminador);
    expect(t).toContain('Bege');
    expect(t.length).toBeLessThanOrEqual(60);
  });

  it('variacao é cortável quando NÃO discrimina', () => {
    const t = montarTitulo(slots({
      produto: 'LINHA ESPECIAL PARA RENASCENCA BORDADA',
      marca: 'CIRCULO', quantidade: '10un', material: '100% ALGODAO MERCERIZADO',
      variacao: 'CORES SORTIDAS',
    }), semDiscriminador);
    expect(t).not.toContain('Sortidas');
    expect(t.length).toBeLessThanOrEqual(60);
  });
});

describe('montarTitulo — reduções antes de remover', () => {
  it('reduz 100% Poliéster para Poliéster antes de derrubar um slot', () => {
    const t = montarTitulo(slots({
      produto: 'FITAS DE VELUDO DECORATIVA', marca: 'BUFALO',
      medida: '25m', material: '100% POLIESTER', variacao: 'AMARELO OURO',
    }), comDiscriminador);
    expect(t).toContain('Poliester');
    expect(t).toContain('Amarelo Ouro');
    expect(t.length).toBeLessThanOrEqual(60);
  });
});

describe('montarTitulo — inviável', () => {
  it('lança TituloInviavelError quando o obrigatório não cabe', () => {
    expect(() => montarTitulo(slots({
      produto: 'BORDADO INGLES EM PECA REFERENCIA CORES PASSA FITA ESPECIAL PREMIUM EXTRA',
      medida: '13,71m', variacao: 'BRANCO',
    }), comDiscriminador)).toThrow(TituloInviavelError);
  });

  it('o erro carrega os slots e o comprimento, para a mensagem ao operador', () => {
    try {
      montarTitulo(slots({
        produto: 'BORDADO INGLES EM PECA REFERENCIA CORES PASSA FITA ESPECIAL PREMIUM EXTRA',
        medida: '13,71m', variacao: 'BRANCO',
      }), comDiscriminador);
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(TituloInviavelError);
      const err = e as TituloInviavelError;
      expect(err.comprimento).toBeGreaterThan(60);
      expect(err.slotsObrigatorios.produto).toBeTruthy();
      expect(err.slotsObrigatorios.medida).toBe('13,71m');
    }
  });
});

describe('montarTitulo — propriedades', () => {
  const casos: TituloSlots[] = [
    slots({ produto: 'FITA CETIM', marca: 'PROGRESSO', modelo: 'N.1', medida: '100m', material: '100% POLIESTER' }),
    slots({ produto: 'LANTEJOULA', marca: 'BUFALO', medida: '50m 6mm', material: 'PVC' }),
    slots({ produto: 'GRAMPEADOR GRANDE', marca: 'BUFALO', quantidade: '30un' }),
    slots({ produto: 'AGULHA DE CROCHE', marca: 'CIRCULO', medida: '3,5mm', material: 'ALUMINIO' }),
  ];

  it('nunca passa de 60 caracteres', () => {
    for (const c of casos) expect(montarTitulo(c, semDiscriminador).length).toBeLessThanOrEqual(60);
  });

  it('nunca termina nem começa com espaço', () => {
    for (const c of casos) {
      const t = montarTitulo(c, semDiscriminador);
      expect(t).toBe(t.trim());
    }
  });

  it('nunca contém espaço duplo', () => {
    for (const c of casos) expect(montarTitulo(c, semDiscriminador)).not.toMatch(/\s{2}/);
  });

  it('é determinístico', () => {
    for (const c of casos) {
      expect(montarTitulo(c, semDiscriminador)).toBe(montarTitulo(c, semDiscriminador));
    }
  });

  it('nunca remove um slot de prioridade maior enquanto existir um de menor', () => {
    // Preenche TODOS os slots com valores longos e força o corte até o limite. A cada remoção,
    // o slot que saiu tem de ser o de menor prioridade ainda presente.
    const cheio = slots({
      produto: 'TECIDO OXFORD', marca: 'DETALLIA', modelo: 'N.12', medida: '10m',
      quantidade: '5un', material: 'POLIESTER', variacao: 'AZUL',
      compatibilidade: 'PARA MAQUINA', aplicacao: 'PARA FORRO', sinonimo: 'OXFORDINHO',
    });
    const t = montarTitulo(cheio, semDiscriminador);
    const presente = (v: string) => t.toLowerCase().includes(v.toLowerCase());

    // Lido do MENOS para o MAIS prioritário, o vetor de presença tem de ser monotônico:
    // uma sequência de ausentes seguida de uma sequência de presentes, nunca intercalado.
    const porPrioridade: Array<[string, string]> = [
      ['produto', 'Oxford'], ['marca', 'Detallia'], ['modelo', 'N.12'], ['medida', '10m'],
      ['quantidade', '5un'], ['material', 'Poliester'], ['variacao', 'Azul'],
      ['compatibilidade', 'Maquina'], ['aplicacao', 'Forro'], ['sinonimo', 'Oxfordinho'],
    ];
    let viuPresente = false;
    for (let i = porPrioridade.length - 1; i >= 0; i--) {
      const [nome, valor] = porPrioridade[i];
      if (presente(valor)) viuPresente = true;
      // Ausente DEPOIS de já ter visto um presente menos prioritário = ordem de corte violada.
      else expect(viuPresente, `${nome} foi cortado, mas um slot menos prioritário sobreviveu`).toBe(false);
    }
  });
});
