// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Catalogo } from '../Catalogo';
import type { RespostaCatalogo } from '../../../../supabase/functions/_shared/extensao/catalogo.ts';

afterEach(() => cleanup());

const v = (nickname: string, nivel: string | null, medalha: string | null, uf: string | null) => ({ nickname, nivel, medalha, vendas: 100, periodo: null, uf });
const oferta = (itemId: string, preco: number, extra: Partial<RespostaCatalogo['ofertas'][number]> = {}) => ({
  itemId, sellerId: Number(itemId.replace(/\D/g, '')), preco, tipo: 'gold_special', full: false, freteGratis: true, lojaOficial: false,
  propria: false, vencedora: false, vendedor: v(`LOJA ${itemId}`, '5_green', null, 'SP'), ...extra,
});
const base: RespostaCatalogo = {
  coletadoEm: '2026-10-22T21:10:00.000Z',
  vencedor: { itemId: 'MLB1', sellerId: 1, preco: 310.62, origem: 'pagina' },
  ofertas: [
    oferta('MLB1', 310.62, { vencedora: true, full: true, lojaOficial: true, vendedor: v('Mercado Livre Casa', '5_green', 'platinum', 'SP') }),
    oferta('MLB2', 357.14, { vendedor: v('GMAD', '4_light_green', 'gold', 'SC') }),
    oferta('MLB3', 371, { vendedor: null }),
    oferta('MLB4', 374.9, { propria: true, vendedor: v('DIEGO', '3_yellow', null, 'PE') }),
    oferta('MLB5', 380, { vendedor: v('OUTRA', '1_red', 'silver', 'RS') }),
    oferta('MLB6', 399, { vendedor: v('MAIS UMA', '5_green', 'gold', 'RS') }),
  ],
  leitura: { carregadas: 6, total: 6, completa: true },
  resumo: {
    vendedores: 6, menorPreco: 310.62, maiorPreco: 399, full: 1, freteGratis: 6, lojasOficiais: 1, perfisCarregados: 5,
    porUf: { SP: 1, SC: 1, PE: 1, RS: 2, nao_informado: 1 }, porMedalha: { platinum: 1, gold: 2, silver: 1, sem: 1, nao_informado: 1 },
  },
  participacao: { estado: 'participa', itemId: 'MLB4', preco: 374.9, posicao: 4, empatada: false, ptw: { status: 'competing', precoParaGanhar: 309.9 } },
};
const ok = (dados: RespostaCatalogo = base) => vi.fn(async () => ({ ok: true as const, dados: { estado: 'ok' as const, valor: dados } }));
const entradaP = { tipoPagina: 'catalogo', mlItemId: 'MLB1', catalogProductId: 'MLB32466350' };
const entradaItem = { tipoPagina: 'anuncio', mlItemId: 'MLB9', catalogProductId: 'MLB32466350' };

describe('Catalogo (Task 24)', () => {
  it('em /p/ carrega sozinho, com o item da buy box da página', async () => {
    const chamar = ok();
    render(<Catalogo entrada={entradaP} chamar={(chamar) as never} onSimular={vi.fn()} />);
    await screen.findByText('Sua oferta');
    expect(chamar).toHaveBeenCalledWith({ acao: 'catalogo', catalogProductId: 'MLB32466350', itemDaPagina: 'MLB1' });
  });

  it('fora de /p/ espera o clique e não manda item da página (não é o vencedor)', async () => {
    const chamar = ok();
    render(<Catalogo entrada={entradaItem} chamar={(chamar) as never} onSimular={vi.fn()} />);
    expect(chamar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ver ofertas do catálogo' }));
    await screen.findByText('Sua oferta');
    expect(chamar).toHaveBeenCalledWith({ acao: 'catalogo', catalogProductId: 'MLB32466350', itemDaPagina: null });
  });

  it('participação: posição por preço e preço para ganhar', async () => {
    render(<Catalogo entrada={entradaP} chamar={(ok()) as never} onSimular={vi.fn()} />);
    const sua = (await screen.findByText('Sua oferta')).closest('div.ct-participacao')!;
    within(sua as HTMLElement).getByText('4º de 6');
    within(sua as HTMLElement).getByText('Posição por preço');
    within(sua as HTMLElement).getByText('R$ 309,90');
  });

  it('vencedor com origem; fora de /p/ oferece simular a margem no preço dele', async () => {
    const onSimular = vi.fn();
    render(<Catalogo entrada={entradaItem} chamar={(ok()) as never} onSimular={onSimular} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver ofertas do catálogo' }));
    await screen.findByText('Mercado Livre Casa', { selector: '.ct-vencedor-nome' });
    screen.getByText('Buy box desta página');
    fireEvent.click(screen.getByRole('button', { name: 'Simular minha margem a R$ 310,62' }));
    expect(onSimular).toHaveBeenCalledWith(310.62);
  });

  it('lista: 5 linhas, "Sua" e "Vencedora" explícitas, perfil não carregado, ver todas', async () => {
    render(<Catalogo entrada={entradaP} chamar={(ok()) as never} onSimular={vi.fn()} />);
    const lista = await screen.findByRole('list', { name: 'Ofertas do catálogo' });
    expect(within(lista).getAllByRole('listitem')).toHaveLength(5);
    within(lista).getByText('Sua');
    within(lista).getByText('Vencedora');
    within(lista).getByText('Vendedor 3 · perfil não carregado');
    fireEvent.click(screen.getByRole('button', { name: 'Ver todas (6)' }));
    expect(within(lista).getAllByRole('listitem')).toHaveLength(6);
  });

  it('ordenação por reputação e medalha (desconhecido no fim, preço desempata)', async () => {
    render(<Catalogo entrada={entradaP} chamar={(ok()) as never} onSimular={vi.fn()} />);
    const lista = await screen.findByRole('list', { name: 'Ofertas do catálogo' });
    fireEvent.click(screen.getByRole('radio', { name: 'Medalha' }));
    const nomes = () => within(lista).getAllByRole('listitem').map((li) => li.querySelector('.ct-nome')!.textContent);
    expect(nomes()[0]).toBe('Mercado Livre Casa');
    expect(nomes().slice(1, 3)).toEqual(['GMAD', 'MAIS UMA']);
    fireEvent.click(screen.getByRole('radio', { name: 'Reputação' }));
    expect(nomes()[0]).toBe('Mercado Livre Casa');
  });

  it('reputação em texto, não só na cor', async () => {
    render(<Catalogo entrada={entradaP} chamar={ok() as never} onSimular={vi.fn()} />);
    const lista = await screen.findByRole('list', { name: 'Ofertas do catálogo' });
    expect(within(lista).getAllByText('Verde').length).toBeGreaterThan(0);
    within(lista).getByText('Verde-claro');
    within(lista).getByText('Amarela');
  });

  it('indisponível por falha do ML oferece tentar de novo; sem conexão leva ao PubliAI', async () => {
    const chamar = vi.fn()
      .mockResolvedValueOnce({ ok: true, dados: { estado: 'indisponivel', motivo: 'falha ao consultar o Mercado Livre' } })
      .mockResolvedValueOnce({ ok: true, dados: { estado: 'ok', valor: base } });
    render(<Catalogo entrada={entradaP} chamar={chamar as never} onSimular={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    await screen.findByText('Sua oferta');
    cleanup();
    render(<Catalogo entrada={entradaP} chamar={vi.fn(async () => ({ ok: true, dados: { estado: 'indisponivel', motivo: 'Conecte o Mercado Livre à organização' } })) as never} onSimular={vi.fn()} />);
    await screen.findByRole('link', { name: 'Abrir o PubliAI' });
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
  });

  it('distribuição por UF e medalha com cobertura dos perfis', async () => {
    render(<Catalogo entrada={entradaP} chamar={(ok()) as never} onSimular={vi.fn()} />);
    await screen.findByText('Perfis carregados: 5 de 6 vendedores');
    screen.getByRole('list', { name: 'Vendedores por UF' });
    screen.getByRole('list', { name: 'Vendedores por medalha' });
  });

  it('ficha parcial: avisa e não mostra posição nem faixa de preço', async () => {
    const parcial = {
      ...base, leitura: { carregadas: 6, total: 140, completa: false }, resumo: { ...base.resumo, menorPreco: null, maiorPreco: null },
      participacao: { ...base.participacao, posicao: null } as RespostaCatalogo['participacao'],
    };
    render(<Catalogo entrada={entradaP} chamar={(ok(parcial)) as never} onSimular={vi.fn()} />);
    await screen.findByText('Parcial: 6 de 140');
    expect(screen.getAllByText('Indisponível em leitura parcial')).toHaveLength(2); // posição e faixa de preço
    screen.getByRole('button', { name: 'Ver 6 ofertas carregadas' });
  });

  it('estados: sem conexão, não participa, limite e falha com tentar de novo', async () => {
    render(<Catalogo entrada={entradaP} chamar={vi.fn(async () => ({ ok: true as const, dados: { estado: 'indisponivel' as const, motivo: 'Conecte o Mercado Livre à organização' } })) as never} onSimular={vi.fn()} />);
    await screen.findByText('Conecte o Mercado Livre à organização');
    cleanup();
    render(<Catalogo entrada={entradaP} chamar={ok({ ...base, participacao: { estado: 'nao_participa' } }) as never} onSimular={vi.fn()} />);
    await screen.findByText('Sua empresa não tem oferta neste catálogo.');
    cleanup();
    const falha = vi.fn().mockResolvedValueOnce({ ok: false, erro: 'interno' }).mockResolvedValueOnce({ ok: true, dados: { estado: 'ok', valor: base } });
    render(<Catalogo entrada={entradaP} chamar={(falha) as never} onSimular={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(falha).toHaveBeenCalledTimes(2));
    await screen.findByText('Sua oferta');
  });
});
