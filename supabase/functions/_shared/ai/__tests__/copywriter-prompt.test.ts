import { describe, it, expect } from 'vitest';
import { montarUserPrompt, SYSTEM } from '../copywriter-prompt';
import { ORDEM_LEITURA } from '../titulo-slots';

const base = {
  nome: 'PRODUTO X',
  descricao_detalhado: 'CONTÉM 1KG.',
  variacoes: [{ codigo: '1', cor: 'Azul', preco: 10 }],
};

describe('montarUserPrompt — rótulo de quantidade pela unidade', () => {
  it('inclui a unidade de venda no prompt', () => {
    const p = montarUserPrompt({ ...base, unidade: 'KG' });
    expect(p).toContain('Unidade de venda: KG');
  });

  it('sugere rótulo determinístico quando a unidade define a dimensão (KG → "Peso")', () => {
    const p = montarUserPrompt({ ...base, unidade: 'KG' });
    expect(p).toContain('Rótulo sugerido para a quantidade: "Peso"');
  });

  it('NÃO sugere rótulo para unidade de embalagem (PC) — IA decide pelo dado', () => {
    const p = montarUserPrompt({ ...base, unidade: 'PC' });
    expect(p).not.toContain('Rótulo sugerido para a quantidade');
  });

  it('sem unidade não quebra nem inventa rótulo', () => {
    const p = montarUserPrompt({ ...base });
    expect(p).not.toContain('Rótulo sugerido para a quantidade');
    expect(p).not.toContain('Unidade de venda');
  });

  it('produto sem cor real ("Outra" do Vision) — omite a seção de cores, não lista placeholder (lote #31)', () => {
    const p = montarUserPrompt({ ...base, variacoes: [{ codigo: '1', cor: 'Outra', preco: 10 }] });
    expect(p).not.toMatch(/-\s*Outra\b/);
    expect(p).not.toContain('(sem cor identificada)');
    expect(p).not.toContain('CORES DISPONÍVEIS');
    expect(p).toContain('NÃO tem variação');
  });

  it('variação sem cor (null) também omite a seção de cores', () => {
    const p = montarUserPrompt({ ...base, variacoes: [{ codigo: '1', cor: null, preco: 10 }] });
    expect(p).not.toContain('CORES DISPONÍVEIS');
    expect(p).toContain('NÃO tem variação');
  });

  it('lista cores reais normalmente', () => {
    const p = montarUserPrompt({ ...base, variacoes: [
      { codigo: '1', cor: 'Azul', preco: 10 }, { codigo: '2', cor: 'Vermelho', preco: 10 },
    ] });
    expect(p).toContain('CORES DISPONÍVEIS');
    expect(p).toContain('- Azul');
    expect(p).toContain('- Vermelho');
  });

  // ADR-0115 — o eixo vem do sufixo do nome da variação, não da cor lida na foto.
  it('família com sufixo discriminante + "estampa" na fonte → eixo é ESTAMPAS, não a cor do Vision', () => {
    const p = montarUserPrompt({
      nome: 'Tecido Oxford Liso de 10m Estampas Exclusivas de Natal Premium',
      descricao_detalhado: 'Tecido Oxford de 10 metros com estampas de Natal.',
      variacoes: [
        { codigo: '1', cor: 'Verde Musgo', preco: 48, nome: 'Tecido Oxford Liso de 10m Estampas Exclusivas de Natal Premium Est.6' },
        { codigo: '2', cor: 'Vermelho', preco: 48, nome: 'Tecido Oxford Liso de 10m Estampas Exclusivas de Natal Premium Est.31' },
      ],
    });
    expect(p).toContain('ESTAMPAS DISPONÍVEIS');
    expect(p).toContain('- Estampa 6');
    expect(p).toContain('- Estampa 31');
    // O que o Vision leu na foto não pode virar a lista de opções do anúncio.
    expect(p).not.toContain('Verde Musgo');
    expect(p).not.toContain('CORES DISPONÍVEIS');
  });

  it('sem sufixo discriminante → segue no caminho de cor (comportamento anterior preservado)', () => {
    const p = montarUserPrompt({
      nome: 'LINHA BUFALO 10000M',
      descricao_detalhado: 'Cone com 10000 metros.',
      variacoes: [
        { codigo: '1', cor: 'Azul', preco: 10, nome: 'LINHA BUFALO 10000M' },
        { codigo: '2', cor: 'Preto', preco: 10, nome: 'LINHA BUFALO 10000M' },
      ],
    });
    expect(p).toContain('CORES DISPONÍVEIS');
    expect(p).toContain('- Azul');
  });

  it('mistura cor real + "Outra" — lista só a cor real', () => {
    const p = montarUserPrompt({ ...base, variacoes: [
      { codigo: '1', cor: 'Azul', preco: 10 }, { codigo: '2', cor: 'Outra', preco: 10 },
    ] });
    expect(p).toContain('- Azul');
    expect(p).not.toMatch(/-\s*Outra\b/);
  });
});

describe('bloco TÍTULO do SYSTEM (ADR-0099)', () => {
  it('não ensina mais o formato com pipe nem o slot DIFERENCIAL', () => {
    expect(SYSTEM).not.toContain('DIFERENCIAL');
    expect(SYSTEM).not.toContain('MARCA MODELO MEDIDA |');
    expect(SYSTEM).not.toContain('| RESISTENTE');
  });

  it('nomeia os dez slots no bloco de campos, não só na prosa', () => {
    // Ancorado na linha do campo ("produto        — ..."). Um `toContain('produto')` solto
    // passaria de graça: a palavra aparece na prosa em português ao redor.
    for (const slot of ORDEM_LEITURA) {
      expect(SYSTEM, `slot ${slot} não está declarado no bloco de campos`)
        .toMatch(new RegExp(`^${slot}\\s*[—-]`, 'm'));
    }
  });

  it('carrega a frase decisiva de T6', () => {
    expect(SYSTEM).toContain('Espaço restante não é motivo para adicionar palavras');
  });

  it('traz pelo menos dois exemplos CORRETO de título', () => {
    expect(SYSTEM.match(/CORRETO:/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('nenhum exemplo CORRETO termina em adjetivo — é o mecanismo que criou o problema', () => {
    const proibidos = ['resistente', 'premium', 'versatil', 'elegante', 'macio', 'profissional'];
    for (const linha of SYSTEM.split('\n').filter((l) => l.includes('CORRETO:'))) {
      const texto = linha.split('CORRETO:')[1].trim().replace(/\s*\(\d+ chars\)\s*$/, '');
      const ultima = texto.split(/\s+/).pop()?.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') ?? '';
      expect(proibidos).not.toContain(ultima);
    }
  });
});
