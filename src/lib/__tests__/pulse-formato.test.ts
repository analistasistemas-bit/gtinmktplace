import { describe, it, expect } from 'vitest';
import {
  disputaCatalogo, motivoSemPrecoProprio, seloAnuncio, tipoAnuncio, reputacao,
  posicaoVsMercado, rotuloMotivoQualificacao, rotuloReputacao, rotuloStatusQualificacao,
} from '../pulse-formato';
import type { PulseResumoOfertas } from '../pulse';

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

// ADR-0147: a coluna do Radar mostra a DISPUTA do catálogo, nunca o ganhador — ele não é obtenível
// (Spike 049: buy_box_winner null em 40/40) e a org nem disputa (0 de 137 anúncios de catálogo na
// AVIL). Por isso a posição é declaradamente hipotética: "ficaria em Nº".
describe('disputaCatalogo', () => {
  const precos = [130, 139.9, 144.56, 186.9, 209.9];
  const resumo = (over: Partial<PulseResumoOfertas> = {}): PulseResumoOfertas => ({
    menorPreco: 130, menorObservado: 36, menorRelevante: 130, maiorRelevante: 209.9,
    nOfertas: 13, nOfertasRelevantes: 5, precosRelevantes: precos, ...over,
  });

  it('devolve contagem, faixa e a posição hipotética do nosso preço', () => {
    const d = disputaCatalogo(resumo(), 149.99)!;
    expect(d.anunciosRelevantes).toBe(5);
    expect(d.menor).toBe(130);
    expect(d.maior).toBe(209.9);
    expect(d.posicao).toBe(4);
    expect(d.totalComNosso).toBe(6);
  });

  it('preço mais barato que todos ficaria em 1º; mais caro, em último', () => {
    expect(disputaCatalogo(resumo(), 1)!.posicao).toBe(1);
    expect(disputaCatalogo(resumo(), 999)!.posicao).toBe(6);
  });

  it('empate no preço não passa na frente de quem já está lá', () => {
    expect(disputaCatalogo(resumo(), 130)!.posicao).toBe(2);
  });

  it('sem preço nosso não há posição, mas a disputa continua visível', () => {
    const d = disputaCatalogo(resumo(), null)!;
    expect(d.posicao).toBeNull();
    expect(d.anunciosRelevantes).toBe(5);
    expect(d.menor).toBe(130);
  });

  // 22% dos catálogos do Radar não têm anúncio de catálogo ativo (Spike 049 §5). É estado de
  // mercado, não ausência de dado — e por isso tem frase própria na tela, não "—".
  it('catálogo sem oferta relevante devolve null, para a tela dizer a frase de ausência', () => {
    expect(disputaCatalogo(resumo({ nOfertasRelevantes: 0, precosRelevantes: [], menorRelevante: null, maiorRelevante: null }), 149.99)).toBeNull();
  });

  it('resumo ainda não carregado devolve null', () => {
    expect(disputaCatalogo(undefined, 149.99)).toBeNull();
  });

  // A faixa NUNCA sai do menor observado: ele inclui oferta desqualificada, e foi exatamente esse
  // o engano que a coluna "Menor relevante" já corrigiu uma vez.
  it('a faixa ignora o menor observado', () => {
    const d = disputaCatalogo(resumo({ menorObservado: 36 }), 149.99)!;
    expect(d.menor).toBe(130);
    expect(d.menor).not.toBe(36);
  });
});
