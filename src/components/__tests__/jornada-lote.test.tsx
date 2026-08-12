// Lote #46: o stepper do Relatório acendia as 4 etapas em verde — "Publicado" incluso — na
// mesma tela que mostrava "0 publicada(s)" e "1 com erro". O status do lote (`concluido`)
// significa "terminou de rodar", não "publicou".
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { JornadaLote } from '../jornada-lote';

afterEach(cleanup);

describe('JornadaLote', () => {
  it('lote concluído sem nada publicado mostra "Não publicado", não "Publicado"', () => {
    render(<JornadaLote status="concluido" resultado={{ publicadas: 0, erros: 1 }} />);
    expect(screen.getByText('Não publicado')).toBeInTheDocument();
    expect(screen.queryByText('Publicado')).not.toBeInTheDocument();
    // A etapa em erro é a atual — não uma etapa vencida.
    expect(screen.getByText('Não publicado').previousSibling).toHaveAttribute('aria-current', 'step');
  });

  it('lote concluído com publicação mostra "Publicado" e nenhuma etapa atual', () => {
    render(<JornadaLote status="concluido" resultado={{ publicadas: 3, erros: 0 }} />);
    expect(screen.getByText('Publicado')).toBeInTheDocument();
    expect(screen.queryByText('Não publicado')).not.toBeInTheDocument();
  });

  it('sem resultado informado o stepper segue só o status (Revisão, Progresso, Dashboard)', () => {
    render(<JornadaLote status="concluido" />);
    expect(screen.getByText('Publicado')).toBeInTheDocument();
  });
});
