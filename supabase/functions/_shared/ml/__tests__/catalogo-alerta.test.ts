import { describe, it, expect } from 'vitest';
import { deveAlertarCatalogoNoMatch, type ResumoCatalogo } from '../catalogo';
import { montarMensagemCatalogoNoMatch } from '../../notificacoes/telegram';

const base: ResumoCatalogo = {
  vinculado: 0, sem_produto: 0, family_diff: 0, nao_elegivel: 0,
  pendente: 0, erro: 0, pulou: 0, ficha_divergente: 0,
  sem_variation_id: 0,
};

describe('deveAlertarCatalogoNoMatch', () => {
  it('alerta quando há ficha_divergente e elegibilidade já computada (pendente=0)', () => {
    expect(deveAlertarCatalogoNoMatch({ ...base, ficha_divergente: 1 })).toBe(true);
  });

  it('alerta quando há sem_produto e pendente=0', () => {
    expect(deveAlertarCatalogoNoMatch({ ...base, sem_produto: 1 })).toBe(true);
  });

  it('alerta quando nao_elegivel sobrou e pendente=0 (retry já esgotado é decidido por fora)', () => {
    expect(deveAlertarCatalogoNoMatch({ ...base, nao_elegivel: 2 })).toBe(true);
  });

  it('alerta quando sem_variation_id sobrou (estrutural, sempre alerta)', () => {
    expect(deveAlertarCatalogoNoMatch({ ...base, sem_variation_id: 2 })).toBe(true);
  });

  it('NÃO alerta enquanto a elegibilidade ainda computa (pendente>0) — evita alerta prematuro/repetido', () => {
    expect(deveAlertarCatalogoNoMatch({ ...base, ficha_divergente: 1, pendente: 2 })).toBe(false);
  });

  it('NÃO alerta quando todas as variações vincularam ou foram puladas', () => {
    expect(deveAlertarCatalogoNoMatch({ ...base, vinculado: 3 })).toBe(false);
    expect(deveAlertarCatalogoNoMatch({ ...base, pulou: 3 })).toBe(false);
  });
});

it('categoriza alerta de elegibilidade esgotada', () => {
  const mensagem = montarMensagemCatalogoNoMatch({
    ml_item_id: 'MLB123', titulo: 'Produto', cores: ['Azul'], motivo: 'elegibilidade_esgotada',
  });

  expect(mensagem).toContain('elegibilidade esgotada após múltiplas tentativas');
});
