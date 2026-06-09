import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CardCategoria } from '@/components/card-categoria';
import type { Familia } from '@/lib/tipos-dominio';

function familiaBase(over: Partial<Familia> = {}): Familia {
  return {
    id: 'f1', loteId: 'l1', codigoPai: '00445975',
    titulo: 'FITA CETIM N.3', descricao: '', operacao: 'CREATE',
    estrategiaPreco: 'PROPRIO', estrategiaMotivo: '',
    concorrencia: 'alta', concorrenciaVendedores: 6, concorrenciaPrecoMin: 12.62,
    tipoAviamento: 'fita', categoriaMlId: 'MLB255054',
    precoMin: 2.95, precoMax: 2.95, precoAbaixo20pc: false,
    capaStoragePath: null, variacoes: [], status: 'pronto',
    tokensInput: null, tokensOutput: null, custoCentavos: null,
    tituloEditadoPeloOperador: false, descricaoEditadaPeloOperador: false,
    variacoesSemCor: 0, analiseMercado: null,
    ...over,
  };
}

describe('CardCategoria', () => {
  it('categoria definida mostra nome amigável + id', () => {
    render(<CardCategoria familia={familiaBase()} />);
    expect(screen.getByText(/Fita de Cetim/i)).toBeInTheDocument();
    expect(screen.getByText(/MLB255054/)).toBeInTheDocument();
  });

  it('categoria indefinida (tipo outro / sem id) alerta', () => {
    render(<CardCategoria familia={familiaBase({ tipoAviamento: 'outro', categoriaMlId: null })} />);
    expect(screen.getByText(/categoria indefinida/i)).toBeInTheDocument();
  });
});
