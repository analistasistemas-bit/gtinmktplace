// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Busca } from '../Busca';
import type { EstadoBusca } from '../../busca-sw';

afterEach(() => cleanup());

const card = (itemId: string, o: Record<string, unknown> = {}) => ({
  itemId, catalogProductId: 'MLB100', userProductId: null, posicao: null, titulo: `Produto ${itemId}`, preco: 100, vendedor: null, nota: null,
  vendidosTexto: '+100 vendidos', freteGratis: null, full: null, lojaOficial: null, patrocinado: false, selos: [], miniaturaUrl: null, identidadeConflitante: false, ocorrencias: [{ posicao: null, patrocinado: o.patrocinado ?? false, preco: o.preco === undefined ? 100 : o.preco, vendidosTexto: o.vendidosTexto === undefined ? '+100 vendidos' : o.vendidosTexto }], ...o,
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
    const titulos = [...document.querySelectorAll('.bs-resumo dt, .bs-resumo .ct-rotulo')].map((e) => e.firstChild!.textContent);
    expect(titulos).toEqual(['Meus anúncios', 'SKUs vinculados', 'Faixa de preço', 'Vendas mínimas da página', 'Giro mínimo ao preço atual', '% dos pisos observados']);
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
    const itens = within(lista()).getAllByRole('listitem');
    within(itens[0].querySelector('details')!).getByText('Premium');
    fireEvent.click(within(lista()).getByRole('button', { name: 'Produto MLB1000001' }));
    expect(p.destacar).toHaveBeenCalledWith('MLB1000001');
    expect(within(lista()).getAllByRole('button', { name: 'Vincular ao meu SKU' })).toHaveLength(1);
  });

  it('cota esgotada: "Aguardando cota" na linha e tentar de novo explícito', async () => {
    const p = props({ estado: estado({ MLB1000001: { estado: 'limite', fonte: 'catalogo', codigo: '1' } }) });
    render(<Busca {...p} />);
    within(lista()).getByText('Aguardando cota');
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

describe('Detalhes só com conteúdo novo (02/11, Diego)', () => {
  it('sem composição não há "Detalhes"; com composição não repete o título; título completo no hover', () => {
    const { container } = render(<Busca {...props({ estado: estado({ MLB1000001: okMargem(11.21), MLB1000002: SEM }) })} />);
    const itens = within(lista()).getAllByRole('listitem');
    expect(itens[0].querySelector('details')).not.toBeNull();
    expect(itens[1].querySelector('details')).toBeNull();
    expect(itens[2].querySelector('details')).toBeNull();
    expect(container.querySelectorAll('.bs-detalhes p:not(.nota)')).toHaveLength(0);
    expect(within(lista()).getByRole('button', { name: 'Produto MLB1000001' }).getAttribute('title')).toContain('Produto MLB1000001');
  });
});

describe('Task 5, revisão rodada 1', () => {
  it('detalhes: comissão e frete com procedência "na sua conta"', () => {
    const m = okMargem(11.21);
    const comConta = { ...m, margem: { ...m.margem, classico: { estado: 'ok', valor: { margemPct: 11.21, lucro: 2.24, recebe: 15, comissao: 2.5, imposto: 1.6, frete: 0, custo: 9 } } } };
    render(<Busca {...props({ estado: estado({ MLB1000001: comConta }) })} />);
    const det = within(lista()).getAllByRole('listitem')[0].querySelector('details')!;
    within(det).getAllByText(/Comissão na sua conta R\$ 2,50/);
    within(det).getAllByText(/Frete na sua conta R\$ 0,00/);
  });

  it('cobertura separada para vendidos e volume (2 grupos com vendidos, 1 com preço)', () => {
    const oc = (preco: number | null, vendidosTexto: string | null) => ({ posicao: 1, patrocinado: false, preco, vendidosTexto });
    const cards = [
      card('MLB1000001', { catalogProductId: 'MLB100', vendidosTexto: '+100 vendidos', preco: 30, ocorrencias: [oc(30, '+100 vendidos')] }),
      card('MLB1000003', { catalogProductId: null, vendidosTexto: '+10 vendidos', preco: null, ocorrencias: [oc(null, '+10 vendidos')] }),
    ];
    render(<Busca {...props({ estado: estado({}, cards) })} />);
    screen.getByText('2 de 2 grupos de vendas');
    screen.getByText('Giro: 1 de 2 grupos com piso e preço');
  });

  it('sem piso informado: "Não informado", nunca "0 vendidos"', () => {
    const cards = [card('MLB1000001', { vendidosTexto: null, ocorrencias: [{ posicao: 1, patrocinado: false, preco: 100, vendidosTexto: null }] })];
    render(<Busca {...props({ estado: estado({}, cards) })} />);
    expect(screen.queryByText('0 vendidos')).toBeNull();
    const linha = screen.getByText('Vendas mínimas da página').closest('.ct-linha')!;
    within(linha as HTMLElement).getByText('Não informado');
  });

  it('miniatura: fallback reinicia quando a URL muda', () => {
    const com = (url: string) => estado({}, [card('MLB1000001', { miniaturaUrl: url })]);
    const p = props({ estado: com('https://http2.mlstatic.com/a.webp') });
    const { container, rerender } = render(<Busca {...p} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    rerender(<Busca {...p} estado={com('https://http2.mlstatic.com/b.webp')} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://http2.mlstatic.com/b.webp');
  });
});

describe('linha por aparição (revisão final)', () => {
  it('patrocinado R$10 (sem vendidos, sem Full) + orgânico R$30 (+100 vendidos, Full): a linha é a do R$10; faixa R$10 a R$30', () => {
    const c = card('MLB1000001', {
      preco: 10, vendidosTexto: '+100 vendidos', full: true, patrocinado: true,
      ocorrencias: [
        { posicao: 1, patrocinado: true, preco: 10, vendidosTexto: null, full: null, freteGratis: null, lojaOficial: null },
        { posicao: 5, patrocinado: false, preco: 30, vendidosTexto: '+100 vendidos', full: true, freteGratis: null, lojaOficial: null },
      ],
    });
    const m10 = { ...okMargem(11.21), margem: { ...okMargem(11.21).margem, preco: 10 } };
    render(<Busca {...props({ estado: estado({ MLB1000001: m10 }, [c]) })} />);
    const linha = within(lista()).getByRole('button', { name: 'Produto MLB1000001' }).closest('li')!;
    within(linha).getByText('R$ 10,00');
    within(linha).getByText('Patrocinado');
    within(linha).getByLabelText('Margem simulada no Clássico: 11,2%');
    expect(within(linha).queryByText('+100 vendidos')).toBeNull();
    expect(within(linha).queryByText('Full')).toBeNull();
    screen.getByText('R$ 10,00 a R$ 30,00');
  });

  it('margem de outro preço (estado 0.4.2 sem precoDaMargem): a linha de R$10 não mostra o % calculado a R$19,99', () => {
    const c = card('MLB1000001', {
      preco: 10, ocorrencias: [{ posicao: 1, patrocinado: true, preco: 10, vendidosTexto: null, full: null, freteGratis: null, lojaOficial: null }],
    });
    render(<Busca {...props({ estado: estado({ MLB1000001: okMargem(11.21) }, [c]) })} />);
    const linha = within(lista()).getByRole('button', { name: 'Produto MLB1000001' }).closest('li')!;
    within(linha).getByText('R$ 10,00');
    expect(within(linha).queryByLabelText(/Margem simulada/)).toBeNull();
    expect(within(linha).queryByText('11,2%')).toBeNull();
    expect(within(linha).queryByText('Margem indisponível')).toBeNull();
    expect(within(linha).queryByText('Detalhes')).toBeNull(); // a composição também é do outro preço
    within(linha).getByText('SKU 00000081');
  });
});

describe('conflitos na cobertura (fix rodada 1)', () => {
  it('mostra quantos grupos foram excluídos por identificação conflitante', () => {
    const cards = [card('MLB1000001', { catalogProductId: null }), card('MLB1000002', { catalogProductId: null, identidadeConflitante: true })];
    render(<Busca {...props({ estado: estado({}, cards) })} />);
    screen.getByText('1 de 1 grupos de vendas · 1 excluído por identificação conflitante');
  });
});

describe('Painel autoexplicativo (0.4.1)', () => {
  it('estado não-ok com código: sem "Detalhes", mas o SKU aparece', () => {
    const { container } = render(<Busca {...props({ estado: estado({ MLB1000001: { estado: 'sem_categoria', fonte: 'catalogo', codigo: '9' }, MLB1000002: SEM, MLB1000003: SEM }) })} />);
    expect(container.querySelector('details')).toBeNull();
    screen.getByText('SKU 9');
  });

  it('ⓘ abre e fecha a explicação da linha, com os textos exatos', () => {
    render(<Busca {...props()} />);
    const b = screen.getByRole('button', { name: 'O que é Faixa de preço?' });
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(b);
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('note').textContent).toBe('Menor e maior preço entre os cards lidos nesta página, incluindo os patrocinados.');
    fireEvent.click(b);
    expect(screen.queryByRole('note')).toBeNull();
    for (const r of ['Vendas mínimas da página', 'Giro mínimo ao preço atual', 'Meus anúncios', 'SKUs vinculados', 'Ordenar']) screen.getByRole('button', { name: `O que é ${r}?` });
    fireEvent.click(screen.getByRole('button', { name: 'O que é Giro mínimo ao preço atual?' }));
    expect(screen.getByRole('note').textContent).toBe('Piso de vendidos de cada produto × o preço atual do card. Serve para comparar o tamanho dos produtos entre si. Não é faturamento nem o valor realmente vendido: as vendas aconteceram a outros preços e o Mercado Livre só informa a faixa.');
  });

  it('aba "Minha margem" desabilitada sem vinculados e cai para Relevância', () => {
    const { unmount } = render(<Busca {...props()} />);
    const aba = screen.getByRole('radio', { name: 'Minha margem' }) as HTMLInputElement;
    expect(aba.disabled).toBe(true);
    expect(aba.closest('label')!.getAttribute('title')).toBe('Vincule um SKU a algum produto desta busca para ordenar por margem.');
    unmount();
    render(<Busca {...props({ estado: estado({ MLB1000001: okMargem(11.21), MLB1000002: SEM, MLB1000003: SEM }) })} />);
    expect((screen.getByRole('radio', { name: 'Minha margem' }) as HTMLInputElement).disabled).toBe(false);
  });

  it('selecionada e depois indisponível: volta a Relevância', () => {
    const com = estado({ MLB1000001: okMargem(11.21), MLB1000002: SEM, MLB1000003: SEM });
    const { rerender } = render(<Busca {...props({ estado: com })} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Minha margem' }));
    expect((screen.getByRole('radio', { name: 'Minha margem' }) as HTMLInputElement).checked).toBe(true);
    rerender(<Busca {...props({ estado: estado() })} />);
    expect((screen.getByRole('radio', { name: 'Relevância' }) as HTMLInputElement).checked).toBe(true);
  });

  it('vinculado com estado ok mas margem indisponível: sem Detalhes, SKU visível', () => {
    const semConta = { estado: 'ok', fonte: 'catalogo', codigo: '77', custo: {} };
    const { container } = render(<Busca {...props({ estado: estado({ MLB1000001: semConta, MLB1000002: SEM, MLB1000003: SEM }) })} />);
    expect(container.querySelector('details')).toBeNull();
    screen.getByText('SKU 77');
  });
});

describe('Catálogos e vendedores (Task 10)', () => {
  const COM = { estado: 'ok', valor: { percentual: 14, fixa: 0, saleFeeAmount: 14, precoConsultado: 100 } };
  const ex = (sellerId: number | null, tipo: string | null) => ({ estado: 'ok', preco: 100, sellerId, tipo, comissao: COM });
  const comEnr = (enr: Record<string, unknown>) => {
    const e = estado({}, [card('MLB1000001'), card('MLB1000002'), card('MLB1000003', { catalogProductId: 'MLB200' }), card('MLB1000004', { catalogProductId: null })]);
    e.resposta.enriquecimento = { catalogos: {}, vendedores: {}, tentarAposEm: null, falhou: false, indisponivel: null, ...enr } as never;
    return e;
  };
  const secao = () => screen.getByRole('region', { name: 'Catálogos e vendedores' });

  it('medalha, UF, tipo e faixas com denominadores; parciais "≥ N"; desconhecidos à parte', () => {
    render(<Busca {...props({ estado: comEnr({
      catalogos: {
        MLB100: { produto: { estado: 'ok', criadoEm: null }, ofertas: { estado: 'ok', total: 3, lidas: 3, vendedoresIdentificados: 3, ofertasSemVendedor: 0, completa: true, exatas: { MLB1000001: ex(7, 'gold_special'), MLB1000002: ex(8, 'gold_pro') } } },
        MLB200: { produto: { estado: 'ok', criadoEm: null }, ofertas: { estado: 'ok', total: 50, lidas: 50, vendedoresIdentificados: 31, ofertasSemVendedor: 2, completa: false, exatas: { MLB1000003: { estado: 'nao_encontrada', preco: 100 } } } },
      },
      vendedores: { 7: { estado: 'ok', nome: 'A', medalha: 'platinum', uf: 'SP' }, 8: { estado: 'indisponivel' } },
    }) })} />);
    const s = within(secao());
    s.getByText('2 de 2');
    expect(s.getByText('Platinum').closest('li')!.textContent).toContain('1');
    expect(s.getByText('Não informada', { selector: '.bs-medalhas *' }).closest('li')!.textContent).toContain('1');
    s.getByText('2 vendedores únicos · 1 de 3 cards de catálogo sem vendedor identificado');
    expect(s.getByText('SP').closest('li')!.textContent).toContain('1');
    expect(s.getByText('Clássico').closest('li')!.textContent).toContain('1');
    expect(s.getByText('Premium').closest('li')!.textContent).toContain('1');
    s.getByText('2 de 3 cards de catálogo com oferta localizada');
    expect(s.getByText('1–5').closest('li')!.textContent).toContain('1');
    s.getByText('1 de 2 catálogos com leitura completa · Leitura parcial: ≥ 31');
    expect(secao().textContent).not.toMatch(/faturamento/i);
    for (const n of ['Catálogos lidos', 'Vendedores por medalha', 'UF dos vendedores', 'Tipo de anúncio', 'Vendedores por catálogo']) {
      s.getByRole('button', { name: `O que é ${n}?` });
    }
  });

  const OFERTAS1 = { estado: 'ok', total: 2, lidas: 2, vendedoresIdentificados: 2, ofertasSemVendedor: 0, completa: true, exatas: { MLB1000001: ex(7, 'gold_special'), MLB1000002: ex(8, 'gold_pro') } };
  const VENDEDORES = { 7: { estado: 'ok', nome: 'A', medalha: 'gold', uf: 'SP' }, 8: { estado: 'ok', nome: 'B', medalha: 'silver', uf: 'RJ' } };

  it('nada lido ainda: "Consultando dados do catálogo", sem "Tentar novamente" nem "Aguardando próxima janela"', () => {
    render(<Busca {...props({ estado: comEnr({}) })} />);
    within(secao()).getByText('Consultando dados do catálogo');
    expect(secao().textContent).not.toMatch(/próxima janela|Aguardando/);
    expect(within(secao()).queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('catálogo com metadados lidos e ofertas em processamento não conta como lido', () => {
    render(<Busca {...props({ estado: comEnr({ catalogos: {
      MLB100: { produto: { estado: 'ok', criadoEm: null }, ofertas: { ...OFERTAS1, exatas: { MLB1000001: { estado: 'nao_encontrada', preco: 100 }, MLB1000002: { estado: 'nao_encontrada', preco: 100 } } } },
      MLB200: { produto: { estado: 'ok', criadoEm: null } },
    } }) })} />);
    within(secao()).getByText('1 de 2');
    within(secao()).getByText('Consultando dados do catálogo');
  });

  it('ofertas completas com metadados em processamento: distribuições aparecem; "lidos" conta só catálogos sem pendência', () => {
    render(<Busca {...props({ estado: comEnr({ catalogos: { MLB100: { ofertas: OFERTAS1 } }, vendedores: { 7: VENDEDORES[7] } }) })} />);
    const s = within(secao());
    s.getByText('0 de 2');
    expect(s.getByText('Gold').closest('li')!.textContent).toContain('1');
    expect(s.getByText('1–5').closest('li')!.textContent).toContain('1');
  });

  it('Task 11.4: 429 parcial terminal preserva o recebido, conta à parte e oferece "Tentar novamente" (sem falha de rede)', async () => {
    const p = props({ estado: comEnr({ catalogos: {
      MLB100: { produto: { estado: 'ok', criadoEm: null }, ofertas: OFERTAS1 },
      MLB200: { produto: { estado: 'ok', criadoEm: null }, ofertas: { estado: 'indisponivel', motivo: 'limite do Mercado Livre' } },
    }, vendedores: VENDEDORES }) });
    render(<Busca {...p} />);
    const s = within(secao());
    s.getByText('1 de 2');
    s.getByText('1 catálogo sem ofertas lidas agora');
    s.getByText('Dados adicionais indisponíveis agora');
    expect(s.getByText('Gold').closest('li')!.textContent).toContain('1'); // o que chegou fica
    s.getByText('2 vendedores únicos · 1 de 3 cards de catálogo sem vendedor identificado'); // desconhecido não vira zero
    expect(secao().textContent).not.toMatch(/próxima janela|Consultando/);
    fireEvent.click(s.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(p.analisar).toHaveBeenCalledWith([], true));
  });

  it('Task 11.4: só a comissão indisponível também oferece "Tentar novamente" (haParaTentar)', () => {
    const semCom = { ...OFERTAS1, exatas: { MLB1000001: { ...ex(7, 'gold_special'), comissao: { estado: 'indisponivel', motivo: 'limite do Mercado Livre' } }, MLB1000002: ex(8, 'gold_pro') } };
    render(<Busca {...props({ estado: comEnr({ catalogos: { MLB100: { produto: { estado: 'ok', criadoEm: null }, ofertas: semCom }, MLB200: { produto: { estado: 'ok', criadoEm: null }, ofertas: { ...OFERTAS1, exatas: { MLB1000003: { estado: 'nao_encontrada', preco: 100 } } } } }, vendedores: VENDEDORES }) })} />);
    within(secao()).getByRole('button', { name: 'Tentar novamente' });
  });

  it('Task 11.4: tudo lido: nem aviso nem botão', () => {
    render(<Busca {...props({ estado: comEnr({ catalogos: { MLB100: { produto: { estado: 'ok', criadoEm: null }, ofertas: OFERTAS1 }, MLB200: { produto: { estado: 'ok', criadoEm: null }, ofertas: { ...OFERTAS1, exatas: { MLB1000003: { estado: 'nao_encontrada', preco: 100 } } } } }, vendedores: VENDEDORES }) })} />);
    expect(within(secao()).queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    expect(secao().textContent).not.toMatch(/indisponíveis agora|Consultando/);
  });

  it('Task 11.4: SW responde "aguardar" (Retry-After) → texto com a hora; Retry-After já no estado → mesma frase antes do clique', async () => {
    const quando = Date.now() + 90_000;
    const hhmm = new Date(quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const parcial = { catalogos: { MLB100: { produto: { estado: 'ok', criadoEm: null }, ofertas: { estado: 'indisponivel', motivo: 'limite do Mercado Livre' } } } };
    const p = props({ estado: comEnr(parcial), analisar: vi.fn(async () => ({ ok: false, erro: 'aguardar', tentarAposEm: quando })) });
    const { unmount } = render(<Busca {...p} />);
    fireEvent.click(within(secao()).getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => within(secao()).getByText(`O Mercado Livre pediu uma pausa; tente de novo às ${hhmm}`));
    expect(screen.queryByRole('alert')).toBeNull(); // não vai para o aviso genérico da margem
    unmount();
    render(<Busca {...props({ estado: comEnr({ ...parcial, tentarAposEm: quando }) })} />);
    within(secao()).getByText(`O Mercado Livre pediu uma pausa; tente de novo às ${hhmm}`);
  });

  it('Rodada 1: página indisponível (erro definitivo, estado vazio): motivo + "Tentar novamente", nada em "Consultando"', async () => {
    const p = props({ estado: comEnr({ indisponivel: 'A extensão não está habilitada para sua empresa' }) });
    render(<Busca {...p} />);
    const s = within(secao());
    s.getByText('A extensão não está habilitada para sua empresa');
    expect(secao().textContent).not.toContain('Consultando');
    fireEvent.click(s.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(p.analisar).toHaveBeenCalledWith([], true));
  });

  it('falha de rede: aviso com "Tentar novamente" que refaz o enriquecimento uma vez', async () => {
    const p = props({ estado: comEnr({ falhou: true }) });
    render(<Busca {...p} />);
    fireEvent.click(within(secao()).getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(p.analisar).toHaveBeenCalledWith([], true));
  });

  it('sem cards de catálogo: a seção não aparece', () => {
    render(<Busca {...props({ estado: estado({}, [card('MLB1000004', { catalogProductId: null })]) })} />);
    expect(screen.queryByRole('region', { name: 'Catálogos e vendedores' })).toBeNull();
  });
});

describe('fatia 2.1 no painel', () => {
  const enr = {
    versao: 2, tentarAposEm: null, falhou: false, indisponivel: null,
    catalogos: { MLB100: { produto: { estado: 'ok', criadoEm: null, marca: 'Natura' }, ofertas: { estado: 'ok', total: 2, lidas: 2, vendedoresIdentificados: 2, ofertasSemVendedor: 0, completa: true,
      exatas: { MLB1000001: { estado: 'ok', preco: 19.99, sellerId: 7, tipo: 'gold_special', comissao: { estado: 'indisponivel', motivo: 'x' } },
        MLB1000002: { estado: 'ok', preco: 50, sellerId: 8, tipo: 'gold_special', comissao: { estado: 'indisponivel', motivo: 'x' } } } } } },
    vendedores: { 7: { estado: 'ok', nome: 'A', medalha: 'gold', uf: 'SP', cidade: 'Campinas', reputacao: '5_green' }, 8: { estado: 'ok', nome: 'B', medalha: null, uf: 'RJ', reputacao: null } },
    fretes: { 'MLB1000001|19.99|01310100': { estado: 'ok', valor: 23.45, expiraEm: Date.now() + 3600_000 }, 'MLB1000002|50|01310100': { estado: 'indisponivel', motivo: 'limite do Mercado Livre' } },
  };
  const comEnr = () => { const e = estado(); (e.resposta as { enriquecimento?: unknown }).enriquecimento = enr; return e; };

  it('linha: % dos pisos, frete cotado (indisponível nunca R$ 0), reputação acessível + cidade/UF, marca', () => {
    render(<Busca {...props({ estado: comEnr() })} />);
    const linhas = within(lista()).getAllByRole('listitem');
    const l1 = linhas[0].textContent!.replace(/\s+/g, ' ');
    expect(l1).toContain('50% dos pisos observados'); // 1 e 2 = mesmo catálogo (um grupo); 3 = outro
    expect(l1).toContain('Frete cotado R$ 23,45');
    expect(l1).toContain('Campinas/SP');
    expect(l1).toContain('marca Natura');
    within(linhas[0]).getByRole('img', { name: 'Reputação verde' });
    const l2 = linhas[1].textContent!;
    expect(l2).toContain('Frete cotado indisponível');
    expect(l2).not.toContain('R$ 0');
    expect(within(linhas[1]).queryByRole('img', { name: /Reputação/ })).toBeNull(); // reputação desconhecida: sem ponto
    expect(linhas[2].textContent).toContain('Consultando frete');
    // Frete nunca dentro da margem nem "na sua conta" fora da composição.
    expect(screen.queryByText(/Frete cotado na sua conta/)).toBeNull();
  });

  it('busca sem catálogo, só o frete falhou (rede/429): aviso e "Tentar novamente" aparecem e refazem', async () => {
    const semCat = [card('MLB1000003', { preco: 80, catalogProductId: null }), card('MLB1000004', { preco: 30, catalogProductId: null })];
    const e = estado({}, semCat);
    (e.resposta as { enriquecimento?: unknown }).enriquecimento = { versao: 2, catalogos: {}, vendedores: {}, tentarAposEm: null, freteAposEm: null, falhou: true, indisponivel: null,
      fretes: { 'MLB1000003|80|01310100': { estado: 'indisponivel', motivo: 'falha de rede' }, 'MLB1000004|30|01310100': { estado: 'indisponivel', motivo: 'frete da oferta indisponível' } } };
    const p = props({ estado: e });
    render(<Busca {...p} />);
    expect(screen.queryByRole('region', { name: 'Catálogos e vendedores' })).toBeNull(); // sem catálogo: sem a seção
    screen.getByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(p.analisar).toHaveBeenCalledWith([], true));
  });

  it('resumo: % dos pisos e frete com cobertura e ⓘ; reputação por vendedor único com desconhecidos e denominador', () => {
    render(<Busca {...props({ estado: comEnr() })} />);
    fireEvent.click(screen.getByRole('button', { name: 'O que é Frete cotado?' }));
    screen.getByText(/CEP 01310-100 \(São Paulo capital\)/);
    screen.getByText('1 de 3');
    fireEvent.click(screen.getByRole('button', { name: 'O que é % dos pisos observados?' }));
    screen.getByText(/Não é participação de mercado/);
    const rep = screen.getByRole('list', { name: 'Vendedores por reputação' });
    expect(within(rep).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Verde1', 'Verde-claro0', 'Amarela0', 'Laranja0', 'Vermelha0', 'Não informada1']);
    screen.getByText('de 2 vendedores únicos · 1 sem reputação informada');
    screen.getByRole('button', { name: 'O que é Vendedores por reputação?' });
  });
});
