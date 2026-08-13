import { describe, it, expect } from 'vitest';
import { deveAlertarCatalogoNoMatch, decidirMotivoAlertaCatalogo, type ResumoCatalogo } from '../catalogo';
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

  it('alerta com pendente residual (a garantia de "1 alerta por publicação" vive no gate de finalizar do worker, não aqui)', () => {
    expect(deveAlertarCatalogoNoMatch({ ...base, pendente: 2 })).toBe(true);
    expect(deveAlertarCatalogoNoMatch({ ...base, ficha_divergente: 1, pendente: 2 })).toBe(true);
  });

  it('NÃO alerta quando todas as variações vincularam ou foram puladas', () => {
    expect(deveAlertarCatalogoNoMatch({ ...base, vinculado: 3 })).toBe(false);
    expect(deveAlertarCatalogoNoMatch({ ...base, pulou: 3 })).toBe(false);
  });
});

describe('decidirMotivoAlertaCatalogo — elegibilidade_nao_resolvida', () => {
  it('pendente sobrevivente até a última tentativa → elegibilidade_nao_resolvida', () => {
    expect(decidirMotivoAlertaCatalogo({ ...base, pendente: 2 })).toBe('elegibilidade_nao_resolvida');
  });

  it('ficha_divergente/sem_produto têm precedência (mensagem genérica de no-match)', () => {
    expect(decidirMotivoAlertaCatalogo({ ...base, pendente: 2, ficha_divergente: 1 })).toBeUndefined();
  });

  it('pendente misturado com nao_elegivel → elegibilidade_nao_resolvida (o caso mais incerto manda)', () => {
    expect(decidirMotivoAlertaCatalogo({ ...base, pendente: 1, nao_elegivel: 2 })).toBe('elegibilidade_nao_resolvida');
  });
});

it('mensagem do novo motivo cita a elegibilidade sem resposta', () => {
  const mensagem = montarMensagemCatalogoNoMatch({
    ml_item_id: 'MLB123', titulo: 'Produto', cores: ['Azul'], motivo: 'elegibilidade_nao_resolvida',
  });
  expect(mensagem).toContain('sem resposta de elegibilidade');
});

it('categoriza alerta de elegibilidade esgotada', () => {
  const mensagem = montarMensagemCatalogoNoMatch({
    ml_item_id: 'MLB123', titulo: 'Produto', cores: ['Azul'], motivo: 'elegibilidade_esgotada',
  });

  expect(mensagem).toContain('elegibilidade esgotada após múltiplas tentativas');
});
