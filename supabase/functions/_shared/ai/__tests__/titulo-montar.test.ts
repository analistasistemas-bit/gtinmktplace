import { describe, it, expect } from 'vitest';
import { montarTitulo, mensagemTituloInviavel, TituloInviavelError } from '../titulo-montar';
import { ORDEM_CORTE, SLOTS_VAZIOS, type SlotTitulo, type TituloSlots } from '../titulo-slots';

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

  it('variacao é cortada sem discriminar, e sobrevive discriminando — mesmos slots', () => {
    const base = {
      produto: 'LINHA ESPECIAL PARA RENASCENCA BORDADA MANUAL',
      marca: 'CIRCULO', quantidade: '10un', material: '100% ALGODAO MERCERIZADO',
      variacao: 'BEGE CLARINHO', compatibilidade: 'PARA MAQUINA DOMESTICA',
      aplicacao: 'PARA BORDADO A MAO', sinonimo: 'LINHAZINHA',
    };
    const off = montarTitulo(slots(base), semDiscriminador);
    const on = montarTitulo(slots(base), comDiscriminador);

    expect(off).toBe('Linha Especial para Renascenca Bordada Manual Circulo 10un');
    expect(on).toBe('Linha Especial para Renascenca Bordada Manual Bege Clarinho');
    // O par é o teste: se a proteção sumir, `on` vira igual a `off`.
    expect(on).not.toBe(off);
    expect(off).not.toContain('Bege');
    expect(on).toContain('Bege Clarinho');
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

  it('redução que zeraria o slot é pulada — o dado não some sem remoção', () => {
    const t = montarTitulo(slots({
      produto: 'FITAS DE VELUDO DECORATIVA', marca: 'BUFALO', medida: '25m',
      material: '100%', aplicacao: 'PARA ENFEITE', sinonimo: 'FITINHA',
    }), semDiscriminador);
    expect(t).toBe('Fitas de Veludo Decorativa Bufalo 25m 100% para Enfeite');
    expect(t).toContain('100%');
    expect(t).not.toContain('Fitinha'); // sinonimo, menos prioritário, é quem sai
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

describe('mensagemTituloInviavel', () => {
  it('nomeia os slots obrigatórios e traz o comprimento — pastas de edge function não têm suíte', () => {
    let capturado: TituloInviavelError | undefined;
    try {
      montarTitulo(slots({
        produto: 'BORDADO INGLES EM PECA REFERENCIA CORES PASSA FITA ESPECIAL PREMIUM EXTRA',
        medida: '13,71m', variacao: 'BRANCO',
      }), comDiscriminador);
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      capturado = e as TituloInviavelError;
    }
    const msg = mensagemTituloInviavel(capturado!);
    expect(msg).toContain('60 caracteres');
    expect(msg).toContain(String(capturado!.comprimento));
    expect(msg).toContain('produto=');
    expect(msg).toContain('medida="13,71m"');
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

  it('os slots ausentes são um prefixo de ORDEM_CORTE, não um sufixo de ORDEM_LEITURA', () => {
    // Contraexemplo real: `medida` é protegido, então o corte o PULA — `modelo` (menos
    // prioritário na ordem de leitura, mas processado depois de `medida` na ordem de corte)
    // pode sair enquanto `medida` e `marca` ficam. A invariante certa não é "sufixo da ordem
    // de leitura", é "prefixo de ORDEM_CORTE filtrada pelos protegidos".
    const protegidos = new Set<SlotTitulo>(['produto', 'medida']);
    const cheio = slots({
      produto: 'TECIDO OXFORD LISO ESTAMPADO PREMIUM ESPECIAL',
      marca: 'DETALLIA', modelo: 'N.12', medida: '10m', quantidade: '5un',
      material: 'POLIESTER', variacao: 'AZUL', compatibilidade: 'PARA MAQUINA',
      aplicacao: 'PARA FORRO', sinonimo: 'OXFORDINHO',
    });
    const t = montarTitulo(cheio, semDiscriminador);

    expect(t).toBe('Tecido Oxford Liso Estampado Premium Especial Detallia 10m');

    const valores: Record<SlotTitulo, string> = {
      produto: 'Oxford', marca: 'Detallia', modelo: 'N.12', medida: '10m', quantidade: '5un',
      material: 'Poliester', variacao: 'Azul', compatibilidade: 'Maquina', aplicacao: 'Forro',
      sinonimo: 'Oxfordinho',
    };
    const presente = (slot: SlotTitulo) => t.toLowerCase().includes(valores[slot].toLowerCase());

    // Contraexemplo documentado: `modelo` saiu, `marca` e `medida` (esta última protegida)
    // ficaram — provando que a ordem de corte, não a de leitura, governa quem sai.
    expect(presente('modelo')).toBe(false);
    expect(presente('marca')).toBe(true);
    expect(presente('medida')).toBe(true);

    const cortavel = ORDEM_CORTE.filter((s) => !protegidos.has(s));
    const ausentes = cortavel.filter((s) => !presente(s));
    const presentes = cortavel.filter((s) => presente(s));
    // Invariante verdadeira: ausentes é um PREFIXO de ORDEM_CORTE (filtrada pelos protegidos) —
    // ou seja, todo slot ausente vem antes, na ordem de corte, de todo slot presente.
    for (const a of ausentes) {
      for (const p of presentes) {
        expect(cortavel.indexOf(a), `${a} ausente deveria vir antes de ${p} presente em ORDEM_CORTE`)
          .toBeLessThan(cortavel.indexOf(p));
      }
    }
  });
});
