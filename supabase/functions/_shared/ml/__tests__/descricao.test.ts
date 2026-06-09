import { describe, it, expect } from 'vitest';
import { sanitizarDescricaoML, atualizarSecaoCores, resolverDescricaoUpdate } from '../criar-item';

const DESCRICAO = `🧵 LINHA PROFISSIONAL

Fio de alta resistência.

🎨 CORES DISPONÍVEIS

- Branco
- Preto

📦 CONTEÚDO DA EMBALAGEM

• 1 unidade`;

describe('atualizarSecaoCores', () => {
  it('substitui a lista de cores preservando o restante da descrição', () => {
    const out = atualizarSecaoCores(DESCRICAO, ['Branco', 'Preto', 'Azul']);
    expect(out).toContain('- Azul');
    expect(out).toContain('🧵 LINHA PROFISSIONAL');
    expect(out).toContain('📦 CONTEÚDO DA EMBALAGEM');
    expect(out).toContain('• 1 unidade');
    // a lista final tem exatamente as 3 cores, sempre em ordem alfabética
    const bloco = out.split('🎨 CORES DISPONÍVEIS')[1].split('📦')[0];
    expect(bloco.match(/^- .+$/gm)).toEqual(['- Azul', '- Branco', '- Preto']);
  });

  it('escreve as cores sempre em ordem alfabética, independente da ordem recebida', () => {
    const out = atualizarSecaoCores(DESCRICAO, ['Vermelho 209', 'Azul 215', 'Preto 219']);
    const bloco = out.split('🎨 CORES DISPONÍVEIS')[1].split('📦')[0];
    expect(bloco.match(/^- .+$/gm)).toEqual(['- Azul 215', '- Preto 219', '- Vermelho 209']);
  });

  it('não duplica cores já presentes (a lista é substituída, não anexada)', () => {
    const out = atualizarSecaoCores(DESCRICAO, ['Branco', 'Preto', 'Azul']);
    expect(out.match(/- Branco/g)).toHaveLength(1);
  });

  it('preserva acento e capitalização exatos das cores recebidas', () => {
    const out = atualizarSecaoCores(DESCRICAO, ['Azul Bebê', 'Salmão']);
    expect(out).toContain('- Azul Bebê');
    expect(out).toContain('- Salmão');
  });

  it('sem o cabeçalho de cores, retorna o texto original intacto', () => {
    const semCabecalho = 'Produto sem seção de cores.\n\nFita 10m.';
    expect(atualizarSecaoCores(semCabecalho, ['Azul'])).toBe(semCabecalho);
  });

  it('mantém a seção seguinte separada por linha em branco', () => {
    const out = atualizarSecaoCores(DESCRICAO, ['Azul']);
    expect(out).toContain('- Azul\n\n📦 CONTEÚDO DA EMBALAGEM');
  });

  it('guard de retry: quando a descrição já foi atualizada, recalcular com as mesmas cores retorna string idêntica', () => {
    // Simula o run 2 do QStash: familia.descricao_ml já foi persistida com as cores corretas.
    // atualizarSecaoCores é recalculada com as mesmas cores → resultado === familia.descricao_ml
    // → guard (novaDescricao !== familia.descricao_ml) é false → garantirDescricaoML não é chamada.
    const descricaoAtualizada = atualizarSecaoCores(DESCRICAO, ['Branco', 'Preto', 'Azul']);
    const recalculada = atualizarSecaoCores(descricaoAtualizada, ['Branco', 'Preto', 'Azul']);
    expect(recalculada).toBe(descricaoAtualizada); // guard false → sem reenvio ao ML
  });
});

describe('resolverDescricaoUpdate (ADR-0016 adendo 2026-06-07: push da descrição no UPDATE)', () => {
  const limpa = sanitizarDescricaoML(DESCRICAO).trim();

  it('descrição nula → null (nada a fazer)', () => {
    expect(resolverDescricaoUpdate(null, ['Branco'], '')).toBeNull();
  });

  it('reposição pura de estoque (cores e texto iguais ao ML) → não reenvia', () => {
    const r = resolverDescricaoUpdate(DESCRICAO, ['Branco', 'Preto'], limpa);
    expect(r?.precisaPush).toBe(false);
  });

  it('cor nova → seção de cores muda → reenvia', () => {
    const r = resolverDescricaoUpdate(DESCRICAO, ['Branco', 'Preto', 'Azul'], limpa);
    expect(r?.precisaPush).toBe(true);
    expect(r?.novaDescricao).toContain('- Azul');
  });

  it('descrição corrigida no banco (texto diferente do ML, mesmas cores) → reenvia', () => {
    const corrigida = DESCRICAO.replace('Fio de alta resistência.', 'Texto corrigido sem preço.');
    const r = resolverDescricaoUpdate(corrigida, ['Branco', 'Preto'], limpa);
    expect(r?.precisaPush).toBe(true);
  });

  it('compara sanitizado vs ML: descrição com emoji no banco e texto-puro no ML não dispara push falso', () => {
    // o banco guarda com emoji (🧵 🎨…); o ML guarda sem. A comparação sanitiza antes.
    const r = resolverDescricaoUpdate(DESCRICAO, ['Branco', 'Preto'], limpa);
    expect(r?.precisaPush).toBe(false);
  });

  it('idempotência: após o push, recomputar com o ML já atualizado → não reenvia', () => {
    const nova = atualizarSecaoCores(DESCRICAO, ['Branco', 'Preto', 'Azul']);
    const liveAposPush = sanitizarDescricaoML(nova).trim();
    const r = resolverDescricaoUpdate(DESCRICAO, ['Branco', 'Preto', 'Azul'], liveAposPush);
    expect(r?.precisaPush).toBe(false);
  });
});

describe('sanitizarDescricaoML', () => {
  it('remove emoji decorativo e o espaço órfão no início da linha', () => {
    expect(sanitizarDescricaoML('🧵 QUALIDADE PROFISSIONAL')).toBe('QUALIDADE PROFISSIONAL');
  });
  it('checkmark vira hífen de lista', () => {
    expect(sanitizarDescricaoML('✔ Alta resistência')).toBe('- Alta resistência');
  });
  it('mantém bullet • e acentos (aceitos pelo ML)', () => {
    expect(sanitizarDescricaoML('• Composição: 100% poliéster')).toBe('• Composição: 100% poliéster');
  });
  it('colapsa 3+ quebras de linha em parágrafo único', () => {
    expect(sanitizarDescricaoML('a\n\n\n\nb')).toBe('a\n\nb');
  });
  it('texto sem emoji passa intacto', () => {
    expect(sanitizarDescricaoML('Fita 10 metros, 15 mm.')).toBe('Fita 10 metros, 15 mm.');
  });
});
