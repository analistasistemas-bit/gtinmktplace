import { describe, expect, it, vi } from 'vitest';
import { reversaoAlterarValida, semaforoNoPreco, semaforoReal, validarPedido, type LinhaCentral } from '../validar.ts';
import type { ProjecaoCor, Semaforo } from '../../promocoes/tipos.ts';

// 12% de comissão, 8% de imposto, sem frete: líquido = 0,8 × preço. Custo 10, piso 12.
const cor = (o: Partial<ProjecaoCor> = {}): ProjecaoCor => ({
  variation_id: null, cor: null, sku: null, custo: 10, piso: 12, origem: 'nacional',
  comissao_pct: 12, comissao_fixa: 0, frete: 0, aliquota_pct: 8,
  liquido: 12, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null, ...o,
});
const linha = (o: Partial<LinhaCentral> = {}): LinhaCentral => ({
  ml_item_id: 'MLB1', status: 'candidate', titulo: 'Caneca', preco_original: 20, preco_min: 7, preco_max: 18.99,
  preco_sugerido: 15, preco_promo: null, preco_avaliado: 15, projecao: [cor()], ...o,
});
const central = (...ls: LinhaCentral[]) => new Map(ls.map((l) => [l.ml_item_id, l]));
const semExato = () => Promise.reject(new Error('não deveria calcular tarifa exata'));

describe('semaforoNoPreco', () => {
  it('líquido no preço com a tarifa da projeção', () => {
    expect(semaforoNoPreco([cor()], 15)).toBe('verde');     // 12 ≥ piso
    expect(semaforoNoPreco([cor()], 14)).toBe('amarelo');   // 11,2 entre custo e piso
    expect(semaforoNoPreco([cor()], 12)).toBe('vermelho');  // 9,6 < custo
  });
  it('cor sem custo → indisponivel; pior entre as cores com dado', () => {
    expect(semaforoNoPreco([cor({ custo: null })], 15)).toBe('indisponivel');
    expect(semaforoNoPreco([cor(), cor({ custo: 13, piso: 14 })], 15)).toBe('vermelho');
  });
  it('sem projeção ou sem preço → indisponivel', () => {
    expect(semaforoNoPreco([], 15)).toBe('indisponivel');
    expect(semaforoNoPreco([cor()], null)).toBe('indisponivel');
  });
});

describe('semaforoReal', () => {
  it('preço = avaliado usa a projeção gravada; diferente pede a tarifa exata', async () => {
    const exato = vi.fn(async (): Promise<Semaforo> => 'amarelo');
    expect(await semaforoReal(linha(), 15.001, exato)).toBe('verde');
    expect(exato).not.toHaveBeenCalled();
    expect(await semaforoReal(linha(), 14, exato)).toBe('amarelo');
    expect(exato).toHaveBeenCalledWith(expect.objectContaining({ ml_item_id: 'MLB1' }), 14);
  });
});

describe('validarPedido', () => {
  it('tipo sem contrato no motor → erro', async () => {
    const r = await validarPedido('aderir', 'OUTRO', [{ ml_item_id: 'MLB1', preco: 15 }], central(linha()), semExato);
    expect(r).toEqual({ ok: false, erro: 'Este tipo de promoção ainda não aceita operação em massa.' });
  });
  describe('LIGHTNING aderir', () => {
    // Faixa da Relâmpago: 8,70 a 26,10; sugerido 24,65 = preço avaliado.
    const rl = (o: Partial<LinhaCentral> = {}) =>
      linha({ preco_min: 8.7, preco_max: 26.1, preco_sugerido: 24.65, preco_avaliado: 24.65, ...o });
    const exatoVerde = async (): Promise<Semaforo> => 'verde';
    it('participando com convite de outro horário (emenda 2026-11-08 (2)) é aderível; participando sem convite não', async () => {
      const exatoAm = async (): Promise<Semaforo> => 'verde';
      const ok = await validarPedido('aderir', 'LIGHTNING', [{ ml_item_id: 'MLB1', preco: 24 }], central(rl({ status: 'pending', convite_aberto: true })), exatoAm);
      expect(ok.ok).toBe(true);
      const nao = await validarPedido('aderir', 'LIGHTNING', [{ ml_item_id: 'MLB1', preco: 24 }], central(rl({ status: 'pending' })), exatoAm);
      expect(nao.ok === false && nao.itens).toEqual([{ ml_item_id: 'MLB1', motivo: 'O anúncio não está como Convidado nesta promoção' }]);
    });
    it('preço fora da faixa → motivo', async () => {
      const r = await validarPedido('aderir', 'LIGHTNING', [{ ml_item_id: 'MLB1', preco: 27 }], central(rl()), semExato);
      expect(r.ok === false && r.itens).toEqual([{ ml_item_id: 'MLB1', motivo: 'Preço fora da faixa do ML (8,70 a 26,10)' }]);
    });
    it('sem faixa (visão por item falhou no sync) → recusa', async () => {
      const l = rl({ preco_max: null, preco_sugerido: null, preco_promo: null, preco_avaliado: null });
      const r = await validarPedido('aderir', 'LIGHTNING', [{ ml_item_id: 'MLB1', preco: 20, confirmado_risco: true }], central(l), semExato);
      expect(r.ok === false && r.itens).toEqual([{ ml_item_id: 'MLB1', motivo: 'O ML não informou a faixa de preço deste anúncio' }]);
    });
    it('18,99 com confirmado_risco → recusa R$ 19', async () => {
      const r = await validarPedido('aderir', 'LIGHTNING', [{ ml_item_id: 'MLB1', preco: 18.99, confirmado_risco: true }], central(rl()), exatoVerde);
      expect(r.ok === false && r.itens).toEqual([{ ml_item_id: 'MLB1', motivo: 'Abaixo de R$ 19 o comprador perde o frete grátis' }]);
    });
    it('válido → ok com o preço do pedido', async () => {
      const r = await validarPedido('aderir', 'LIGHTNING', [{ ml_item_id: 'MLB1', preco: 24.65 }], central(rl()), semExato);
      expect(r).toEqual({ ok: true, itens: [{ ml_item_id: 'MLB1', titulo: 'Caneca', preco: 24.65, semaforo: 'verde', confirmado_risco: false }] });
    });
  });
  it('lista vazia ou mais de 500 → erro', async () => {
    expect((await validarPedido('aderir', 'DEAL', [], central(), semExato)).ok).toBe(false);
    const muitos = Array.from({ length: 501 }, (_, i) => ({ ml_item_id: `MLB${i}`, preco: 15 }));
    expect(await validarPedido('aderir', 'DEAL', muitos, central(), semExato))
      .toEqual({ ok: false, erro: 'No máximo 500 anúncios por operação.' });
  });
  describe('piso de R$ 19 em todos os tipos', () => {
    const MOTIVO = 'Abaixo de R$ 19 o comprador perde o frete grátis';
    const faixa = { preco_min: 7, preco_max: 50, preco_original: 60 };
    it('DEAL aderir: 18,99 recusa, mesmo com risco confirmado; 19 passa', async () => {
      const r = await validarPedido('aderir', 'DEAL', [{ ml_item_id: 'MLB1', preco: 18.99, confirmado_risco: true }], central(linha(faixa)), semExato);
      expect(r.ok === false && r.itens).toEqual([{ ml_item_id: 'MLB1', motivo: MOTIVO }]);
      const ok = await validarPedido('aderir', 'DEAL', [{ ml_item_id: 'MLB1', preco: 19 }], central(linha({ ...faixa, preco_avaliado: 19 })), semExato);
      expect(ok.ok).toBe(true);
    });
    it('SMART aderir: oferta abaixo de 19 recusa', async () => {
      const r = await validarPedido('aderir', 'SMART', [{ ml_item_id: 'MLB1', confirmado_risco: true }], central(linha({ preco_promo: 18 })), semExato);
      expect(r.ok === false && r.itens).toEqual([{ ml_item_id: 'MLB1', motivo: MOTIVO }]);
    });
    it('alterar_preco: 18,99 recusa, mesmo com risco confirmado', async () => {
      const r = await validarPedido('alterar_preco', 'DEAL', [{ ml_item_id: 'MLB1', preco: 18.99, confirmado_risco: true }], central(linha({ status: 'started', preco_original: 60 })), semExato);
      expect(r.ok === false && r.itens).toEqual([{ ml_item_id: 'MLB1', motivo: MOTIVO }]);
    });
    it('SMART aderir sem preço da oferta recusa, mesmo com risco confirmado', async () => {
      const r = await validarPedido('aderir', 'SMART', [{ ml_item_id: 'MLB1', confirmado_risco: true }], central(linha({ preco_promo: null })), semExato);
      expect(r.ok === false && r.itens).toEqual([{ ml_item_id: 'MLB1', motivo: 'O ML não informou o preço da oferta' }]);
    });
    it('sair continua livre abaixo de 19', async () => {
      const r = await validarPedido('sair', 'DEAL', [{ ml_item_id: 'MLB1' }], central(linha({ status: 'started', preco_promo: 16.53 })), semExato);
      expect(r.ok).toBe(true);
    });
  });
  it('DEAL: preço fora da faixa ou ausente → motivo', async () => {
    const r = await validarPedido('aderir', 'DEAL', [{ ml_item_id: 'MLB1', preco: 19.5 }], central(linha()), semExato);
    expect(r).toEqual({ ok: false, erro: 'Alguns anúncios não podem entrar na operação.',
      itens: [{ ml_item_id: 'MLB1', motivo: 'Preço fora da faixa do ML (7,00 a 18,99)' }] });
    const s = await validarPedido('aderir', 'DEAL', [{ ml_item_id: 'MLB1' }], central(linha()), semExato);
    expect(s.ok === false && s.itens).toEqual([{ ml_item_id: 'MLB1', motivo: 'Informe o preço da oferta' }]);
  });
  it('vermelho sem confirmação → motivo com o semáforo real; com confirmação → ok', async () => {
    const exato = async (): Promise<Semaforo> => 'vermelho';
    const r = await validarPedido('aderir', 'DEAL', [{ ml_item_id: 'MLB1', preco: 19 }], central(linha({ preco_max: 50 })), exato);
    expect(r.ok === false && r.itens).toEqual([{ ml_item_id: 'MLB1', semaforo: 'vermelho',
      motivo: 'Resultado vermelho ou sem cálculo: confirme o risco para incluir' }]);
    const ok = await validarPedido('aderir', 'DEAL', [{ ml_item_id: 'MLB1', preco: 19, confirmado_risco: true }], central(linha({ preco_max: 50 })), exato);
    expect(ok).toEqual({ ok: true, itens: [{ ml_item_id: 'MLB1', titulo: 'Caneca', preco: 19, semaforo: 'vermelho', confirmado_risco: true }] });
  });
  it('indisponivel também exige confirmação', async () => {
    const l = linha({ projecao: [cor({ custo: null })], preco_max: 50, preco_avaliado: 19 });
    const r = await validarPedido('aderir', 'DEAL', [{ ml_item_id: 'MLB1', preco: 19 }], central(l), semExato);
    expect(r.ok === false && r.itens?.[0].semaforo).toBe('indisponivel');
  });
  it('sair de item convidado → motivo; sair de participando não pede semáforo', async () => {
    const r = await validarPedido('sair', 'DEAL', [{ ml_item_id: 'MLB1' }], central(linha()), semExato);
    expect(r.ok === false && r.itens).toEqual([{ ml_item_id: 'MLB1', motivo: 'O anúncio não está Participando desta promoção' }]);
    const ok = await validarPedido('sair', 'DEAL', [{ ml_item_id: 'MLB1' }], central(linha({ status: 'started', projecao: [] })), semExato);
    expect(ok).toEqual({ ok: true, itens: [{ ml_item_id: 'MLB1', titulo: 'Caneca', preco: null, semaforo: null, confirmado_risco: false }] });
  });
  it('aderir item já participando → motivo', async () => {
    const r = await validarPedido('aderir', 'DEAL', [{ ml_item_id: 'MLB1', preco: 15 }], central(linha({ status: 'pending' })), semExato);
    expect(r.ok === false && r.itens?.[0].motivo).toBe('O anúncio não está como Convidado nesta promoção');
  });
  it('SMART aderir usa preco_promo (ignora o preço enviado)', async () => {
    const l = linha({ preco_sugerido: null, preco_promo: 19, preco_avaliado: 19, preco_min: null, preco_max: null });
    const r = await validarPedido('aderir', 'SMART', [{ ml_item_id: 'MLB1', preco: 3 }], central(l), semExato);
    expect(r).toEqual({ ok: true, itens: [{ ml_item_id: 'MLB1', titulo: 'Caneca', preco: 19, semaforo: 'verde', confirmado_risco: false }] });
  });
  it('fora da Central e repetido → motivo', async () => {
    const r = await validarPedido('aderir', 'DEAL',
      [{ ml_item_id: 'MLB1', preco: 19 }, { ml_item_id: 'MLB1', preco: 19 }, { ml_item_id: 'MLB9', preco: 19 }], central(linha({ preco_max: 50, preco_avaliado: 19 })), semExato);
    expect(r.ok === false && r.itens).toEqual([
      { ml_item_id: 'MLB1', motivo: 'Anúncio repetido no pedido' },
      { ml_item_id: 'MLB9', motivo: 'O anúncio não está nesta promoção na Central' },
    ]);
  });
});

// Achado Codex P1: Reverter de alterar_preco validado no servidor contra a origem.
describe('reversaoAlterarValida', () => {
  const origem = [
    { ml_item_id: 'A', status: 'aplicado', preco: 43.9, preco_anterior: 49.9 },
    { ml_item_id: 'B', status: 'erro', preco: 43.9, preco_anterior: 49.9 },
    { ml_item_id: 'C', status: 'aplicado', preco: 43.9, preco_anterior: null },
  ];
  it('item aplicado da origem, no preço anterior → aceito com o preço que a origem deixou como esperado', () => {
    expect(reversaoAlterarValida([{ ml_item_id: 'A', preco: 49.9 }], origem))
      .toEqual({ esperados: new Map([['A', 43.9]]), recusas: [] });
  });
  it('fora da origem, não aplicado, sem preço anterior ou preço diferente do anterior → recusa', () => {
    const r = reversaoAlterarValida(
      [{ ml_item_id: 'X', preco: 10 }, { ml_item_id: 'B', preco: 49.9 }, { ml_item_id: 'C', preco: 49.9 }, { ml_item_id: 'A', preco: 45 }], origem);
    expect(r.recusas).toEqual([
      { ml_item_id: 'X', motivo: 'O anúncio não foi alterado pela operação de origem' },
      { ml_item_id: 'B', motivo: 'O anúncio não foi alterado pela operação de origem' },
      { ml_item_id: 'C', motivo: 'Sem preço anterior registrado para reverter' },
      { ml_item_id: 'A', motivo: 'O Reverter volta ao preço anterior (49,90)' },
    ]);
  });
});

// Emenda ADR-0174 (2026-11-03): alterar o preço de item DEAL participando (faixa não existe para participante).
describe('validarPedido — alterar_preco', () => {
  const part = (o: Partial<LinhaCentral> = {}) => linha({ status: 'started', preco_min: null, preco_max: null, preco_promo: 16, preco_avaliado: 16, ...o });
  const exatoVerde = vi.fn(async () => 'verde' as Semaforo);

  it('participando DEAL: aceita, preço normalizado a centavos e semáforo exato no preço novo', async () => {
    const r = await validarPedido('alterar_preco', 'DEAL', [{ ml_item_id: 'MLB1', preco: 19.004 }], central(part()), exatoVerde);
    expect(r).toEqual({ ok: true, itens: [{ ml_item_id: 'MLB1', titulo: 'Caneca', preco: 19, semaforo: 'verde', confirmado_risco: false }] });
  });
  it('não DEAL, convidado, sem preço ou preço ≥ original → recusa com motivo', async () => {
    expect(await validarPedido('alterar_preco', 'LIGHTNING', [{ ml_item_id: 'MLB1', preco: 15 }], central(part()), exatoVerde))
      .toMatchObject({ ok: false, itens: [{ motivo: 'Só campanhas tradicionais aceitam alterar o preço' }] });
    expect(await validarPedido('alterar_preco', 'DEAL', [{ ml_item_id: 'MLB1', preco: 15 }], central(linha()), exatoVerde))
      .toMatchObject({ ok: false, itens: [{ motivo: 'O anúncio não está Participando desta promoção' }] });
    expect(await validarPedido('alterar_preco', 'DEAL', [{ ml_item_id: 'MLB1', preco: 0 }], central(part()), exatoVerde))
      .toMatchObject({ ok: false, itens: [{ motivo: 'Informe o preço da oferta' }] });
    expect(await validarPedido('alterar_preco', 'DEAL', [{ ml_item_id: 'MLB1', preco: 20 }], central(part()), exatoVerde))
      .toMatchObject({ ok: false, itens: [{ motivo: 'O preço da promoção precisa ser menor que o original (20,00)' }] });
  });
  it('trava financeira: vermelho sem risco confirmado → recusa; com risco → aceita', async () => {
    const exatoVermelho = vi.fn(async () => 'vermelho' as Semaforo);
    expect(await validarPedido('alterar_preco', 'DEAL', [{ ml_item_id: 'MLB1', preco: 19 }], central(part()), exatoVermelho))
      .toMatchObject({ ok: false, itens: [{ semaforo: 'vermelho' }] });
    expect(await validarPedido('alterar_preco', 'DEAL', [{ ml_item_id: 'MLB1', preco: 19, confirmado_risco: true }], central(part()), exatoVermelho))
      .toMatchObject({ ok: true });
  });
});

describe('validarPedido — ofertas de preço fixo', () => {
  const tipos = ['SMART_LIGHTNING', 'PRICE_MATCHING'] as const;
  // Como no spike: convidado sem min/max/sugerido, preço da oferta em preco_promo (= avaliado).
  const oferta = (o: Partial<LinhaCentral> = {}) => linha({ preco_min: null, preco_max: null, preco_sugerido: null, preco_promo: 64, preco_avaliado: 64, ...o });
  const pedir = (t: string, preco: number | null | undefined, l: LinhaCentral, confirmado_risco = false) =>
    validarPedido('aderir', t, [{ ml_item_id: 'MLB1', preco, confirmado_risco }], central(l), semExato);
  const recusado = (motivo: string) => ({ ok: false, itens: [{ ml_item_id: 'MLB1', motivo }] });

  it('preço exibido = Central → aceita e grava o preço do pedido', async () => {
    for (const t of tipos) {
      expect(await pedir(t, 64, oferta())).toEqual({ ok: true, itens: [
        { ml_item_id: 'MLB1', titulo: 'Caneca', preco: 64, semaforo: 'verde', confirmado_risco: false }] });
    }
  });
  it('Review Focus 5: Central sem preço → recusa, mesmo com preço no pedido', async () => {
    for (const t of tipos) {
      expect(await pedir(t, 64, oferta({ preco_promo: null }))).toMatchObject(recusado('O ML não informou o preço da oferta'));
    }
  });
  it('preço ausente ou diferente em centavos → recusa com o preço atual', async () => {
    for (const t of tipos) {
      for (const p of [undefined, null, 63.99, Number.NaN]) {
        expect(await pedir(t, p, oferta())).toMatchObject(recusado('O preço da oferta mudou: agora 64,00'));
      }
    }
  });
  it('abaixo de R$ 19: recusa antes do semáforo, mesmo com risco confirmado', async () => {
    for (const t of tipos) {
      expect(await pedir(t, 18.99, oferta({ preco_promo: 18.99, preco_avaliado: null }), true))
        .toMatchObject(recusado('Abaixo de R$ 19 o comprador perde o frete grátis'));
    }
  });
  it('vermelho exige risco confirmado', async () => {
    const vermelha = oferta({ preco_promo: 20, preco_avaliado: 20, projecao: [cor({ custo: 30, piso: 32 })] });
    expect(await pedir('PRICE_MATCHING', 20, vermelha)).toMatchObject({ ok: false, itens: [{ semaforo: 'vermelho' }] });
    expect(await pedir('PRICE_MATCHING', 20, vermelha, true)).toMatchObject({ ok: true });
  });
  it('sair: só exige estar participando', async () => {
    const r = await validarPedido('sair', 'SMART_LIGHTNING', [{ ml_item_id: 'MLB1' }], central(oferta({ status: 'pending' })), semExato);
    expect(r).toMatchObject({ ok: true, itens: [{ preco: null, semaforo: null }] });
  });
  it('SMART segue sem exigir preço no pedido', async () => {
    expect(await validarPedido('aderir', 'SMART', [{ ml_item_id: 'MLB1' }], central(oferta()), semExato)).toMatchObject({ ok: true, itens: [{ preco: 64 }] });
  });
});
