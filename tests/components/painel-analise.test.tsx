import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PainelAnalise } from '@/components/painel-analise';
import type { Familia } from '@/lib/tipos-dominio';

function familiaBase(over: Partial<Familia> = {}): Familia {
  return {
    id: 'f1', loteId: 'l1', codigoPai: '00445975',
    titulo: 'FITA CETIM N.3', descricao: '', operacao: 'CREATE',
    estrategiaPreco: 'PROPRIO', estrategiaMotivo: 'nosso preço já é mais competitivo que o mercado',
    concorrencia: 'alta', concorrenciaVendedores: 6, concorrenciaPrecoMin: 12.62,
    tipoAviamento: 'fita', categoriaMlId: 'MLB255054',
    precoMin: 2.95, precoMax: 2.95, precoAbaixo20pc: false,
    capaStoragePath: null, variacoes: [], status: 'pronto',
    tokensInput: null, tokensOutput: null, custoCentavos: null,
    tituloEditadoPeloOperador: false, descricaoEditadaPeloOperador: false,
    variacoesSemCor: 0,
    analiseMercado: {
      preco_max: 17.02, total_ofertas: 8, frete_gratis: 0, full: 0,
      lideres: 4, maior_vendas: 52000, ranking_categoria: null, produto_desde: '2024-03-05',
    },
    ...over,
  };
}

describe('PainelAnalise', () => {
  it('estratégia PRÓPRIO com motivo', () => {
    render(<PainelAnalise familia={familiaBase()} />);
    expect(screen.getByText('PRÓPRIO')).toBeInTheDocument();
    expect(screen.getByText(/já é mais competitivo/i)).toBeInTheDocument();
  });

  it('estratégia COMPETITIVO', () => {
    render(<PainelAnalise familia={familiaBase({ estrategiaPreco: 'COMPETITIVO', estrategiaMotivo: 'concorrência presente — bater menor preço' })} />);
    expect(screen.getByText('COMPETITIVO')).toBeInTheDocument();
  });

  it('concorrência alta mostra vendedores e menor preço', () => {
    render(<PainelAnalise familia={familiaBase()} />);
    expect(screen.getByText(/alta/i)).toBeInTheDocument();
    expect(screen.getByText(/6 vendedores/i)).toBeInTheDocument();
    expect(screen.getAllByText(/12,62/).length).toBeGreaterThan(0);
  });

  it('concorrência sem → "sem concorrência"', () => {
    render(<PainelAnalise familia={familiaBase({ concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null })} />);
    expect(screen.getByText(/sem concorrência/i)).toBeInTheDocument();
  });

  it('categoria definida mostra nome amigável + id', () => {
    render(<PainelAnalise familia={familiaBase()} />);
    expect(screen.getByText(/Fita de Cetim/i)).toBeInTheDocument();
    expect(screen.getByText(/MLB255054/)).toBeInTheDocument();
  });

  it('categoria indefinida (tipo outro / sem id) alerta', () => {
    render(<PainelAnalise familia={familiaBase({ tipoAviamento: 'outro', categoriaMlId: null })} />);
    expect(screen.getByText(/categoria indefinida/i)).toBeInTheDocument();
  });

  it('alerta de preço perigoso só quando precoAbaixo20pc', () => {
    const { rerender } = render(<PainelAnalise familia={familiaBase()} />);
    expect(screen.queryByText(/abaixo do m[íi]nimo/i)).not.toBeInTheDocument();
    rerender(<PainelAnalise familia={familiaBase({ precoAbaixo20pc: true })} />);
    expect(screen.getByText(/abaixo do m[íi]nimo/i)).toBeInTheDocument();
  });

  it('mostra potencial de venda com força e faixa de preço', () => {
    render(<PainelAnalise familia={familiaBase()} />);
    expect(screen.getByText(/potencial de venda/i)).toBeInTheDocument();
    expect(screen.getByText(/4\/6 mercadol[íi]der/i)).toBeInTheDocument();
    expect(screen.getByText(/52 mil/i)).toBeInTheDocument();
    expect(screen.getByText(/17,02/)).toBeInTheDocument();
    expect(screen.getByText(/fora do top/i)).toBeInTheDocument();
  });

  it('mostra posição no ranking quando existe', () => {
    render(<PainelAnalise familia={familiaBase({ analiseMercado: { ...familiaBase().analiseMercado!, ranking_categoria: 3 } })} />);
    expect(screen.getByText(/#3/)).toBeInTheDocument();
  });

  it('sem analiseMercado → card de potencial não aparece', () => {
    render(<PainelAnalise familia={familiaBase({ analiseMercado: null })} />);
    expect(screen.queryByText(/potencial de venda/i)).not.toBeInTheDocument();
  });
});
