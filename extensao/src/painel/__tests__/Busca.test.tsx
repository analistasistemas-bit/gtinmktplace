// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Busca } from '../Busca';
import type { EstadoBusca } from '../../busca-sw';

afterEach(() => cleanup());

const card = (itemId: string, o: Record<string, unknown> = {}) => ({
  itemId, catalogProductId: 'MLB100', userProductId: null, posicao: null, titulo: `Produto ${itemId}`, preco: 100, vendedor: null, nota: null,
  vendidosTexto: '+100 vendidos', freteGratis: null, full: null, lojaOficial: null, patrocinado: false, selos: [], ...o,
});
const okMargem = (pct: number) => ({
  estado: 'ok', fonte: 'catalogo', codigo: '00000081', custo: {},
  margem: { preco: 19.99, classico: { estado: 'ok', valor: { margemPct: pct, lucro: 2.24 } }, premium: { estado: 'ok', valor: { margemPct: pct - 5, lucro: 1 } } },
});
function estado(resultados: Record<string, unknown> = {}, cards = [card('MLB1000001', { full: true, preco: 19.99 }), card('MLB1000002', { preco: 50, patrocinado: true }), card('MLB1000003', { preco: 80, catalogProductId: null })]): EstadoBusca {
  return {
    entrada: { tipoPagina: 'busca', url: 'https://lista.mercadolivre.com.br/batom' },
    resposta: { resultados: Object.fromEntries(Object.entries(resultados).map(([k, v]) => [k, { itemId: k, ...(v as object) }])) as never },
    observado: { cards: cards as never, ocorrencias: 5 },
  };
}
const props = (o: Partial<Parameters<typeof Busca>[0]> = {}) => ({
  estado: estado(), chamar: vi.fn() as never, analisar: vi.fn(async () => ({ ok: true })), destacar: vi.fn(), ...o,
});

describe('Busca no painel (Task 22)', () => {
  it('ao abrir sem análise, analisa sozinho os produtos carregados', async () => {
    const p = props();
    render(<Busca {...p} />);
    await waitFor(() => expect(p.analisar).toHaveBeenCalledWith([]));
  });

  it('resumo honesto: produtos únicos × cards, seus produtos e vendidos como soma dos mínimos com cobertura', () => {
    render(<Busca {...props({ estado: estado({ MLB1000001: okMargem(11.21), MLB1000002: { estado: 'sem_vinculo' }, MLB1000003: { estado: 'sem_vinculo' } }) })} />);
    screen.getByText('3 produtos');
    screen.getByText('5 cards na página, 3 produtos diferentes');
    const seus = screen.getByText('Seus produtos', { selector: 'dt' }).closest('div')!;
    within(seus).getByText('1');
    screen.getByText('Soma dos mínimos informados');
    screen.getByText('3 de 3 produtos');
  });

  it('lista: margem simulada do card casado; sem vínculo oferece vincular; clique destaca o card na página', async () => {
    const p = props({ estado: estado({ MLB1000001: okMargem(11.21), MLB1000002: { estado: 'sem_vinculo' }, MLB1000003: { estado: 'sem_categoria', fonte: 'catalogo', codigo: '9' } }) });
    render(<Busca {...p} />);
    const lista = screen.getByRole('list', { name: 'Produtos da busca' });
    within(lista).getByText('11,2%');
    within(lista).getByText('Sem categoria');
    fireEvent.click(within(lista).getByRole('button', { name: 'Produto MLB1000001' }));
    expect(p.destacar).toHaveBeenCalledWith('MLB1000001');
    expect(within(lista).getAllByRole('button', { name: 'Vincular ao meu SKU' })).toHaveLength(1);
  });

  it('filtros e ordenação no painel (o DOM do ML não muda)', () => {
    render(<Busca {...props({ estado: estado({ MLB1000001: okMargem(11.21), MLB1000002: { estado: 'sem_vinculo' }, MLB1000003: { estado: 'sem_vinculo' } }) })} />);
    const nomes = () => within(screen.getByRole('list', { name: 'Produtos da busca' })).getAllByRole('button', { name: /^Produto / }).map((b) => b.textContent);
    fireEvent.click(screen.getByRole('button', { name: /Seus produtos/ }));
    expect(nomes()).toEqual(['Produto MLB1000001']);
    fireEvent.click(screen.getByRole('button', { name: /Seus produtos/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Preço' }));
    expect(nomes()).toEqual(['Produto MLB1000001', 'Produto MLB1000002', 'Produto MLB1000003']);
  });

  it('cards novos do scroll: botão para analisar só os novos', () => {
    const p = props({ estado: estado({ MLB1000001: okMargem(11.21) }) });
    render(<Busca {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Analisar novos resultados (2)' }));
    expect(p.analisar).toHaveBeenCalledWith([]);
  });

  it('falha ou limite na análise: mensagem e tentar de novo', async () => {
    const p = props({ analisar: vi.fn(async () => ({ ok: false, erro: 'limite' })) });
    render(<Busca {...p} />);
    await screen.findByText('Muitas análises em sequência. Aguarde um minuto.');
    screen.getByRole('button', { name: 'Tentar de novo' });
  });

  it('antes de qualquer resultado: "Verificando" no lugar de 0 e, se a análise não trouxer nada, botão para analisar', async () => {
    const p = props();
    render(<Busca {...p} />);
    const seus = screen.getByText('Seus produtos', { selector: 'dt' }).closest('div')!;
    within(seus).getByText('Verificando');
    await screen.findByRole('button', { name: 'Analisar resultados (3)' });
  });

  it('análise parcial: cobertura dos verificados e contexto da margem acima da lista', () => {
    render(<Busca {...props({ estado: estado({ MLB1000001: okMargem(11.21) }) })} />);
    screen.getByText('Seus produtos: 1 de 3 verificados');
    screen.getByText('Margem simulada no Clássico ao preço de cada card.');
    screen.getByLabelText('Margem simulada no Clássico: 11,2%');
  });

  it('"Vincular" abre direto o formulário de SKU (um clique)', () => {
    render(<Busca {...props({ estado: estado({ MLB1000001: okMargem(11.21), MLB1000002: { estado: 'sem_vinculo' }, MLB1000003: { estado: 'sem_vinculo' } }) })} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular ao meu SKU' })[0]);
    screen.getByRole('heading', { name: 'Qual SKU seu é este produto?' });
  });
});
