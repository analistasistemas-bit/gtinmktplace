// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntradaAnuncio, RespostaAnuncio } from '../formato';
import { MinhaMargem } from '../MinhaMargem';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const ENTRADA: EntradaAnuncio = { mlItemId: 'MLB1', sellerId: '9', catalogProductId: 'MLB77', categoriaId: 'MLB5', preco: 100, eanDaBusca: null };

function resposta(over: Partial<RespostaAnuncio> = {}): RespostaAnuncio {
  return {
    proprio: false,
    margem: { preco: 100, classico: { estado: 'indisponivel', motivo: 'x' }, premium: { estado: 'indisponivel', motivo: 'x' } },
    custo: { fonte: 'nenhuma', codigo: null, origem: null, unidadesPorPacote: 1, custoPacote: null },
    parametros: {
      aliquotas: { nacional: 4, importado: 12, confirmada: true },
      classico: { estado: 'ok', valor: { percentual: 10, fixa: 0 } },
      premium: { estado: 'ok', valor: { percentual: 15, fixa: 0 } },
      frete: { estado: 'ok', valor: 20 },
    },
    ...over,
  };
}

const montar = (dados: RespostaAnuncio, analisar = vi.fn()) =>
  render(<MinhaMargem entrada={ENTRADA} dados={dados} analisar={analisar} onDados={() => {}} />);
const tipo = (nome: string) => within(screen.getByRole('region', { name: nome }));

describe('MinhaMargem', () => {
  it('tipo indisponível mostra o motivo', () => {
    const r = resposta({
      custo: { fonte: 'catalogo', codigo: '00123', origem: 'nacional', unidadesPorPacote: 1, custoPacote: { estado: 'ok', valor: 30 } },
    });
    r.parametros.classico = { estado: 'indisponivel', motivo: 'falha ao consultar o Mercado Livre' };
    montar(r);
    tipo('Clássico').getByText(/falha ao consultar o Mercado Livre/);
    tipo('Premium').getByText('R$ 15,00'); // comissão 15% de 100
  });

  it('custo digitado sem origem não calcula e pede a origem', () => {
    montar(resposta());
    fireEvent.change(screen.getByLabelText('Custo do pacote (R$)'), { target: { value: '30' } });
    screen.getByText(/Escolha a origem/);
    expect(screen.queryByRole('region', { name: 'Clássico' })).toBeNull();
  });

  it('com origem importado usa a alíquota importado', () => {
    montar(resposta());
    fireEvent.change(screen.getByLabelText('Custo do pacote (R$)'), { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText('Importado'));
    // 100 − 10 (comissão) − 12 (imposto 12%) − 20 (frete) = 58; lucro 58 − 30 = 28
    const c = tipo('Clássico');
    c.getByText('R$ 12,00');
    c.getByText('R$ 58,00');
    c.getByText('R$ 28,00');
    c.getByText('28,0%');
  });

  it('alíquotas não confirmadas: pede a confirmação, nunca zero', () => {
    const r = resposta();
    r.parametros.aliquotas = { nacional: null, importado: null, confirmada: false };
    montar(r);
    fireEvent.change(screen.getByLabelText('Custo do pacote (R$)'), { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText('Nacional'));
    expect(tipo('Clássico').getAllByText(/Confirme as alíquotas de imposto em Configurações/).length).toBeGreaterThan(0);
  });

  it('fonte catalogo exibe "Custo do SKU 00123 · casado pelo catálogo"', () => {
    montar(resposta({
      custo: { fonte: 'catalogo', codigo: '00123', origem: 'nacional', unidadesPorPacote: 2, custoPacote: { estado: 'ok', valor: 60 } },
    }));
    screen.getByText('Custo do SKU 00123 · casado pelo catálogo');
    screen.getByText('Custo do pacote: R$ 60,00 (2 unidades)');
    expect(screen.queryByLabelText('Custo do pacote (R$)')).toBeNull();
  });

  it('unidades por pacote indisponíveis: custo indisponível com o motivo, sem lucro', () => {
    const motivo = 'unidades por pacote indisponíveis';
    montar(resposta({
      custo: { fonte: 'catalogo', codigo: '00123', origem: 'nacional', unidadesPorPacote: null, custoPacote: { estado: 'indisponivel', motivo } },
    }));
    screen.getByText(`Custo do pacote indisponível: ${motivo}`);
    tipo('Clássico').getByText(motivo); // aviso; lucro '—'
    expect(tipo('Clássico').getAllByText('—').length).toBeGreaterThan(0);
  });

  it('editar o preço recalcula na hora e só chama o servidor após 1,5 s', async () => {
    vi.useFakeTimers();
    const analisar = vi.fn(async () => ({ ok: true as const, dados: resposta() }));
    montar(resposta({
      custo: { fonte: 'catalogo', codigo: '00123', origem: 'nacional', unidadesPorPacote: 1, custoPacote: { estado: 'ok', valor: 30 } },
    }), analisar);
    fireEvent.change(screen.getByLabelText('Preço (R$)'), { target: { value: '200' } });
    tipo('Clássico').getByText('R$ 152,00'); // local: 200 − 20 (10%) − 8 (4%) − 20 (frete)
    screen.getByText(/frete pode mudar/);
    act(() => { vi.advanceTimersByTime(1499); });
    expect(analisar).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(analisar).toHaveBeenCalledTimes(1);
    expect(analisar).toHaveBeenCalledWith(200);
  });

  it('preço inválido não calcula nem chama o servidor', () => {
    vi.useFakeTimers();
    const analisar = vi.fn();
    montar(resposta(), analisar);
    fireEvent.change(screen.getByLabelText('Preço (R$)'), { target: { value: '' } });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(analisar).not.toHaveBeenCalled();
    screen.getByText('Informe um preço válido.');
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});
