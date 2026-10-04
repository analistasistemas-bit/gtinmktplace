import { describe, expect, it } from 'vitest';
import {
  inversa, itensRevertiveis, montarPreview, motivoNaoSelecionavel, parsePreco, precisaConfirmarRisco, semaforoNoPreco,
  separarSelecao, tituloOperacao,
} from '../operacoes';
import type { CorProjetada, ItemPromocao } from '../promocoes';
import { semaforoNoPreco as semaforoNoPrecoBackend } from '../../../supabase/functions/_shared/operacoes/validar';
import type { ProjecaoCor } from '../../../supabase/functions/_shared/promocoes/tipos';

function cor(over: Partial<CorProjetada> = {}): CorProjetada {
  return {
    variation_id: 1, cor: 'Azul', sku: null, custo: 5, piso: 10, origem: 'nacional',
    comissao_pct: 12, comissao_fixa: 0, frete: 0, aliquota_pct: 0,
    liquido: null, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde', motivo: null,
    ...over,
  };
}
function item(over: Partial<ItemPromocao> = {}): ItemPromocao {
  return {
    ml_item_id: 'MLB1', status: 'candidate',
    preco_original: 100, preco_promo: 80, preco_min: 70, preco_max: 90,
    preco_sugerido: 85, preco_avaliado: 85, ml_pct: null, estoque_min: null,
    titulo: 'Produto', thumbnail: null, permalink: null,
    projecao: [cor()], pior_semaforo: 'verde',
    ...over,
  };
}

describe('parsePreco', () => {
  it.each([
    ['18,50', 18.5], ['18.5', 18.5], ['', null], ['abc', null],
  ])('%s → %s', (txt, esperado) => {
    expect(parsePreco(txt)).toBe(esperado);
  });
});

describe('montarPreview', () => {
  it('DEAL aderir marca só o verde e usa o sugerido', () => {
    const verde = item({ ml_item_id: 'V', preco_sugerido: 85, projecao: [cor({ custo: 5, piso: 10 })] });
    const vermelho = item({ ml_item_id: 'R', preco_sugerido: 5, projecao: [cor({ custo: 5, piso: 10 })] });
    const linhas = montarPreview('aderir', 'DEAL', [verde, vermelho]);
    expect(linhas.find((l) => l.ml_item_id === 'V')).toMatchObject({ preco: 85, semaforo: 'verde', marcado: true });
    expect(linhas.find((l) => l.ml_item_id === 'R')).toMatchObject({ preco: 5, marcado: false });
    expect(linhas.find((l) => l.ml_item_id === 'R')?.semaforo).not.toBe('verde');
  });

  it('SMART aderir usa o preço da oferta (preco_promo)', () => {
    const it1 = item({ preco_promo: 80, preco_sugerido: 999 });
    const [linha] = montarPreview('aderir', 'SMART', [it1]);
    expect(linha.preco).toBe(80);
  });

  it('sair usa o preço no ar e marca tudo, mesmo sem semáforo calculável', () => {
    const semDados = item({ preco_promo: null, projecao: [] });
    const linhas = montarPreview('sair', 'DEAL', [item({ preco_promo: 80 }), semDados]);
    expect(linhas.every((l) => l.marcado)).toBe(true);
    expect(linhas.find((l) => l.preco == null)?.semaforo).toBe('indisponivel');
  });
});

describe('precisaConfirmarRisco', () => {
  const linhas = [
    { ml_item_id: '1', titulo: null, preco: 1, min: null, max: null, sugerido: null, ateQuanto: null, semaforo: 'vermelho' as const, marcado: true },
    { ml_item_id: '2', titulo: null, preco: 1, min: null, max: null, sugerido: null, ateQuanto: null, semaforo: 'vermelho' as const, marcado: false },
    { ml_item_id: '3', titulo: null, preco: 1, min: null, max: null, sugerido: null, ateQuanto: null, semaforo: 'indisponivel' as const, marcado: true },
    { ml_item_id: '4', titulo: null, preco: 1, min: null, max: null, sugerido: null, ateQuanto: null, semaforo: 'verde' as const, marcado: true },
  ];
  it('aderir conta só as linhas marcadas', () => {
    expect(precisaConfirmarRisco('aderir', linhas)).toEqual({ vermelho: 1, indisponivel: 1 });
  });
  // Fix round 1 (achado 1): sair não olha semáforo (validar.ts não trava a saída) — nunca exige o checkbox.
  it('sair nunca exige confirmação de risco, mesmo com marcado vermelho/indisponivel', () => {
    expect(precisaConfirmarRisco('sair', linhas)).toEqual({ vermelho: 0, indisponivel: 0 });
  });
});

describe('itensRevertiveis', () => {
  const itens = [
    { ml_item_id: 'A', status: 'aplicado' as const },
    { ml_item_id: 'B', status: 'ja_estava' as const },
    { ml_item_id: 'C', status: 'erro' as const },
  ];
  it('sair só reverte aplicado', () => {
    expect(itensRevertiveis('sair', itens)).toEqual(['A']);
  });
  it('aderir reverte aplicado e ja_estava', () => {
    expect(itensRevertiveis('aderir', itens)).toEqual(['A', 'B']);
  });
});

describe('inversa', () => {
  it('troca a ação', () => {
    expect(inversa('aderir')).toBe('sair');
    expect(inversa('sair')).toBe('aderir');
  });
});

describe('paridade semáforo front × backend (operações)', () => {
  const cAzul = { variation_id: 1, cor: null, sku: null, custo: 5, piso: 10, origem: 'nacional' as const, comissao_pct: 12, comissao_fixa: 0, frete: 0, aliquota_pct: 0, liquido: null, ate_quanto: null, ate_quanto_motivo: null, semaforo: 'verde' as const, motivo: null };
  const semCadastro = { ...cAzul, custo: null, piso: null, origem: null, comissao_pct: null, comissao_fixa: null, frete: null, aliquota_pct: null, semaforo: 'indisponivel' as const, motivo: 'sem_cadastro' as const };
  // liquido = preco*0.88; custo=5, piso=10 → amarelo entre preco≈5,68 e ≈11,36.
  const cVermelho = { ...cAzul, custo: 80, piso: 90 };
  const casos: [ProjecaoCor[], number | null][] = [
    [[cAzul], 85],           // verde
    [[cAzul], 5],            // vermelho (liquido < custo)
    [[semCadastro], 50],     // indisponivel (sem tarifa/custo)
    [[cAzul], 8],            // amarelo (liquido entre custo e piso)
    [[cAzul, cVermelho], 85], // duas cores: pior entre elas (vermelho na 2ª)
  ];
  it.each(casos)('caso %#', (projecao, preco) => {
    expect(semaforoNoPreco(projecao as unknown as CorProjetada[], preco)).toBe(semaforoNoPrecoBackend(projecao, preco));
  });

  it('cor de kit ⚪ (kit_*) trava a linha mesmo com outra cor verde — nunca adesão automática', () => {
    const kit = { ...semCadastro, motivo: 'kit_divergente' as const };
    expect(semaforoNoPreco([cAzul, kit] as unknown as CorProjetada[], 85)).toBe('indisponivel');
    expect(semaforoNoPrecoBackend([cAzul, kit], 85)).toBe('indisponivel');
  });
});

describe('operações de status (emenda 2026-10-04)', () => {
  it('inversa e revertíveis', () => {
    expect(inversa('pausar')).toBe('reativar');
    expect(inversa('reativar')).toBe('pausar');
    const itens = [{ ml_item_id: 'A', status: 'aplicado' as const }, { ml_item_id: 'B', status: 'ja_estava' as const }];
    expect(itensRevertiveis('pausar', itens)).toEqual(['A']); // ja_estava não fomos nós que mudamos
    expect(itensRevertiveis('aderir', itens)).toEqual(['A', 'B']); // regra antiga intacta
  });
  it('título por tipo', () => {
    expect(tituloOperacao({ acao: 'pausar', promocao_nome: null, promocao_id: null }, 47)).toBe('Pausar 47 anúncios');
    expect(tituloOperacao({ acao: 'reativar', promocao_nome: null, promocao_id: null }, 1)).toBe('Reativar 1 anúncio');
    expect(tituloOperacao({ acao: 'aderir', promocao_nome: '10.10', promocao_id: 'P1' }, 3)).toBe('Aderir à 10.10');
    expect(tituloOperacao({ acao: 'sair', promocao_nome: null, promocao_id: 'P1' }, 3)).toBe('Sair de P1');
  });
  it('quem não entra na seleção', () => {
    expect(motivoNaoSelecionavel({ status: 'ativo' })).toBeNull();
    expect(motivoNaoSelecionavel({ status: 'pausado' })).toBeNull();
    expect(motivoNaoSelecionavel({ status: 'ativo', ehKitVirtual: true })).toBe('Kit Virtual não entra em pausar/reativar em massa');
    expect(motivoNaoSelecionavel({ status: 'ativo', publicacaoIncompleta: true })).toBe('Publicação incompleta');
    expect(motivoNaoSelecionavel({ status: 'ativo', migracaoEmAndamento: true })).toBe('Migração para preço por variação em andamento');
    expect(motivoNaoSelecionavel({ status: 'moderado' })).toBe('Só anúncio ativo ou pausado');
    expect(motivoNaoSelecionavel({ status: undefined })).toBe('Só anúncio ativo ou pausado');
  });
  it('separa ativos e pausados', () => {
    expect(separarSelecao([{ mlItemId: 'A', status: 'ativo' }, { mlItemId: 'B', status: 'pausado' }, { mlItemId: 'C', status: 'moderado' }]))
      .toEqual({ ativos: ['A'], pausados: ['B'] });
  });
});

describe('reajuste de preço (I5)', () => {
  it('título: reajuste e reversão', () => {
    expect(tituloOperacao({ acao: 'reajustar', promocao_nome: null, promocao_id: null, origem_id: null }, 12)).toBe('Reajustar preço de 12 anúncios');
    expect(tituloOperacao({ acao: 'reajustar', promocao_nome: null, promocao_id: null }, 1)).toBe('Reajustar preço de 1 anúncio');
    expect(tituloOperacao({ acao: 'reajustar', promocao_nome: null, promocao_id: null, origem_id: 'OP0' }, 3)).toBe('Reverter reajuste de 3 anúncios');
    // origem_id não muda o título das outras ações
    expect(tituloOperacao({ acao: 'pausar', promocao_nome: null, promocao_id: null, origem_id: 'OP0' }, 2)).toBe('Pausar 2 anúncios');
  });
  it('inversa de reajustar é reajustar (Reverter = reajuste com origem)', () => {
    const r: 'reajustar' = inversa('reajustar');
    expect(r).toBe('reajustar');
  });
  it('revertíveis: só aplicado', () => {
    const itens = [
      { ml_item_id: 'A', status: 'aplicado' as const }, { ml_item_id: 'B', status: 'ja_estava' as const },
      { ml_item_id: 'C', status: 'mudou' as const }, { ml_item_id: 'D', status: 'rascunho' as const },
    ];
    expect(itensRevertiveis('reajustar', itens)).toEqual(['A']);
  });
});
