import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { CampoFornecedor, sugerirFornecedores } from '../campo-fornecedor';

vi.mock('@/hooks/useFornecedoresOrg', () => ({
  useFornecedoresOrg: () => ({ data: ['Miss Boutique', 'Zaven Moda', 'Mãe & Filha', 'Boutique Sul'] }),
}));

afterEach(cleanup);

describe('sugerirFornecedores', () => {
  const lista = ['Miss Boutique', 'Zaven Moda', 'Mãe & Filha', 'Boutique Sul'];
  it('filtra por trecho, sem caixa nem acento', () => {
    expect(sugerirFornecedores(lista, 'bout')).toEqual(['Miss Boutique', 'Boutique Sul']);
    expect(sugerirFornecedores(lista, 'mae')).toEqual(['Mãe & Filha']);
  });
  it('vazio ou idêntico não sugere nada', () => {
    expect(sugerirFornecedores(lista, '  ')).toEqual([]);
    expect(sugerirFornecedores(lista, 'zaven moda')).toEqual([]);
  });
});

function Harness() {
  const [v, setV] = useState('');
  return <CampoFornecedor id="f" valor={v} onChange={setV} />;
}

describe('CampoFornecedor', () => {
  it('mostra os já cadastrados ao digitar e completa ao clicar', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Fornecedor') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'bout' } });
    const opcoes = screen.getAllByRole('option');
    expect(opcoes.map((o) => o.textContent)).toEqual(['Miss Boutique', 'Boutique Sul']);
    fireEvent.mouseDown(opcoes[1]);
    fireEvent.click(opcoes[1]);
    expect(input.value).toBe('Boutique Sul');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('seta + Enter escolhe pelo teclado', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Fornecedor') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'z' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('Zaven Moda');
  });

  it('nome novo continua aceito (texto livre)', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Fornecedor') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Fornecedor Novo' } });
    expect(input.value).toBe('Fornecedor Novo');
    expect(screen.queryByRole('option')).toBeNull();
  });
});
