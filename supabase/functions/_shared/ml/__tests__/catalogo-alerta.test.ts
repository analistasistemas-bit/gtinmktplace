import { describe, it, expect } from 'vitest';
import { deveAlertarCatalogoNoMatch, type ResumoCatalogo } from '../catalogo';

const base: ResumoCatalogo = {
  vinculado: 0, sem_produto: 0, family_diff: 0, nao_elegivel: 0,
  pendente: 0, erro: 0, pulou: 0, ficha_divergente: 0,
};

describe('deveAlertarCatalogoNoMatch', () => {
  it('alerta quando há ficha_divergente e elegibilidade já computada (pendente=0)', () => {
    expect(deveAlertarCatalogoNoMatch({ ...base, ficha_divergente: 1 })).toBe(true);
  });

  it('alerta quando há sem_produto e pendente=0', () => {
    expect(deveAlertarCatalogoNoMatch({ ...base, sem_produto: 1 })).toBe(true);
  });

  it('NÃO alerta enquanto a elegibilidade ainda computa (pendente>0) — evita alerta prematuro/repetido', () => {
    expect(deveAlertarCatalogoNoMatch({ ...base, ficha_divergente: 1, pendente: 2 })).toBe(false);
  });

  it('NÃO alerta quando todas as variações vincularam ou foram puladas', () => {
    expect(deveAlertarCatalogoNoMatch({ ...base, vinculado: 3 })).toBe(false);
    expect(deveAlertarCatalogoNoMatch({ ...base, pulou: 3 })).toBe(false);
  });
});
