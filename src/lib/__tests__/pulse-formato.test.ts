import { describe, it, expect } from 'vitest';
import {
  motivoSemPrecoProprio, seloAnuncio, tipoAnuncio, reputacao,
  posicaoVsMercado, rotuloMotivoQualificacao, rotuloReputacao, rotuloStatusQualificacao,
} from '../pulse-formato';

describe('motivoSemPrecoProprio', () => {
  const base = {
    origem: 'auto' as const,
    catalogo_status: 'vinculado',
    ultimo_snapshot_em: '2026-08-16T00:00:00Z',
    meu_preco_em: '2026-08-16T22:08:09Z',
    anuncio_status: 'active' as string | null,
    anuncio_sub_status: null as string[] | null,
  };

  it('ficha manual: não é anúncio nosso', () => {
    expect(motivoSemPrecoProprio({ ...base, origem: 'manual' })).toContain('você não vende');
  });

  it('antes da primeira coleta, a causa é a coleta — não o anúncio', () => {
    expect(motivoSemPrecoProprio({ ...base, ultimo_snapshot_em: null })).toContain('primeira coleta');
  });

  // Cada execução tem teto de produtos: uma sobra fica para o ciclo seguinte com o preço nunca
  // lido. Dizer "pausado" ali é afirmar sobre o anúncio a partir de uma leitura que não houve.
  it('produto que a coleta ainda não alcançou não é chamado de pausado', () => {
    const s = motivoSemPrecoProprio({ ...base, meu_preco_em: null });
    expect(s).toContain('ainda não lido');
    expect(s).not.toContain('pausado');
  });

  it('sem vínculo de catálogo: causa acionável', () => {
    expect(motivoSemPrecoProprio({ ...base, catalogo_status: 'ficha_divergente' })).toContain('não está vinculado');
  });

  it('lido, vinculado, anúncio ativo, mas fora da ficha: sem dedução extra', () => {
    expect(motivoSemPrecoProprio(base)).toContain('não está entre as ofertas ativas');
  });

  // A situação real vence a dedução: some da ficha tanto quem está pausado quanto quem perdeu o
  // vínculo, e "sem estoque" e "em moderação" são problemas diferentes com a mesma aparência.
  it('anúncio pausado por estoque zerado diz isso, e diz o que resolve', () => {
    const s = motivoSemPrecoProprio({ ...base, anuncio_status: 'paused', anuncio_sub_status: ['out_of_stock'] });
    expect(s).toContain('estoque zerado');
    expect(s).toContain('repor o estoque');
  });

  it('pausado por outro motivo não é chamado de falta de estoque', () => {
    const s = motivoSemPrecoProprio({ ...base, anuncio_status: 'under_review', anuncio_sub_status: [] });
    expect(s).not.toContain('estoque');
    expect(s).toContain('under_review');
  });

  // Pausa preventiva do ML (ADR-0035, adendo 25/08): `under_review` + `suspended_for_prevention`
  // é pausa administrativa, não moderação — dizer "fora do ar" assusta à toa.
  it('pausa preventiva é tratada como pausado, não como fora do ar', () => {
    const s = motivoSemPrecoProprio({ ...base, anuncio_status: 'under_review', anuncio_sub_status: ['suspended_for_prevention'] });
    expect(s).toContain('pausado');
    expect(s).not.toContain('under_review');
  });

  it('situação do anúncio vence o vínculo: pausado é pausado, mesmo sem vínculo', () => {
    const s = motivoSemPrecoProprio({
      ...base, catalogo_status: 'ficha_divergente', anuncio_status: 'paused', anuncio_sub_status: ['out_of_stock'],
    });
    expect(s).toContain('estoque zerado');
  });

  it('sempre explica — nunca devolve vazio, que leria como tela quebrada', () => {
    const casos = [
      base,
      { ...base, origem: 'manual' as const },
      { ...base, catalogo_status: null },
      { ...base, ultimo_snapshot_em: null },
      { ...base, meu_preco_em: null },
    ];
    for (const c of casos) expect(motivoSemPrecoProprio(c).length).toBeGreaterThan(10);
  });
});

describe('seloAnuncio', () => {
  it('anúncio ativo não ganha etiqueta — só o que está fora do ar se identifica', () => {
    expect(seloAnuncio({ anuncio_status: 'active', anuncio_sub_status: [] })).toBeNull();
  });

  it('situação ainda não lida não vira etiqueta', () => {
    expect(seloAnuncio({ anuncio_status: null, anuncio_sub_status: null })).toBeNull();
  });

  it('estoque zerado e pausa comum são etiquetas distintas', () => {
    expect(seloAnuncio({ anuncio_status: 'paused', anuncio_sub_status: ['out_of_stock'] })?.texto).toBe('Sem estoque');
    expect(seloAnuncio({ anuncio_status: 'under_review', anuncio_sub_status: ['suspended_for_prevention'] })?.texto).toBe('Pausado no ML');

    expect(seloAnuncio({ anuncio_status: 'paused', anuncio_sub_status: [] })?.texto).toBe('Pausado no ML');
  });

  it('situação desconhecida do ML não vaza como está, mas fica no tooltip', () => {
    const s = seloAnuncio({ anuncio_status: 'closed', anuncio_sub_status: null });
    expect(s?.texto).toBe('Fora do ar');
    expect(s?.ajuda).toContain('closed');
  });
});

describe('tipoAnuncio', () => {
  it('traduz o jargão do ML', () => {
    expect(tipoAnuncio('gold_special')).toBe('Clássico');
    expect(tipoAnuncio('gold_pro')).toBe('Premium');
    expect(tipoAnuncio(null)).toBe('—');
  });
});

describe('reputacao', () => {
  it('devolve null quando o vendedor não tem selo (evita o "—·" solto)', () => {
    expect(reputacao(null)).toBeNull();
    expect(reputacao('gold')).toBe('MercadoLíder Gold');
    expect(reputacao('silver')).toBe('MercadoLíder Silver');
  });
});

describe('rótulos da qualificação', () => {
  it('padroniza os status da classificação', () => {
    expect(rotuloStatusQualificacao('relevante')).toBe('Relevante');
    expect(rotuloStatusQualificacao('observacao')).toBe('Em observação');
    expect(rotuloStatusQualificacao('fora_referencia')).toBe('Fora da referência');
  });

  it('traduz motivos internos sem expor códigos da API', () => {
    expect(rotuloMotivoQualificacao('QUALIFICADO')).toBe('Qualificado');
    expect(rotuloMotivoQualificacao('DADOS_INSUFICIENTES')).toBe('Dados insuficientes');
    expect(rotuloMotivoQualificacao('POUCAS_TRANSACOES')).toBe('Poucas transações');
    expect(rotuloMotivoQualificacao('SEM_VISITAS_30D')).toBe('Sem visitas nos últimos 30 dias');
    expect(rotuloMotivoQualificacao('REPUTACAO_BAIXA')).toBe('Reputação baixa');
  });

  it('explica todas as cores de reputação e a ausência de dado', () => {
    expect(rotuloReputacao('5_green')).toBe('Reputação verde');
    expect(rotuloReputacao('4_light_green')).toBe('Reputação verde-clara');
    expect(rotuloReputacao('3_yellow')).toBe('Reputação amarela');
    expect(rotuloReputacao('2_orange')).toBe('Reputação laranja');
    expect(rotuloReputacao('1_red')).toBe('Reputação vermelha');
    expect(rotuloReputacao(null)).toBe('Reputação não informada');
  });
});

describe('posicaoVsMercado', () => {
  it('mais caro que o menor concorrente', () => {
    const p = posicaoVsMercado(115, 100)!;
    expect(p.texto).toBe('+15% mais caro');
    expect(p.tom).toBe('risco');
  });

  it('acima mas pouco: atenção, não risco', () => {
    expect(posicaoVsMercado(105, 100)!.tom).toBe('atencao');
  });

  it('mais barato — sem o sinal, que negaria a própria frase', () => {
    const p = posicaoVsMercado(90, 100)!;
    expect(p.texto).toBe('10% mais barato');
    expect(p.tom).toBe('ok');
  });

  it('diferença irrelevante vira empate', () => {
    expect(posicaoVsMercado(100.2, 100)!.texto).toBe('Empatado');
  });

  it('sem preço nosso ou sem concorrente: nada a comparar', () => {
    expect(posicaoVsMercado(null, 100)).toBeNull();
    expect(posicaoVsMercado(100, null)).toBeNull();
    expect(posicaoVsMercado(100, 0)).toBeNull();
  });
});
