import { describe, it, expect } from 'vitest';
import {
  garantirConteudoEmbalagem,
  garantirDisclaimerTonalidade,
  posProcessarDescricao,
} from '../copywriter-prompt';
import { ROTULO_COR, ROTULO_ESTAMPA, ROTULO_GENERICO } from '../eixo-variacao';

const OXFORD_NOME = 'Tecido Oxford Liso de 10m Estampas Exclusivas de Natal Premium';
const OXFORD_DESC = 'Tecido Oxford Liso de 10 metros Contínuo estampas de Natal, Largura de 1,50 metros, 100% Poliester';

describe('garantirConteudoEmbalagem (ADR-0115)', () => {
  it('seção ausente + metragem na fonte → cria com o que o comprador recebe', () => {
    const out = garantirConteudoEmbalagem('🧵 INTRO\n\nTexto.', OXFORD_NOME, OXFORD_DESC, ROTULO_ESTAMPA);
    expect(out).toContain('📦 O QUE VOCÊ RECEBE');
    expect(out).toContain('• 1 unidade com 10m');
    expect(out).toContain('• Estampa escolhida no anúncio');
  });

  it('o bullet da opção usa o substantivo do eixo, não "cor" fixo', () => {
    const comCor = garantirConteudoEmbalagem('X', 'LINHA 100M', 'Cone.', ROTULO_COR);
    expect(comCor).toContain('• Cor escolhida no anúncio');
    const generico = garantirConteudoEmbalagem('X', 'CAMISETA 1UN', 'Peça.', ROTULO_GENERICO);
    expect(generico).toContain('• Variação escolhida no anúncio');
  });

  it('contagem da fonte vence a metragem e sai por extenso, não na forma canônica do título', () => {
    const out = garantirConteudoEmbalagem('X', 'LAPIS CAIXA COM 144 UNIDADES', '', null);
    expect(out).toContain('• 144 unidades');
    expect(out).not.toContain('144un');
  });

  it('contagem 1 sai no singular', () => {
    const out = garantirConteudoEmbalagem('X', 'PRODUTO', 'CONTÉM: 1 UNIDADE.', ROTULO_COR);
    expect(out).toContain('• 1 unidade');
    expect(out).not.toContain('1 unidades');
  });

  it('não duplica quando a IA já escreveu a seção', () => {
    const original = '📦 O QUE VOCÊ RECEBE\n\n• 1 rolo';
    expect(garantirConteudoEmbalagem(original, OXFORD_NOME, OXFORD_DESC, ROTULO_ESTAMPA)).toBe(original);
  });

  it('sem NENHUM dado derivável → não cria a seção (não afirma "1 unidade" sem respaldo)', () => {
    const out = garantirConteudoEmbalagem('🧵 INTRO\n\nTexto.', 'PRODUTO GENERICO', 'Sem medidas.', null);
    expect(out).not.toContain('📦');
  });
});

describe('garantirDisclaimerTonalidade (ADR-0115)', () => {
  const TONALIDADE = 'A tonalidade pode variar conforme a tela do dispositivo.';

  it('acrescenta ao fim da lista da seção de variação', () => {
    const out = garantirDisclaimerTonalidade('🎨 ESTAMPAS DISPONÍVEIS\n\n- Estampa 6\n- Estampa 31');
    expect(out).toContain(TONALIDADE);
    expect(out.indexOf('- Estampa 31')).toBeLessThan(out.indexOf(TONALIDADE));
  });

  it('fica DENTRO da seção 🎨, antes da seção seguinte', () => {
    const out = garantirDisclaimerTonalidade('🎨 CORES DISPONÍVEIS\n\n- Azul\n\n📦 O QUE VOCÊ RECEBE\n\n• 1 unidade');
    expect(out.indexOf(TONALIDADE)).toBeLessThan(out.indexOf('📦'));
  });

  it('sem seção de variação → intacto (produto sem variação não tem tonalidade a ressalvar)', () => {
    const original = '🧵 INTRO\n\nTexto.\n\n📦 O QUE VOCÊ RECEBE\n\n• 1 unidade';
    expect(garantirDisclaimerTonalidade(original)).toBe(original);
  });

  it('cabeçalho 🎨 sem nenhum item listado → não pendura ressalva em lista inexistente', () => {
    const original = '🎨 CORES DISPONÍVEIS\n\n📦 O QUE VOCÊ RECEBE';
    expect(garantirDisclaimerTonalidade(original)).toBe(original);
  });

  it('não duplica em reprocessamento', () => {
    const uma = garantirDisclaimerTonalidade('🎨 CORES DISPONÍVEIS\n\n- Azul');
    expect(garantirDisclaimerTonalidade(uma)).toBe(uma);
  });
});

describe('posProcessarDescricao — composição dos guards novos', () => {
  const VARIACOES = [
    { codigo: '1', cor: 'Verde Musgo', preco: 48, nome: `${OXFORD_NOME} Est.6` },
    { codigo: '2', cor: 'Vermelho', preco: 48, nome: `${OXFORD_NOME} Est.31` },
  ];

  it('IA pulou embalagem e a família tem eixo de estampa → seção criada com o substantivo certo', () => {
    const daIA = '🧵 INTRO\n\nTexto.\n\n🎨 ESTAMPAS DISPONÍVEIS\n\n- Estampa 6\n- Estampa 31';
    const out = posProcessarDescricao(daIA, OXFORD_NOME, OXFORD_DESC, VARIACOES);
    expect(out).toContain('📦 O QUE VOCÊ RECEBE');
    expect(out).toContain('• Estampa escolhida no anúncio');
    expect(out).toContain('A tonalidade pode variar');
  });

  it('sem variações informadas (call site legado) → guards de eixo não disparam, nada quebra', () => {
    const out = posProcessarDescricao('🧵 INTRO\n\nTexto.', OXFORD_NOME, OXFORD_DESC);
    expect(out).toContain('🧵 INTRO');
    expect(out).not.toContain('escolhida no anúncio');
  });

  it('família só com cor indefinida ("Outra") → sem eixo, sem bullet de opção', () => {
    const out = posProcessarDescricao(
      '🧵 INTRO\n\nTexto.',
      OXFORD_NOME,
      OXFORD_DESC,
      [{ codigo: '1', cor: 'Outra', preco: 10, nome: OXFORD_NOME }],
    );
    expect(out).not.toContain('escolhida no anúncio');
    // A metragem ainda sustenta a seção sozinha.
    expect(out).toContain('• 1 unidade com 10m');
  });
});
