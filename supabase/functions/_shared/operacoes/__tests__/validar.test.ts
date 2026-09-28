import { describe, expect, it, vi } from 'vitest';
import { semaforoNoPreco, semaforoReal, validarPedido, type LinhaCentral } from '../validar.ts';
import type { ProjecaoCor, Semaforo } from '../../promocoes/tipos.ts';

// 12% de comissão, 8% de imposto, sem frete: líquido = 0,8 × preço. Custo 10, piso 12.
const cor = (o: Partial<ProjecaoCor> = {}): ProjecaoCor => ({
  variation_id: null, cor: null, sku: null, custo: 10, piso: 12, origem: 'nacional',
  comissao_pct: 12, comissao_fixa: 0, frete: 0, aliquota_pct: 8,
  liquido: 12, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null, ...o,
});
const linha = (o: Partial<LinhaCentral> = {}): LinhaCentral => ({
  ml_item_id: 'MLB1', status: 'candidate', titulo: 'Caneca', preco_min: 7, preco_max: 18.99,
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
  it('tipo fora de DEAL/SMART → erro', async () => {
    const r = await validarPedido('aderir', 'LIGHTNING', [{ ml_item_id: 'MLB1', preco: 15 }], central(linha()), semExato);
    expect(r).toEqual({ ok: false, erro: 'Só promoções DEAL e SMART aceitam operação em massa.' });
  });
  it('lista vazia ou mais de 500 → erro', async () => {
    expect((await validarPedido('aderir', 'DEAL', [], central(), semExato)).ok).toBe(false);
    const muitos = Array.from({ length: 501 }, (_, i) => ({ ml_item_id: `MLB${i}`, preco: 15 }));
    expect(await validarPedido('aderir', 'DEAL', muitos, central(), semExato))
      .toEqual({ ok: false, erro: 'No máximo 500 anúncios por operação.' });
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
    const r = await validarPedido('aderir', 'DEAL', [{ ml_item_id: 'MLB1', preco: 12 }], central(linha()), exato);
    expect(r.ok === false && r.itens).toEqual([{ ml_item_id: 'MLB1', semaforo: 'vermelho',
      motivo: 'Resultado vermelho ou sem cálculo: confirme o risco para incluir' }]);
    const ok = await validarPedido('aderir', 'DEAL', [{ ml_item_id: 'MLB1', preco: 12, confirmado_risco: true }], central(linha()), exato);
    expect(ok).toEqual({ ok: true, itens: [{ ml_item_id: 'MLB1', titulo: 'Caneca', preco: 12, semaforo: 'vermelho', confirmado_risco: true }] });
  });
  it('indisponivel também exige confirmação', async () => {
    const l = linha({ projecao: [cor({ custo: null })] });
    const r = await validarPedido('aderir', 'DEAL', [{ ml_item_id: 'MLB1', preco: 15 }], central(l), semExato);
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
    const l = linha({ preco_sugerido: null, preco_promo: 15, preco_avaliado: 15, preco_min: null, preco_max: null });
    const r = await validarPedido('aderir', 'SMART', [{ ml_item_id: 'MLB1', preco: 3 }], central(l), semExato);
    expect(r).toEqual({ ok: true, itens: [{ ml_item_id: 'MLB1', titulo: 'Caneca', preco: 15, semaforo: 'verde', confirmado_risco: false }] });
  });
  it('fora da Central e repetido → motivo', async () => {
    const r = await validarPedido('aderir', 'DEAL',
      [{ ml_item_id: 'MLB1', preco: 15 }, { ml_item_id: 'MLB1', preco: 15 }, { ml_item_id: 'MLB9', preco: 15 }], central(linha()), semExato);
    expect(r.ok === false && r.itens).toEqual([
      { ml_item_id: 'MLB1', motivo: 'Anúncio repetido no pedido' },
      { ml_item_id: 'MLB9', motivo: 'O anúncio não está nesta promoção na Central' },
    ]);
  });
});
