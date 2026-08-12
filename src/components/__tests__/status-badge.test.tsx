// Card do Dashboard: lote #46 exibia o badge verde "Concluído" ao lado de "0 publicadas · 1 erro".
// Mesma regra do stepper do Relatório (loteFalhouNaPublicacao), para os dois não divergirem.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StatusBadge } from '../status-badge';

afterEach(cleanup);

describe('StatusBadge', () => {
  it('lote concluído sem nada publicado vira "Não publicado"', () => {
    render(<StatusBadge status="concluido" resultado={{ publicadas: 0, erros: 1 }} />);
    expect(screen.getByText('Não publicado')).toBeInTheDocument();
    expect(screen.queryByText('Concluído')).not.toBeInTheDocument();
  });

  it('lote concluído com publicação parcial segue "Concluído"', () => {
    render(<StatusBadge status="concluido" resultado={{ publicadas: 2, erros: 1 }} />);
    expect(screen.getByText('Concluído')).toBeInTheDocument();
  });

  it('sem resultado informado o badge segue só o status', () => {
    render(<StatusBadge status="concluido" />);
    expect(screen.getByText('Concluído')).toBeInTheDocument();
  });

  it('demais status não são afetados', () => {
    render(<StatusBadge status="revisao" resultado={{ publicadas: 0, erros: 3 }} />);
    expect(screen.getByText('Em revisão')).toBeInTheDocument();
  });
});
