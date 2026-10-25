// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Painel } from '../App';
import type { EntradaAnuncio, EstadoAba, EstadoExt, RespostaAnuncio } from '../formato';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ENTRADA: EntradaAnuncio = { mlItemId: 'MLB1', sellerId: '9', catalogProductId: 'MLB77', categoriaId: 'MLB5', preco: 100, eanDaBusca: '7899941205918' };
const INDISP = { estado: 'indisponivel', motivo: 'x' } as const;
const DADOS: RespostaAnuncio = {
  proprio: false,
  catalogoCriadoEm: null,
  vendedor: null,
  margem: { preco: 100, classico: INDISP, premium: INDISP },
  custo: { fonte: 'nenhuma', variacaoId: null, codigo: null, origem: null, unidadesPorPacote: 1, unidadesSku: null, custoSku: null, fator: null, faltaUnidades: null, custoPacote: null },
  parametros: { aliquotas: { nacional: 8, importado: 16, confirmada: true }, classico: INDISP, premium: INDISP, frete: INDISP },
};
const EXT: EstadoExt = { ativa: true, logado: true, perfil: { nome: 'Ana', orgNome: 'Loja X' }, versao: '0.3.0', geracao: 1 };
const estado = (resposta: EstadoAba['resposta']): EstadoAba => ({ entrada: ENTRADA, resposta });

describe('Painel', () => {
  it('sem análise na aba', () => {
    render(<Painel estado={null} chamar={vi.fn()} reanalisarAba={vi.fn()} />);
    screen.getByText(/Abra um anúncio do Mercado Livre/);
  });

  it.each([
    ['sem_sessao', 'Abra o PubliAI e conecte a extensão'],
    ['modulo_desligado', 'A extensão não está habilitada para sua empresa'],
    ['limite', 'Muitas análises em sequência. Aguarde um minuto.'],
    ['sessao_suporte_expirada', /sessão de suporte expirou/],
  ] as const)('erro %s', (erro, texto) => {
    render(<Painel estado={estado({ ok: false, erro })} chamar={vi.fn()} reanalisarAba={vi.fn()} />);
    screen.getByText(texto);
  });

  it('anúncio próprio: só "Abrir no PubliAI"', () => {
    render(<Painel estado={estado({ ok: true, dados: { ...DADOS, proprio: true } })} chamar={vi.fn()} reanalisarAba={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Abrir no PubliAI' }).getAttribute('href')).toBe('https://app.publiai.daludi.com.br/');
    expect(screen.queryByText('Minha margem')).toBeNull();
  });

  it('confirmação de preço manda a entrada da aba com o preço editado', async () => {
    vi.useFakeTimers();
    const chamar = vi.fn(async () => ({ ok: true, dados: DADOS }));
    render(<Painel estado={estado({ ok: true, dados: DADOS })} chamar={chamar as never} reanalisarAba={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Preço de venda'), { target: { value: '150' } });
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(chamar).toHaveBeenCalledWith({ acao: 'analisar_anuncio', tipoPagina: 'anuncio', ...ENTRADA, preco: 150 });
    vi.useRealTimers();
  });

  it('"Este produto é meu SKU…": busca, vincula pelo catálogo e reanalisa', async () => {
    const chamar = vi.fn(async (corpo: { acao: string }) => {
      if (corpo.acao === 'buscar_sku') {
        return { ok: true, dados: { itens: [{ variacaoId: 'u-1', codigo: '00123', nome: 'Camisa', custo: 30, origem: 'nacional' }] } };
      }
      return { ok: true, dados: { ok: true } };
    });
    const reanalisarAba = vi.fn(async () => null);
    const props = { chamar: chamar as never, reanalisarAba };
    const { rerender } = render(<Painel estado={estado({ ok: true, dados: DADOS })} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Este produto é meu SKU…' }));
    fireEvent.change(screen.getByLabelText('Código, nome ou EAN'), { target: { value: '00123' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buscar' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /00123 · Camisa/ })); });
    expect(chamar).toHaveBeenCalledWith({ acao: 'salvar_vinculo', chave: { tipo: 'catalogo', valor: 'MLB77' }, variacaoId: 'u-1' });
    expect(reanalisarAba).toHaveBeenCalledTimes(1);
    // O SW grava e avisa; o App entrega o estado novo da aba.
    const vinculado = { ...DADOS, custo: { fonte: 'vinculo_manual' as const, variacaoId: 'vA', codigo: '00123', origem: 'nacional' as const, unidadesPorPacote: 1, unidadesSku: 1, custoSku: 30, fator: 1, faltaUnidades: null, custoPacote: { estado: 'ok' as const, valor: 30 } } };
    rerender(<Painel estado={estado({ ok: true, dados: vinculado })} {...props} />);
    screen.getByText('Custo do SKU 00123 · vínculo manual');
  });

  it('vínculo manual: "Trocar SKU" remove o vínculo (catálogo e item) e reanalisa', async () => {
    const chamar = vi.fn(async () => ({ ok: true, dados: { ok: true } }));
    const reanalisarAba = vi.fn(async () => null);
    const vinculado = { ...DADOS, custo: { fonte: 'vinculo_manual' as const, variacaoId: 'vA', codigo: '00123', origem: null, unidadesPorPacote: 1, unidadesSku: 1, custoSku: 30, fator: 1, faltaUnidades: null, custoPacote: { estado: 'ok' as const, valor: 30 } } };
    render(<Painel estado={estado({ ok: true, dados: vinculado })} chamar={chamar as never} reanalisarAba={reanalisarAba} />);
    expect(screen.queryByRole('button', { name: 'Este produto é meu SKU…' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Trocar SKU' })); });
    expect(chamar).toHaveBeenCalledWith({ acao: 'remover_vinculo', chave: { tipo: 'catalogo', valor: 'MLB77' } });
    expect(chamar).toHaveBeenCalledWith({ acao: 'remover_vinculo', chave: { tipo: 'item', valor: 'MLB1' } });
    expect(reanalisarAba).toHaveBeenCalledTimes(1);
  });

  it('sem "Trocar SKU" quando o custo veio do catálogo', () => {
    const cat = { ...DADOS, custo: { fonte: 'catalogo' as const, variacaoId: 'vA', codigo: '00123', origem: 'nacional' as const, unidadesPorPacote: 1, unidadesSku: 1, custoSku: 30, fator: 1, faltaUnidades: null, custoPacote: { estado: 'ok' as const, valor: 30 } } };
    render(<Painel estado={estado({ ok: true, dados: cat })} chamar={vi.fn()} reanalisarAba={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Trocar SKU' })).toBeNull();
  });

  it('vendedor vem depois da margem e do vínculo (topo = tarefa principal, D-6)', () => {
    const vendedor = { nickname: 'LOJA X', nivel: '5_green', medalha: null, vendas: 10, periodo: null, uf: 'SP' };
    render(<Painel estado={estado({ ok: true, dados: { ...DADOS, vendedor } })} chamar={vi.fn()} reanalisarAba={vi.fn()} />);
    const titulo = screen.getByRole('heading', { name: 'Vendedor' });
    const sku = screen.getByText('Este produto é meu SKU…');
    expect(sku.compareDocumentPosition(titulo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('mostra qual anúncio está sendo analisado', () => {
    render(<Painel estado={estado({ ok: true, dados: DADOS })} chamar={vi.fn()} reanalisarAba={vi.fn()} />);
    screen.getByText('Anúncio MLB1');
  });
});

describe('App', () => {
  it('lê o estado da aba ativa e recarrega no broadcast da mesma aba', async () => {
    let ouvinte: ((m: unknown) => void) | undefined;
    const sendMessage = vi.fn(async (m: { tipo: string }) =>
      m.tipo === 'publiai:estado-extensao' ? EXT
        : m.tipo === 'publiai:estado-da-aba' ? { entrada: ENTRADA, resposta: { ok: false, erro: 'modulo_desligado' } } : undefined);
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn(async () => [{ id: 7 }]), onActivated: { addListener: vi.fn(), removeListener: vi.fn() } },
      runtime: { sendMessage, onMessage: { addListener: (f: typeof ouvinte) => { ouvinte = f; }, removeListener: vi.fn() } },
    });
    await act(async () => { render(<App />); });
    expect(sendMessage).toHaveBeenCalledWith({ tipo: 'publiai:estado-da-aba', tabId: 7 });
    screen.getByText('A extensão não está habilitada para sua empresa');

    sendMessage.mockClear();
    await act(async () => { ouvinte!({ tipo: 'publiai:estado-atualizado', tabId: 8 }); });
    expect(sendMessage).not.toHaveBeenCalled();
    await act(async () => { ouvinte!({ tipo: 'publiai:estado-atualizado', tabId: 7 }); });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('mesmo anúncio mantém o preço simulado; outro anúncio ou aba recarregando zera', async () => {
    let ouvinte: ((m: unknown) => void) | undefined;
    let atual: EstadoAba | null = { entrada: ENTRADA, resposta: { ok: true, dados: DADOS } };
    const sendMessage = vi.fn(async (m: { tipo: string }) => (m.tipo === 'publiai:estado-extensao' ? EXT : m.tipo === 'publiai:estado-da-aba' ? atual : undefined));
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn(async () => [{ id: 7 }]), onActivated: { addListener: vi.fn(), removeListener: vi.fn() } },
      runtime: { sendMessage, onMessage: { addListener: (f: typeof ouvinte) => { ouvinte = f; }, removeListener: vi.fn() } },
    });
    await act(async () => { render(<App />); });
    const preco = () => (screen.getByLabelText('Preço de venda') as HTMLInputElement).value;
    fireEvent.change(screen.getByLabelText('Preço de venda'), { target: { value: '150' } });

    atual = { entrada: ENTRADA, resposta: { ok: true, dados: DADOS } }; // nova análise, mesmo anúncio
    await act(async () => { ouvinte!({ tipo: 'publiai:estado-atualizado', tabId: 7 }); });
    expect(preco()).toBe('150');

    atual = { entrada: { ...ENTRADA, mlItemId: 'MLB2', preco: 80 }, resposta: { ok: true, dados: DADOS } };
    await act(async () => { ouvinte!({ tipo: 'publiai:estado-atualizado', tabId: 7 }); });
    expect(preco()).toBe('80');
    screen.getByText('Anúncio MLB2');

    atual = null; // tabs.onUpdated loading: o SW esqueceu o estado
    await act(async () => { ouvinte!({ tipo: 'publiai:estado-atualizado', tabId: 7 }); });
    screen.getByText(/Abra um anúncio do Mercado Livre/);
    expect(screen.queryByText('Anúncio MLB2')).toBeNull();
  });

  // Monta o App com um SW falso; `ext` pode mudar entre leituras.
  const montar = async (ext: () => EstadoExt, extra?: (m: { tipo: string }) => unknown) => {
    const ouvintes: Array<(m: unknown) => void> = [];
    const sendMessage = vi.fn(async (m: { tipo: string }) => {
      if (m.tipo === 'publiai:estado-extensao') return ext();
      if (m.tipo === 'publiai:estado-da-aba') return { entrada: ENTRADA, resposta: { ok: true, dados: DADOS } };
      return extra?.(m);
    });
    vi.stubGlobal('chrome', {
      tabs: { query: vi.fn(async () => [{ id: 7 }]), onActivated: { addListener: vi.fn(), removeListener: vi.fn() } },
      runtime: { sendMessage, onMessage: { addListener: (f: (m: unknown) => void) => { ouvintes.push(f); }, removeListener: vi.fn() } },
    });
    await act(async () => { render(<App />); });
    return { sendMessage, avisar: async (m: unknown) => { await act(async () => { ouvintes.forEach((f) => f(m)); }); } };
  };

  it('deslogado mostra Entrar; desativada mostra Ativar', async () => {
    await montar(() => ({ ...EXT, logado: false, perfil: null }));
    screen.getByRole('heading', { name: 'Entrar no PubliAI' });
    expect(screen.queryByRole('switch')).toBeNull();
    cleanup();
    const { sendMessage } = await montar(() => ({ ...EXT, ativa: false }), () => ({ ok: true, ...EXT, ativa: true, geracao: 2 }));
    screen.getByText('Extensão desativada');
    screen.getByText('Selos e análises pausados');
    expect(screen.queryByLabelText('Preço de venda')).toBeNull();
    screen.getByRole('switch', { name: 'Extensão ativa' }); // rodapé da conta continua
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ativar' })); });
    expect(sendMessage).toHaveBeenCalledWith({ tipo: 'publiai:definir-ativa', ativa: true, geracao: 1 });
    expect(screen.queryByText('Extensão desativada')).toBeNull();
  });

  it('logado: painel e rodapé da conta; comandos levam a geração', async () => {
    const { sendMessage } = await montar(() => ({ ...EXT, geracao: 4 }), () => ({ ok: true, dados: { itens: [] }, geracao: 4 }));
    screen.getByLabelText('Preço de venda');
    screen.getByText('Loja X');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Este produto é meu SKU…' })); });
    fireEvent.change(screen.getByLabelText('Código, nome ou EAN'), { target: { value: '00123' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buscar' })); });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'publiai:chamar', geracao: 4 }));
  });

  it('painel com geração nova descarta a simulação e o estado em voo', async () => {
    let ext = EXT;
    const { avisar } = await montar(() => ext);
    fireEvent.change(screen.getByLabelText('Preço de venda'), { target: { value: '150' } });
    expect((screen.getByLabelText('Preço de venda') as HTMLInputElement).value).toBe('150');
    ext = { ...EXT, geracao: 2 }; // troca de conta/pausa no SW
    await avisar({ tipo: 'publiai:conta-mudou', logado: true, ativa: true, geracao: 2 });
    expect((screen.getByLabelText('Preço de venda') as HTMLInputElement).value).toBe('100');
  });

  it('geracao_antiga numa chamada: relê o estado e remonta', async () => {
    let ext = EXT;
    const { sendMessage } = await montar(() => ext, (m) => {
      // A busca de SKU chega com a geração velha (Catálogo e Radar também chamam ao montar, e passam).
      if (m.tipo === 'publiai:chamar' && (m as { corpo?: { acao?: string } }).corpo?.acao === 'buscar_sku') { ext = { ...EXT, geracao: 3 }; return { ok: false, erro: 'geracao_antiga', geracao: 3 }; }
      if (m.tipo === 'publiai:chamar') return { ok: true, dados: {}, geracao: 3 };
      return undefined;
    });
    fireEvent.change(screen.getByLabelText('Preço de venda'), { target: { value: '150' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Este produto é meu SKU…' })); });
    fireEvent.change(screen.getByLabelText('Código, nome ou EAN'), { target: { value: '00123' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buscar' })); });
    expect((screen.getByLabelText('Preço de venda') as HTMLInputElement).value).toBe('100');
    expect(sendMessage.mock.calls.filter(([m]) => (m as { tipo: string }).tipo === 'publiai:estado-extensao').length).toBeGreaterThanOrEqual(2);
  });

  it('aviso de deslogado leva a Entrar', async () => {
    let ext = EXT;
    const { avisar } = await montar(() => ext);
    ext = { ...EXT, logado: false, perfil: null, geracao: 2 };
    await avisar({ tipo: 'publiai:conta-mudou', logado: false, ativa: true, geracao: 2 });
    screen.getByRole('heading', { name: 'Entrar no PubliAI' });
  });
});
