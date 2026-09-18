import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ViabilidadeLinha } from '../viabilidade-linha';
import type { ItemAnalisado } from '@/lib/viabilidade';

vi.mock('@/hooks/useConfiguracoes', () => ({
  useAliquotas: () => ({ data: { nacional: 8, importado: 16 } }),
}));

vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => ({ data: [] }),
}));

vi.mock('@/components/estoque/dialog-cadastro-produto', () => ({
  DialogCadastroProduto: () => null,
}));

const SEM_RELEVANTE = {
  gtin: '7891025111825',
  nome: 'Aptamil Premium 1',
  unidade: null,
  minimo: null,
  custo: null,
  origem: 'nacional',
  existeNoML: true,
  mercado: {
    menor: null,
    maior: null,
    vendedores: 0,
    freteGratis: 0,
    full: 0,
    ofertas: 0,
    observado: { menor: 36, maior: 81.45, vendedores: 2, ofertas: 2 },
  },
} as unknown as ItemAnalisado;

const COM_RELEVANTE = {
  ...SEM_RELEVANTE,
  mercado: {
    menor: 70.19,
    maior: 81.45,
    vendedores: 1,
    freteGratis: 1,
    full: 1,
    ofertas: 1,
    observado: { menor: 36, maior: 81.45, vendedores: 2, ofertas: 2 },
  },
  classico: { saleFeeAmount: 10, percentual: 14, fixa: 0 },
  premium: { saleFeeAmount: 12, percentual: 18, fixa: 0 },
  frete: 8,
} as unknown as ItemAnalisado;

function renderLinha(item: ItemAnalisado, mlConectado?: boolean) {
  return render(
    <MemoryRouter>
      <table><tbody><ViabilidadeLinha item={item} editavel={false} mlConectado={mlConectado} /></tbody></table>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('ViabilidadeLinha — mercado relevante', () => {
  it('mostra estado sem concorrente relevante sem inventar preço ou derivados', () => {
    renderLinha(SEM_RELEVANTE);

    expect(screen.getByText('Sem concorrente relevante')).toBeInTheDocument();
    expect(screen.getByText('0 de 2')).toBeInTheDocument();
    expect(screen.queryByText('R$ 0,00')).toBeNull();
    expect(screen.queryByText('Clássico')).toBeNull();
    expect(screen.queryByText('Premium')).toBeNull();

    fireEvent.click(screen.getByText('Aptamil Premium 1'));
    expect(screen.getByText('Menor observado: R$ 36,00')).toBeInTheDocument();
    expect(screen.queryByText('Frete (vendedor)')).toBeNull();
    expect(screen.queryByText('Clássico')).toBeNull();
    expect(screen.queryByText('Premium')).toBeNull();
  });

  it('exibe o menor relevante e mantém o observado apenas no detalhe', () => {
    renderLinha(COM_RELEVANTE);

    expect(screen.getByText('R$ 70,19')).toBeInTheDocument();
    expect(screen.getByText('1 de 2')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Aptamil Premium 1'));
    expect(screen.getByText('Menor observado: R$ 36,00')).toBeInTheDocument();
  });

  it('não quebra com payload legado sem observado (edge ainda não implantada)', () => {
    const legado = {
      ...SEM_RELEVANTE,
      mercado: { menor: null, maior: null, vendedores: 0, freteGratis: 0, full: 0, ofertas: 0 },
    } as unknown as ItemAnalisado;

    expect(() => renderLinha(legado)).not.toThrow();
    expect(screen.getByText('0 de —')).toBeInTheDocument();
    expect(screen.getByText('Sem concorrente relevante')).toBeInTheDocument();
  });
  // Sem conta ML conectada o zero relevante é consequência da conexão que falta, não do
  // mercado — a célula não pode afirmar que não existe concorrente relevante (incidente
  // 2026-09-18). O aviso da causa fica no topo da página.
  it('não afirma "sem concorrente relevante" quando a org não tem conta ML', () => {
    renderLinha(SEM_RELEVANTE, false);

    expect(screen.queryByText('Sem concorrente relevante')).toBeNull();
    expect(screen.getByTitle(/conta do Mercado Livre/i)).toBeInTheDocument();

    // O detalhe expandido repete o mesmo texto: deixar só a célula honesta faria a linha
    // mudar de versão a um clique de distância.
    fireEvent.click(screen.getByText('Aptamil Premium 1'));
    expect(screen.queryByText('Sem concorrente relevante')).toBeNull();
    expect(screen.getAllByTitle(/conta do Mercado Livre/i)).toHaveLength(2);
  });

  it('mantém o texto de mercado quando a conta ML está conectada', () => {
    renderLinha(SEM_RELEVANTE, true);

    expect(screen.getByText('Sem concorrente relevante')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Aptamil Premium 1'));
    expect(screen.getAllByText('Sem concorrente relevante')).toHaveLength(2);
  });
});
