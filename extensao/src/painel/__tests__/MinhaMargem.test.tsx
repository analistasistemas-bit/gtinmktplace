// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntradaAnuncio, Resposta, RespostaAnuncio } from '../formato';
import { MinhaMargem } from '../MinhaMargem';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const ENTRADA: EntradaAnuncio = { mlItemId: 'MLB1', sellerId: '9', catalogProductId: 'MLB77', categoriaId: 'MLB5', preco: 100, eanDaBusca: null };

function resposta(over: Partial<RespostaAnuncio> = {}): RespostaAnuncio {
  return {
    proprio: false,
    margem: { preco: 100, classico: { estado: 'indisponivel', motivo: 'x' }, premium: { estado: 'indisponivel', motivo: 'x' } },
    custo: { fonte: 'nenhuma', variacaoId: null, codigo: null, origem: null, unidadesPorPacote: 1, unidadesSku: null, custoSku: null, fator: null, faltaUnidades: null, custoPacote: null },
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
      custo: { fonte: 'catalogo', variacaoId: 'vA', codigo: '00123', origem: 'nacional', unidadesPorPacote: 1, unidadesSku: 1, custoSku: 30, fator: 1, faltaUnidades: null, custoPacote: { estado: 'ok', valor: 30 } },
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

  it('custo digitado 0 é inválido (igual à edge: custo > 0) e não calcula', () => {
    montar(resposta());
    fireEvent.change(screen.getByLabelText('Custo do pacote (R$)'), { target: { value: '0' } });
    fireEvent.click(screen.getByLabelText('Nacional'));
    screen.getByText('Informe o custo do pacote para calcular.');
    expect(screen.queryByRole('region', { name: 'Clássico' })).toBeNull();
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
      custo: { fonte: 'catalogo', variacaoId: 'vA', codigo: '00123', origem: 'nacional', unidadesPorPacote: 2, unidadesSku: 1, custoSku: 30, fator: 2, faltaUnidades: null, custoPacote: { estado: 'ok', valor: 60 } },
    }));
    screen.getByText('Custo do SKU 00123 · casado pelo catálogo');
    screen.getByText('Custo do pacote: R$ 60,00 (2 × custo do SKU)');
    expect(screen.queryByLabelText('Custo do pacote (R$)')).toBeNull();
  });

  it('composição não confirmada: custo indisponível com o motivo, sem lucro, sem pedir unidades (o anúncio já tem)', () => {
    const motivo = 'composição não confirmada';
    montar(resposta({
      custo: { fonte: 'catalogo', variacaoId: 'vA', codigo: '00123', origem: 'nacional', unidadesPorPacote: 2, unidadesSku: null, custoSku: 30, fator: null, faltaUnidades: null, custoPacote: { estado: 'indisponivel', motivo } },
    }));
    screen.getByText(`Custo do pacote indisponível: ${motivo}`);
    tipo('Clássico').getByText(motivo); // aviso; lucro '—'
    expect(tipo('Clássico').getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Unidades por anúncio')).toBeNull();
  });

  describe('Codex #4: unidades não confirmadas (anúncio e/ou SKU)', () => {
    const motivo = 'quantidade por anúncio não confirmada';
    const semQtd = (unidadesSku: number | null = 1) => resposta({
      custo: {
        fonte: 'ean_da_busca', variacaoId: 'vA', codigo: '00123', origem: 'nacional', unidadesPorPacote: null, unidadesSku, custoSku: 10, fator: null,
        faltaUnidades: unidadesSku === null ? 'ambos' : 'anuncio',
        custoPacote: { estado: 'indisponivel', motivo: unidadesSku === null ? 'composição não confirmada' : motivo },
      },
    });
    const soSku = (unidadesPorPacote: number) => resposta({
      custo: {
        fonte: 'vinculo_manual', variacaoId: 'vA', codigo: '00123', origem: 'nacional', unidadesPorPacote, unidadesSku: null, custoSku: 10, fator: null,
        faltaUnidades: 'sku', custoPacote: { estado: 'indisponivel', motivo: 'composição não confirmada' },
      },
    });
    const digitar = (rotulo: string, value: string) => fireEvent.change(screen.getByLabelText(rotulo), { target: { value } });

    it('pede "Unidades por anúncio" sem valor padrão e não mostra lucro', () => {
      montar(semQtd());
      expect((screen.getByLabelText('Unidades por anúncio') as HTMLInputElement).value).toBe('');
      expect(screen.queryByLabelText('Unidades no SKU')).toBeNull();
      screen.getByText(`Custo do pacote indisponível: ${motivo}`);
      expect(tipo('Clássico').getAllByText('—').length).toBe(3); // custo, lucro, margem
    });

    it('preenchido recalcula localmente: 3 unidades × SKU unitário de R$ 10 = R$ 30', () => {
      const analisar = vi.fn();
      montar(semQtd(), analisar);
      fireEvent.change(screen.getByLabelText('Unidades por anúncio'), { target: { value: '3' } });
      screen.getByText('Custo do pacote: R$ 30,00 (3 × custo do SKU)');
      // 100 − 10 (comissão) − 4 (imposto) − 20 (frete) = 66; lucro 66 − 30 = 36
      tipo('Clássico').getByText('R$ 36,00');
      expect(analisar).not.toHaveBeenCalled();
    });

    it('razão não inteira → composição diferente; valor não inteiro não recalcula', () => {
      montar(semQtd(2));
      digitar('Unidades por anúncio', '3');
      screen.getByText('Custo do pacote indisponível: composição diferente');
      digitar('Unidades por anúncio', '1.5');
      screen.getByText(`Custo do pacote indisponível: ${motivo}`);
    });

    it('só o SKU desconhecido: pede só "Unidades no SKU"; 6 no anúncio ÷ 2 no SKU = 3 × R$ 10', () => {
      montar(soSku(6));
      expect(screen.queryByLabelText('Unidades por anúncio')).toBeNull();
      expect((screen.getByLabelText('Unidades no SKU') as HTMLInputElement).value).toBe('');
      screen.getByText('Custo do pacote indisponível: composição não confirmada');
      digitar('Unidades no SKU', '2');
      screen.getByText('Custo do pacote: R$ 30,00 (3 × custo do SKU)');
      digitar('Unidades no SKU', '4');
      screen.getByText('Custo do pacote indisponível: composição diferente');
    });

    it('NEW-A: unidades confirmadas para o SKU A não valem para o SKU B vinculado depois no mesmo anúncio', () => {
      const skuB = soSku(6);
      skuB.custo = { ...skuB.custo, variacaoId: 'vB', codigo: '00456' };
      const { rerender } = montar(soSku(6));
      digitar('Unidades no SKU', '2');
      screen.getByText('Custo do pacote: R$ 30,00 (3 × custo do SKU)');
      rerender(<MinhaMargem entrada={ENTRADA} dados={skuB} analisar={vi.fn()} onDados={() => {}} />);
      expect((screen.getByLabelText('Unidades no SKU') as HTMLInputElement).value).toBe('');
      screen.getByText('Custo do pacote indisponível: composição não confirmada');
      expect(tipo('Clássico').getAllByText('—').length).toBe(3); // custo, lucro, margem
    });

    it('os dois desconhecidos: pede os dois campos; só um preenchido não basta', () => {
      montar(semQtd(null));
      digitar('Unidades por anúncio', '24');
      screen.getByText('Custo do pacote indisponível: composição não confirmada');
      digitar('Unidades no SKU', '24');
      screen.getByText('Custo do pacote: R$ 10,00'); // caixa de 24 × anúncio de 24 → 1 caixa
    });
  });

  it('SKU vinculado sem origem: "SKU sem origem cadastrada", não pede custo', () => {
    montar(resposta({
      custo: { fonte: 'vinculo_manual', variacaoId: 'vA', codigo: '00123', origem: null, unidadesPorPacote: 1, unidadesSku: 1, custoSku: 30, fator: 1, faltaUnidades: null, custoPacote: { estado: 'ok', valor: 30 } },
    }));
    expect(screen.queryByLabelText('Custo do pacote (R$)')).toBeNull();
    expect(screen.queryByText(/Informe o custo/)).toBeNull();
    tipo('Clássico').getByText(/SKU sem origem cadastrada/);
    tipo('Premium').getByText(/SKU sem origem cadastrada/);
  });

  it('editar o preço recalcula na hora e só chama o servidor após 1,5 s', async () => {
    vi.useFakeTimers();
    const analisar = vi.fn(async () => ({ ok: true as const, dados: resposta() }));
    montar(resposta({
      custo: { fonte: 'catalogo', variacaoId: 'vA', codigo: '00123', origem: 'nacional', unidadesPorPacote: 1, unidadesSku: 1, custoSku: 30, fator: 1, faltaUnidades: null, custoPacote: { estado: 'ok', valor: 30 } },
    }), analisar);
    fireEvent.change(screen.getByLabelText('Preço (R$)'), { target: { value: '200' } });
    tipo('Clássico').getByText('R$ 152,00'); // local: 200 − 20 (10%) − 8 (4%) − 20 (frete)
    expect(screen.getAllByText('Estimativa')).toHaveLength(2);
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

  describe('Codex #11: resultado inteiro é "Estimativa" enquanto o preço difere do confirmado', () => {
    const VINC = { fonte: 'catalogo', variacaoId: 'vA', codigo: '00123', origem: 'nacional', unidadesPorPacote: 1, unidadesSku: 1, custoSku: 30, fator: 1, faltaUnidades: null, custoPacote: { estado: 'ok', valor: 30 } } as const;
    /** Resposta do servidor ao preço `p` (a comissão muda de faixa acima de 150). */
    const doServidor = (p: number) => {
      const r = resposta({ custo: { ...VINC } });
      r.margem = { preco: p, classico: { estado: 'indisponivel', motivo: 'x' }, premium: { estado: 'indisponivel', motivo: 'x' } };
      r.parametros.classico = { estado: 'ok', valor: { percentual: p > 150 ? 13 : 10, fixa: 0 } };
      return r;
    };
    function Harness({ analisar }: { analisar: (p: number) => Promise<Resposta<RespostaAnuncio>> }) {
      const [dados, setDados] = useState(doServidor(100));
      return <MinhaMargem entrada={ENTRADA} dados={dados} analisar={analisar} onDados={setDados} />;
    }
    const estimativas = () => screen.queryAllByText('Estimativa');
    const comissao = () => tipo('Clássico').getByText('Comissão').nextElementSibling!.textContent;
    const confirmar = async (ms = 1500) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

    it('preço confirmado: sem rótulo; editado: os dois tipos rotulados (comissão e frete); confirmado em outra faixa: comissão nova, sem rótulo', async () => {
      vi.useFakeTimers();
      render(<Harness analisar={async (p) => ({ ok: true, dados: doServidor(p) })} />);
      expect(estimativas()).toHaveLength(0);
      fireEvent.change(screen.getByLabelText('Preço (R$)'), { target: { value: '200' } });
      expect(estimativas()).toHaveLength(2); // Clássico e Premium
      expect(comissao()).toBe('R$ 20,00'); // local, com a faixa antiga (10%)
      screen.getByText(/comissão e o frete/);
      await confirmar();
      expect(estimativas()).toHaveLength(0);
      expect(comissao()).toBe('R$ 26,00'); // 13% confirmado pelo servidor
    });

    it('confirmação que falha mantém o rótulo', async () => {
      vi.useFakeTimers();
      render(<Harness analisar={async () => ({ ok: false, erro: 'interno' })} />);
      fireEvent.change(screen.getByLabelText('Preço (R$)'), { target: { value: '200' } });
      await confirmar();
      screen.getByRole('alert');
      expect(estimativas()).toHaveLength(2);
    });

    it('resposta fora de ordem é ignorada: vale a do último preço', async () => {
      vi.useFakeTimers();
      const pendentes = new Map<number, (r: Resposta<RespostaAnuncio>) => void>();
      const analisar = (p: number) => new Promise<Resposta<RespostaAnuncio>>((ok) => { pendentes.set(p, ok); });
      render(<Harness analisar={analisar} />);
      fireEvent.change(screen.getByLabelText('Preço (R$)'), { target: { value: '120' } });
      await confirmar();
      fireEvent.change(screen.getByLabelText('Preço (R$)'), { target: { value: '200' } });
      await confirmar();
      await act(async () => { pendentes.get(200)!({ ok: true, dados: doServidor(200) }); });
      await act(async () => { pendentes.get(120)!({ ok: true, dados: doServidor(120) }); });
      expect(estimativas()).toHaveLength(0);
      expect(comissao()).toBe('R$ 26,00');
    });
  });
});
