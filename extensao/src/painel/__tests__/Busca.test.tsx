// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Busca } from '../Busca';
import type { EstadoBusca } from '../../busca-sw';

afterEach(() => cleanup());

const card = (itemId: string, o: Record<string, unknown> = {}) => ({
  itemId, catalogProductId: 'MLB100', userProductId: null, posicao: null, titulo: `Produto ${itemId}`, preco: 100, vendedor: null, nota: null,
  vendidosTexto: '+100 vendidos', freteGratis: null, full: null, lojaOficial: null, patrocinado: false, selos: [], miniaturaUrl: null, identidadeConflitante: false, ocorrencias: [{ posicao: null, patrocinado: false, preco: 100, vendidosTexto: '+100 vendidos' }], ...o,
});
const okMargem = (pct: number) => ({
  estado: 'ok', fonte: 'catalogo', codigo: '00000081', custo: {},
  margem: { preco: 19.99, classico: { estado: 'ok', valor: { margemPct: pct, lucro: 2.24 } }, premium: { estado: 'ok', valor: { margemPct: pct - 5, lucro: 1 } } },
});
const VINC = { fonte: 'catalogo', codigo: '00000081' };
/** Metadados derivados dos resultados (sem_vinculo → sem vínculo; demais → vinculado), salvo os informados. */
function estado(resultados: Record<string, unknown> = {}, cards = [card('MLB1000001', { full: true, preco: 19.99 }), card('MLB1000002', { preco: 50, patrocinado: true }), card('MLB1000003', { preco: 80, catalogProductId: null })], metadados?: Record<string, unknown>): EstadoBusca {
  const meta = metadados ?? Object.fromEntries(Object.entries(resultados).map(([k, v]) => [k, { proprio: false, vinculo: (v as { estado: string }).estado === 'sem_vinculo' ? null : VINC }]));
  const comId = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { itemId: k, ...(v as object) }])) as never;
  return {
    entrada: { tipoPagina: 'busca', url: 'https://lista.mercadolivre.com.br/batom' },
    resposta: { resultados: comId(resultados), metadados: comId(meta), precoDaMargem: {}, limiteEm: null, usoRegistrado: false },
    observado: { cards: cards as never, ocorrencias: 5 },
  };
}
const props = (o: Partial<Parameters<typeof Busca>[0]> = {}) => ({
  estado: estado(), chamar: vi.fn() as never, analisar: vi.fn(async () => ({ ok: true })), destacar: vi.fn(), ...o,
});
const SEM = { estado: 'sem_vinculo' };
const lista = () => screen.getByRole('list', { name: 'Produtos da busca' });
const bloco = (rotulo: string) => screen.getByText(rotulo, { selector: 'dt' }).closest('div')!;

describe('Busca no painel (Task 22 + Task 5)', () => {
  it('ao montar não dispara análise: o SW analisa sozinho e o painel só consome o estado', async () => {
    const p = props();
    render(<Busca {...p} />);
    await Promise.resolve();
    expect(p.analisar).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Analisar/ })).toBeNull();
  });

  it('resumo: lidos e cobertura → meus anúncios / SKUs vinculados → faixa → pisos e volume mínimo', () => {
    render(<Busca {...props({ estado: estado({ MLB1000001: okMargem(11.21), MLB1000002: SEM, MLB1000003: SEM }) })} />);
    screen.getByText('3 produtos');
    screen.getByText('5 cards na página, 3 produtos diferentes');
    within(bloco('Meus anúncios')).getByText('0');
    within(bloco('SKUs vinculados')).getByText('1');
    screen.getByText('2 de 2 grupos de vendas');
    const titulos = [...document.querySelectorAll('.bs-resumo dt, .bs-resumo .ct-rotulo')].map((e) => e.textContent);
    expect(titulos).toEqual(['Meus anúncios', 'SKUs vinculados', 'Faixa de preço', 'Soma dos mínimos informados', 'Volume mínimo ao preço atual']);
  });

  it('zero × desconhecido: sem identificação mostra "Verificando", nunca 0; parcial mostra a cobertura', () => {
    const { unmount } = render(<Busca {...props()} />);
    within(bloco('Meus anúncios')).getByText('Verificando');
    within(bloco('SKUs vinculados')).getByText('Verificando');
    unmount();
    render(<Busca {...props({ estado: estado({ MLB1000001: okMargem(11.21) }) })} />);
    screen.getByText('Identificados 1 de 3');
    within(bloco('SKUs vinculados')).getByText('1');
  });

  it('verificação de anúncio próprio indisponível (null) nunca vira 0; chips sem contagem enquanto desconhecido', () => {
    const nulo = { MLB1000001: { proprio: null, vinculo: null }, MLB1000002: { proprio: null, vinculo: VINC }, MLB1000003: { proprio: null, vinculo: null } };
    const { unmount } = render(<Busca {...props({ estado: estado({}, undefined, nulo) })} />);
    within(bloco('Meus anúncios')).getByText('Indisponível');
    expect(within(bloco('Meus anúncios')).queryByText('0')).toBeNull();
    const chipMeus = within(screen.getByRole('group', { name: 'Filtrar produtos' })).getByRole('button', { name: /Meus anúncios/ });
    expect(chipMeus.textContent).toBe('Meus anúncios');
    unmount();
    const parcial = { ...nulo, MLB1000001: { proprio: true, vinculo: null } };
    render(<Busca {...props({ estado: estado({}, undefined, parcial) })} />);
    within(bloco('Meus anúncios')).getByText('1');
    within(bloco('Meus anúncios')).getByText('2 sem verificação');
    cleanup();
    render(<Busca {...props()} />);
    const chips = within(screen.getByRole('group', { name: 'Filtrar produtos' }));
    expect(chips.getByRole('button', { name: /SKUs vinculados/ }).textContent).toBe('SKUs vinculados');
  });

  it('anúncio próprio e SKU vinculado são estados independentes', () => {
    const meta = {
      MLB1000001: { proprio: true, vinculo: null },
      MLB1000002: { proprio: false, vinculo: VINC },
      MLB1000003: { proprio: true, vinculo: VINC },
    };
    render(<Busca {...props({ estado: estado({ MLB1000001: SEM, MLB1000003: okMargem(5) }, undefined, meta) })} />);
    within(bloco('Meus anúncios')).getByText('2');
    within(bloco('SKUs vinculados')).getByText('2');
    const linha = (id: string) => within(lista()).getByRole('button', { name: `Produto ${id}` }).closest('li')!;
    within(linha('MLB1000001')).getByText('Meu anúncio');
    expect(within(linha('MLB1000001')).queryByText('SKU vinculado')).toBeNull();
    within(linha('MLB1000001')).getByRole('button', { name: 'Vincular ao meu SKU' });
    within(linha('MLB1000002')).getByText('SKU vinculado');
    expect(within(linha('MLB1000002')).queryByText('Meu anúncio')).toBeNull();
    within(linha('MLB1000003')).getByText('Meu anúncio');
    within(linha('MLB1000003')).getByText('SKU vinculado');
    expect(linha('MLB1000003').querySelector('.bs-miniatura')!.getAttribute('data-estado')).toBe('meu');
    expect(linha('MLB1000002').querySelector('.bs-miniatura')!.getAttribute('data-estado')).toBe('vinculado');
  });

  it('card não identificado: sem "Vincular" (desconhecido não é sem vínculo)', () => {
    render(<Busca {...props()} />);
    expect(within(lista()).queryByRole('button', { name: 'Vincular ao meu SKU' })).toBeNull();
  });

  it('filtros distintos "Meus anúncios" e "SKUs vinculados"; ordenação só na lista do PubliAI', () => {
    const meta = { MLB1000001: { proprio: true, vinculo: null }, MLB1000002: { proprio: false, vinculo: VINC }, MLB1000003: { proprio: false, vinculo: null } };
    const p = props({ estado: estado({ MLB1000001: SEM, MLB1000002: okMargem(3), MLB1000003: SEM }, undefined, meta) });
    render(<Busca {...p} />);
    const nomes = () => within(lista()).getAllByRole('button', { name: /^Produto / }).map((b) => b.textContent);
    const filtros = screen.getByRole('group', { name: 'Filtrar produtos' });
    fireEvent.click(within(filtros).getByRole('button', { name: /Meus anúncios/ }));
    expect(nomes()).toEqual(['Produto MLB1000001']);
    fireEvent.click(within(filtros).getByRole('button', { name: /Meus anúncios/ }));
    fireEvent.click(within(filtros).getByRole('button', { name: /SKUs vinculados/ }));
    expect(nomes()).toEqual(['Produto MLB1000002']);
    fireEvent.click(within(filtros).getByRole('button', { name: /SKUs vinculados/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Preço' }));
    expect(nomes()).toEqual(['Produto MLB1000001', 'Produto MLB1000002', 'Produto MLB1000003']);
    expect(p.destacar).not.toHaveBeenCalled();
  });

  it('linha: miniatura 56 px preguiçosa sem referrer; fallback no erro e quando não há URL', () => {
    const cards = [card('MLB1000001', { miniaturaUrl: 'https://http2.mlstatic.com/D_Q_NP_1-O.webp' }), card('MLB1000002')];
    const { container } = render(<Busca {...props({ estado: estado({}, cards) })} />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://http2.mlstatic.com/D_Q_NP_1-O.webp');
    expect(img.getAttribute('width')).toBe('56');
    expect(img.getAttribute('height')).toBe('56');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(container.querySelectorAll('.bs-miniatura-vazia')).toHaveLength(1);
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelectorAll('.bs-miniatura-vazia')).toHaveLength(2);
  });

  it('lista: margem e preço sem abrir detalhes; composição e título completo na expansão; clique destaca o card', () => {
    const p = props({ estado: estado({ MLB1000001: okMargem(11.21), MLB1000002: SEM, MLB1000003: { estado: 'sem_categoria', fonte: 'catalogo', codigo: '9' } }) });
    render(<Busca {...p} />);
    within(lista()).getByLabelText('Margem simulada no Clássico: 11,2%');
    within(lista()).getByText('R$ 19,99');
    within(lista()).getByText('Sem categoria');
    const det = within(lista()).getByText('Produto MLB1000001', { selector: '.bs-detalhes p' });
    within(det.closest('details')!).getByText('Premium');
    fireEvent.click(within(lista()).getByRole('button', { name: 'Produto MLB1000001' }));
    expect(p.destacar).toHaveBeenCalledWith('MLB1000001');
    expect(within(lista()).getAllByRole('button', { name: 'Vincular ao meu SKU' })).toHaveLength(1);
  });

  it('cota esgotada: "Minha margem aguardando cota" na linha e tentar de novo explícito', async () => {
    const p = props({ estado: estado({ MLB1000001: { estado: 'limite', fonte: 'catalogo', codigo: '1' } }) });
    render(<Busca {...p} />);
    within(lista()).getByText('Minha margem aguardando cota');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(p.analisar).toHaveBeenCalledWith([]));
  });

  it('falha numa nova tentativa: mensagem e tentar de novo', async () => {
    const p = props({ estado: estado({ MLB1000001: { estado: 'limite', fonte: 'catalogo', codigo: '1' } }), analisar: vi.fn(async () => ({ ok: false, erro: 'limite' })) });
    render(<Busca {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await screen.findByText('Muitas análises em sequência. Aguarde um minuto.');
  });

  it('paginação de 15 linhas', () => {
    const cards = Array.from({ length: 17 }, (_, i) => card(`MLB10000${String(i).padStart(2, '0')}`));
    render(<Busca {...props({ estado: estado({}, cards) })} />);
    expect(within(lista()).getAllByRole('listitem')).toHaveLength(15);
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos (17)' }));
    expect(within(lista()).getAllByRole('listitem')).toHaveLength(17);
  });

  it('"Vincular" abre direto o formulário de SKU (um clique)', () => {
    render(<Busca {...props({ estado: estado({ MLB1000001: okMargem(11.21), MLB1000002: SEM, MLB1000003: SEM }) })} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular ao meu SKU' })[0]);
    screen.getByRole('heading', { name: 'Qual SKU seu é este produto?' });
  });
});

describe('conflitos na cobertura (fix rodada 1)', () => {
  it('mostra quantos grupos foram excluídos por identificação conflitante', () => {
    const cards = [card('MLB1000001', { catalogProductId: null }), card('MLB1000002', { catalogProductId: null, identidadeConflitante: true })];
    render(<Busca {...props({ estado: estado({}, cards) })} />);
    screen.getByText('1 de 1 grupos de vendas · 1 excluído por identificação conflitante');
  });
});
