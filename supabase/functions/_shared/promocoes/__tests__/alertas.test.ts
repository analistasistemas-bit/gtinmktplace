import { describe, expect, it, vi } from 'vitest';
import {
  avisarPromocoes, montarMensagemPromocoes, selecionarAlertas, tiposNovos,
  type DepsAlertas, type ItemAlerta, type PromoAlerta,
} from '../alertas.ts';

const H = 3_600_000;
const agora = Date.parse('2026-10-06T12:00:00Z');
const contagem = (verdes: number) => ({ convidados: 5, convidados_verde: verdes, participando: 0, verde: verdes, amarelo: 0, vermelho: 0, indisponivel: 0, participando_vermelho: 0, ml_pct_max: null });
const promo = (id: string, status: string, prazoHoras: number | null, verdes = 1): PromoAlerta => ({
  promocao_id: id, tipo: 'DEAL', nome: `Campanha ${id}`, status, contagem: contagem(verdes),
  prazo_adesao: prazoHoras == null ? null : new Date(agora + prazoHoras * H).toISOString(),
});
const item = (promocao: string, id: string): ItemAlerta => ({
  promocao_id: promocao, ml_item_id: id, titulo: `Anúncio ${id}`, preco_avaliado: 49.9,
  projecao: [{ liquido: 8.5, custo: 12 } as never],
});

describe('selecionarAlertas', () => {
  it('prejuízo: casa o item com a promoção; promoção desconhecida é ignorada', () => {
    const s = selecionarAlertas([promo('S', 'started', null)], [item('S', 'A'), item('X', 'B')], agora);
    expect(s.prejuizo.map((x) => x.item.ml_item_id)).toEqual(['A']);
  });

  it('prazo: pending, adesão aberta em ≤ 48 h e ≥ 1 convidado verde', () => {
    const s = selecionarAlertas([
      promo('P1', 'pending', 47), promo('P2', 'pending', 49), promo('P3', 'pending', 10, 0),
      promo('P4', 'pending', -1), promo('P5', 'started', 10),
    ], [], agora);
    expect(s.prazo).toEqual([{ promo: expect.objectContaining({ promocao_id: 'P1' }), verdes: 1 }]);
  });
});

describe('avisarPromocoes', () => {
  type D = DepsAlertas & Record<keyof DepsAlertas, ReturnType<typeof vi.fn>>;
  const deps = (o: Partial<DepsAlertas> = {}): D => ({
    ativo: vi.fn(async () => true),
    lerPromocoes: vi.fn(async () => [promo('S', 'started', null), promo('P', 'pending', 24)]),
    lerParticipandoNoPrejuizo: vi.fn(async () => [item('S', 'A'), item('S', 'B')]),
    reservar: vi.fn(async () => true),
    notificar: vi.fn(async () => 1),
    notificarTipoNovo: vi.fn(async () => 1),
    ...o,
  }) as unknown as D;

  it('switch desligado: não lê prejuízo, não reserva, não envia', async () => {
    const d = deps({ ativo: vi.fn(async () => false) });
    expect(await avisarPromocoes(agora, d)).toBe(0);
    expect(d.lerParticipandoNoPrejuizo).not.toHaveBeenCalled();
    expect(d.reservar).not.toHaveBeenCalled();
  });

  it('uma mensagem agregada só com o que reservou agora', async () => {
    const d = deps();
    d.reservar.mockImplementation(async (_e: string, chave: string) => chave !== 'S:B');
    await avisarPromocoes(agora, d);
    expect(d.reservar).toHaveBeenCalledWith('promo_prejuizo', 'S:A');
    expect(d.reservar).toHaveBeenCalledWith('promo_prazo', 'P');
    expect(d.notificar).toHaveBeenCalledTimes(1);
    const texto = d.notificar.mock.calls[0][0] as string;
    expect(texto).toContain('Anúncio A');
    expect(texto).not.toContain('Anúncio B');
    expect(texto).toContain('Campanha P');
  });

  it('nada reservado → nenhuma mensagem', async () => {
    const d = deps({ reservar: vi.fn(async () => false) });
    expect(await avisarPromocoes(agora, d)).toBe(0);
    expect(d.notificar).not.toHaveBeenCalled();
  });
});

describe('montarMensagemPromocoes', () => {
  it('lista até 10 anúncios, resume o resto e não usa "margem"/"lucro"', () => {
    const p = promo('S', 'started', null);
    const t = montarMensagemPromocoes({ prejuizo: Array.from({ length: 12 }, (_, i) => ({ promo: p, item: item('S', `X${i}`) })), prazo: [] });
    expect(t).toContain('e mais 2');
    expect(t).not.toMatch(/margem|lucro/i);
  });

  it('mostra a cor mais no prejuízo (menor líquido − custo), não a primeira', () => {
    const p = promo('S', 'started', null);
    const it = { ...item('S', 'A'), projecao: [{ liquido: 8, custo: 12 }, { liquido: 30, custo: 25 }, { liquido: 9, custo: 20 }] as never };
    const t = montarMensagemPromocoes({ prejuizo: [{ promo: p, item: it }], prazo: [] });
    expect(t).toMatch(/líquido R\$\s9,00 · custo R\$\s20,00/);
  });
});

describe('tipo de campanha novo', () => {
  type D = DepsAlertas & Record<keyof DepsAlertas, ReturnType<typeof vi.fn>>;
  const novo = (id: string, tipo: string): PromoAlerta => ({ ...promo(id, 'pending', null), tipo });
  const deps = (o: Partial<DepsAlertas> = {}): D => ({
    ativo: vi.fn(async () => false),
    lerPromocoes: vi.fn(async () => [novo('N', 'VOLUME'), promo('S', 'started', null)]),
    lerParticipandoNoPrejuizo: vi.fn(async () => []),
    reservar: vi.fn(async () => true),
    notificar: vi.fn(async () => 1),
    notificarTipoNovo: vi.fn(async () => 1),
    ...o,
  }) as unknown as D;

  it('tiposNovos: um por tipo fora dos suportados', () => {
    const r = tiposNovos([novo('1', 'VOLUME'), novo('2', 'VOLUME'), novo('3', 'SMART_LIGHTNING'), novo('4', 'SELLER_COUPON_CAMPAIGN'), novo('5', 'X')]);
    expect(r.map((x) => x.tipo)).toEqual(['VOLUME', 'X']);
  });

  it('tipo novo avisa com alertas desligados', async () => {
    const d = deps();
    await avisarPromocoes(agora, d);
    expect(d.notificarTipoNovo).toHaveBeenCalledTimes(1);
    const [texto] = d.notificarTipoNovo.mock.calls[0] as [string];
    expect(texto).toBe('🆕 Promoções: o ML trouxe um tipo de campanha que o PubliAI ainda não ativa\nTipo: VOLUME\nCampanha: Campanha N\nPor enquanto, adira pelo Seller Center.');
    expect(d.reservar).not.toHaveBeenCalled();
    expect(d.notificar).not.toHaveBeenCalled();
  });

  it('usa o tipo como chave (2º argumento)', async () => {
    const d = deps();
    await avisarPromocoes(agora, d);
    expect(d.notificarTipoNovo.mock.calls[0][1]).toBe('VOLUME');
  });

  it('falha numa rodada é reenviada na seguinte', async () => {
    const d = deps({ notificarTipoNovo: vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(1) });
    await avisarPromocoes(agora, d);
    await avisarPromocoes(agora, d);
    expect(d.notificarTipoNovo).toHaveBeenCalledTimes(2);
  });

  it('tipo suportado não avisa', async () => {
    const d = deps({ lerPromocoes: vi.fn(async () => [promo('S', 'started', null), novo('L', 'SMART_LIGHTNING')]) });
    await avisarPromocoes(agora, d);
    expect(d.notificarTipoNovo).not.toHaveBeenCalled();
  });

  it('erro no aviso não derruba os outros alertas', async () => {
    const d = deps({
      ativo: vi.fn(async () => true),
      lerPromocoes: vi.fn(async () => [novo('N', 'VOLUME'), promo('S', 'started', null)]),
      lerParticipandoNoPrejuizo: vi.fn(async () => [item('S', 'A')]),
      notificarTipoNovo: vi.fn(async () => { throw new Error('boom'); }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await avisarPromocoes(agora, d)).toBe(1);
    expect(d.notificar).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
