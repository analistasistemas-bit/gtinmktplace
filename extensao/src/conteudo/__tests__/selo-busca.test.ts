import { describe, expect, it } from 'vitest';
import { seloDaBusca } from '../selo-busca';

const ok = (estado: 'ok' | 'indisponivel', margemPct: number | null) => ({
  itemId: 'MLB1', estado: 'ok' as const, fonte: 'catalogo' as const, codigo: '00000081', custo: {} as never,
  margem: { preco: 19.99, classico: estado === 'ok' ? { estado, valor: { margemPct } as never } : { estado, motivo: 'Informe a origem do produto' }, premium: { estado: 'indisponivel' as const, motivo: 'x' } },
});

describe('seloDaBusca', () => {
  it('sem vínculo (ou sem resultado) não ganha selo', () => {
    expect(seloDaBusca(undefined)).toBeNull();
    expect(seloDaBusca({ itemId: 'MLB1', estado: 'sem_vinculo' })).toBeNull();
  });
  it('casado: simulação Clássico com uma casa, tom pelo sinal', () => {
    expect(seloDaBusca(ok('ok', 11.21) as never)).toMatchObject({ rotulo: 'Minha margem · simulação Clássico', valor: '11,2%', tom: 'lucro' });
    expect(seloDaBusca(ok('ok', -3.4) as never)).toMatchObject({ rotulo: 'Minha margem · simulação Clássico', valor: '-3,4%', tom: 'prejuizo' });
  });
  it('margem não calculável nunca vira zero', () => {
    expect(seloDaBusca(ok('ok', null) as never)).toMatchObject({ rotulo: 'Minha margem indisponível', valor: null, tom: 'neutro' });
    expect(seloDaBusca(ok('indisponivel', null) as never)).toMatchObject({ rotulo: 'Minha margem indisponível', valor: null, titulo: 'Informe a origem do produto' });
  });
  it('limite, sem categoria e indisponível com texto próprio', () => {
    expect(seloDaBusca({ itemId: 'MLB1', estado: 'limite', fonte: 'catalogo', codigo: 'x' })).toMatchObject({ rotulo: 'Minha margem · aguardando cota', valor: null, tom: 'aguardando' });
    expect(seloDaBusca({ itemId: 'MLB1', estado: 'sem_categoria', fonte: 'catalogo', codigo: 'x' })?.rotulo).toBe('Minha margem indisponível');
    expect(seloDaBusca({ itemId: 'MLB1', estado: 'indisponivel', fonte: 'catalogo', codigo: 'x', motivo: 'falha' })?.titulo).toBe('falha');
  });
});
