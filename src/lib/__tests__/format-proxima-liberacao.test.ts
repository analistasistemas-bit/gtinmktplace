import { describe, expect, it } from 'vitest';
import { formatProximaLiberacao } from '../resumo-vendas';

// Datas em horário local (não UTC) para o teste valer em qualquer timezone de execução.
const agora = new Date(2026, 6, 19, 10, 0, 0);

describe('formatProximaLiberacao', () => {
  it('mostra a hora quando a liberação é ainda hoje', () => {
    const maisTarde = new Date(2026, 6, 19, 14, 0, 0);
    const horaEsperada = maisTarde.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    expect(formatProximaLiberacao(maisTarde.toISOString(), agora)).toBe(`próxima hoje às ${horaEsperada}`);
  });

  it('mostra só a data quando a liberação é em outro dia', () => {
    const outroDia = new Date(2026, 6, 20, 9, 0, 0);
    expect(formatProximaLiberacao(outroDia.toISOString(), agora)).toBe(
      `próxima em ${outroDia.toLocaleDateString('pt-BR')}`
    );
  });
});
