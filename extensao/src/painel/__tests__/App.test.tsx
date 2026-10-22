// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Painel } from '../App';
import type { EntradaAnuncio, EstadoAba, RespostaAnuncio } from '../formato';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ENTRADA: EntradaAnuncio = { mlItemId: 'MLB1', sellerId: '9', catalogProductId: 'MLB77', categoriaId: 'MLB5', preco: 100, eanDaBusca: '7899941205918' };
const INDISP = { estado: 'indisponivel', motivo: 'x' } as const;
const DADOS: RespostaAnuncio = {
  proprio: false,
  margem: { preco: 100, classico: INDISP, premium: INDISP },
  custo: { fonte: 'nenhuma', codigo: null, origem: null, unidadesPorPacote: 1, custoPacote: null },
  parametros: { aliquotas: { nacional: 8, importado: 16, confirmada: true }, classico: INDISP, premium: INDISP, frete: INDISP },
};
const estado = (resposta: EstadoAba['resposta']): EstadoAba => ({ entrada: ENTRADA, resposta });

describe('Painel', () => {
  it('sem análise na aba', () => {
    render(<Painel estado={null} chamar={vi.fn()} />);
    screen.getByText(/Abra um anúncio do Mercado Livre/);
  });

  it.each([
    ['sem_sessao', 'Abra o PubliAI e conecte a extensão'],
    ['modulo_desligado', 'A extensão não está habilitada para sua empresa'],
    ['limite', 'Muitas análises em sequência. Aguarde um minuto.'],
    ['sessao_suporte_expirada', /sessão de suporte expirou/],
  ] as const)('erro %s', (erro, texto) => {
    render(<Painel estado={estado({ ok: false, erro })} chamar={vi.fn()} />);
    screen.getByText(texto);
  });

  it('anúncio próprio: só "Abrir no PubliAI"', () => {
    render(<Painel estado={estado({ ok: true, dados: { ...DADOS, proprio: true } })} chamar={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Abrir no PubliAI' }).getAttribute('href')).toBe('https://app.publiai.daludi.com.br/');
    expect(screen.queryByText('Minha margem')).toBeNull();
  });

  it('confirmação de preço manda a entrada da aba com o preço editado', async () => {
    vi.useFakeTimers();
    const chamar = vi.fn(async () => ({ ok: true, dados: DADOS }));
    render(<Painel estado={estado({ ok: true, dados: DADOS })} chamar={chamar as never} />);
    fireEvent.change(screen.getByLabelText('Preço (R$)'), { target: { value: '150' } });
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(chamar).toHaveBeenCalledWith({ acao: 'analisar_anuncio', tipoPagina: 'anuncio', ...ENTRADA, preco: 150 });
    vi.useRealTimers();
  });

  it('"Este produto é meu SKU…": busca, vincula pelo catálogo e reanalisa', async () => {
    const chamar = vi.fn(async (corpo: { acao: string }) => {
      if (corpo.acao === 'buscar_sku') {
        return { ok: true, dados: { itens: [{ variacaoId: 'u-1', codigo: '00123', nome: 'Camisa', custo: 30, origem: 'nacional' }] } };
      }
      if (corpo.acao === 'salvar_vinculo') return { ok: true, dados: { ok: true } };
      return { ok: true, dados: { ...DADOS, custo: { fonte: 'vinculo_manual', codigo: '00123', origem: 'nacional', unidadesPorPacote: 1, custoPacote: { estado: 'ok', valor: 30 } } } };
    });
    render(<Painel estado={estado({ ok: true, dados: DADOS })} chamar={chamar as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Este produto é meu SKU…' }));
    fireEvent.change(screen.getByLabelText('Código, nome ou EAN'), { target: { value: '00123' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Buscar' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /00123 · Camisa/ })); });
    expect(chamar).toHaveBeenCalledWith({ acao: 'salvar_vinculo', chave: { tipo: 'catalogo', valor: 'MLB77' }, variacaoId: 'u-1' });
    expect(chamar).toHaveBeenLastCalledWith({ acao: 'analisar_anuncio', tipoPagina: 'anuncio', ...ENTRADA });
    screen.getByText('Custo do SKU 00123 · vínculo manual');
  });
});

describe('App', () => {
  it('lê o estado da aba ativa e recarrega no broadcast da mesma aba', async () => {
    let ouvinte: ((m: unknown) => void) | undefined;
    const sendMessage = vi.fn(async (m: { tipo: string }) =>
      m.tipo === 'publiai:estado-da-aba' ? { entrada: ENTRADA, resposta: { ok: false, erro: 'modulo_desligado' } } : undefined);
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
});
