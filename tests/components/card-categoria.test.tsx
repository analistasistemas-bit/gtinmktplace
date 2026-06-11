import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CardCategoria } from '@/components/card-categoria';
import type { Familia } from '@/lib/tipos-dominio';

// CardCategoria usa useMutation (seletor manual de categoria) → precisa de QueryClient.
function renderCard(familia: Familia) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CardCategoria familia={familia} />
    </QueryClientProvider>,
  );
}

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
    renderCard(familiaBase());
    expect(screen.getByText(/Fita de Cetim/i)).toBeInTheDocument();
    expect(screen.getByText(/MLB255054/)).toBeInTheDocument();
  });

  it('categoria indefinida (tipo outro / sem id) alerta + oferece seletor', () => {
    renderCard(familiaBase({ tipoAviamento: 'outro', categoriaMlId: null }));
    expect(screen.getByText(/categoria indefinida/i)).toBeInTheDocument();
    expect(screen.getByText(/escolher categoria/i)).toBeInTheDocument();
  });

  it('cola: mostra "Bastões de Cola" quando definida', () => {
    renderCard(familiaBase({ tipoAviamento: 'cola', categoriaMlId: 'MLB277319' }));
    expect(screen.getByText(/Bastões de Cola/i)).toBeInTheDocument();
    expect(screen.getByText(/MLB277319/)).toBeInTheDocument();
  });
});
