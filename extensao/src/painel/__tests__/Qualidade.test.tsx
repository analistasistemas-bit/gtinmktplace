// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Qualidade } from '../Qualidade';
import type { DadosQualidade } from '../../compartilhado/qualidade';

afterEach(() => cleanup());
const f = (id: string, l: number | null, a: number | null) => ({ id, largura: l, altura: a });
// Barroco Multicolor (medido em 22/10): 6 fotos, 5 abaixo de 1200, 1 Clip, 415 caracteres, sem garantia exibida, 16 disponíveis.
const barroco: DadosQualidade = {
  fotos: [f('a', 521, 749), f('b', 1020, 807), f('c', 700, 1050), f('d', 1200, 1200), f('e', 700, 933), f('g', 700, 1050)],
  clips: 1, descricao: 415, garantia: null, disponivel: 16,
};

describe('Qualidade do anúncio (Task 17)', () => {
  it('cabeçalho com a contagem e linhas com o valor medido', () => {
    render(<Qualidade dados={barroco} />);
    screen.getByRole('heading', { name: 'Qualidade do anúncio' });
    screen.getByText('3 a melhorar');
    const linha = (r: string) => screen.getByText(r).closest('li')!;
    within(linha('Resolução')).getByText('5 abaixo de 1.200 px');
    within(linha('Descrição')).getByText('415 caracteres');
    within(linha('Garantia')).getByText('Não informada');
    within(linha('Disponível')).getByText('16');
    expect(linha('Clips').getAttribute('data-estado')).toBe('ok');
    expect(linha('Garantia').getAttribute('data-estado')).toBe('nao_informado');
    expect(linha('Disponível').getAttribute('data-estado')).toBe('atencao');
  });

  it('chips com a posição das fotos abaixo de 1200 px', () => {
    const { container } = render(<Qualidade dados={barroco} />);
    expect([...container.querySelectorAll('.ql-chip')].map((c) => c.textContent)).toEqual(['Foto 1', 'Foto 2', 'Foto 3', 'Foto 5', 'Foto 6']);
  });

  it('estado é lido sem depender da cor (texto para leitor de tela)', () => {
    render(<Qualidade dados={barroco} />);
    expect(screen.getAllByText('Atenção:').length).toBe(3);
  });

  it('"Tudo certo" só com os seis ok; sem alerta mas com item não informado: "Sem alertas"', () => {
    const ok = { fotos: [1, 2, 3, 4, 5].map((n) => f(`f${n}`, 1200, 1200)), clips: 2, descricao: 900, garantia: '12 meses de garantia de fábrica.', disponivel: 80 };
    render(<Qualidade dados={ok} />);
    screen.getByText('Tudo certo');
    cleanup();
    render(<Qualidade dados={{ ...ok, garantia: null }} />);
    screen.getByText('Sem alertas');
  });

  it('nada lido na página: o bloco não aparece', () => {
    const { container } = render(<Qualidade dados={{ fotos: null, clips: null, descricao: null, garantia: null, disponivel: null }} />);
    expect(container.innerHTML).toBe('');
  });
});
