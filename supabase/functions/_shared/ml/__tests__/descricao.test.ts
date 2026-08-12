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

  it('sem cabeçalho e sem cor real, retorna o texto original intacto', () => {
    const semCabecalho = 'Produto sem seção de cores.\n\nFita 10m.';
    expect(atualizarSecaoCores(semCabecalho, [])).toBe(semCabecalho);
  });

  it('sem cabeçalho mas com cor real, recria a seção ao final (simétrico à remoção)', () => {
    // Bug real achado na revisão (Codex): a seção some quando cores=[] (ex.: família só
    // com cor indefinida/"Outra") e persiste sem cabeçalho; se depois entra cor real, a
    // função antiga não sabia recriar — a cor nunca mais aparecia na descrição.
    const semCabecalho = 'Produto sem seção de cores.\n\nFita 10m.';
    const out = atualizarSecaoCores(semCabecalho, ['Azul']);
    expect(out).toContain('Produto sem seção de cores.');
    expect(out).toContain('Fita 10m.');
    expect(out).toContain('🎨 CORES DISPONÍVEIS');
    expect(out).toContain('- Azul');
  });

  it('round-trip: remover a seção (cores=[]) e recriar (cores=[Azul]) preserva o texto e mostra a cor nova', () => {
    const semCores = atualizarSecaoCores(DESCRICAO, []);
    const restaurado = atualizarSecaoCores(semCores, ['Azul']);
    expect(restaurado).toContain('- Azul');
    expect(restaurado).toContain('🧵 LINHA PROFISSIONAL');
    expect(restaurado).toContain('📦 CONTEÚDO DA EMBALAGEM');
  });

  it('sem nenhuma cor real (lista vazia) — remove a seção inteira, não deixa cabeçalho pendurado (ADR-0044)', () => {
    const out = atualizarSecaoCores(DESCRICAO, []);
    expect(out).not.toContain('CORES DISPONÍVEIS');
    expect(out).not.toContain('- Branco');
    expect(out).toContain('🧵 LINHA PROFISSIONAL');
    expect(out).toContain('📦 CONTEÚDO DA EMBALAGEM');
    expect(out).toContain('• 1 unidade');
  });

  it('mantém a seção seguinte separada por linha em branco', () => {
    const out = atualizarSecaoCores(DESCRICAO, ['Azul']);
    expect(out).toContain('- Azul\n\n📦 CONTEÚDO DA EMBALAGEM');
  });

  // ADR-0115 — o rótulo da seção passou a variar com o eixo da família.
  it('reconhece ESTAMPAS DISPONÍVEIS e reescreve a lista NO LUGAR, sem criar uma segunda seção', () => {
    const estampada = '🧵 TECIDO\n\n🎨 ESTAMPAS DISPONÍVEIS\n\n- Estampa 6\n\n📦 O QUE VOCÊ RECEBE\n\n• 1 unidade';
    const out = atualizarSecaoCores(estampada, ['Estampa 6', 'Estampa 31']);
    expect(out).toContain('🎨 ESTAMPAS DISPONÍVEIS');
    // Antes do ADR-0115 o cabeçalho não casava e a função recriava "CORES DISPONÍVEIS" no fim:
    // duas listas concorrentes no mesmo anúncio a cada reposição de variação.
    expect(out).not.toContain('CORES DISPONÍVEIS');
    expect(out.match(/DISPON[IÍ]VEIS/g)).toHaveLength(1);
    expect(out).toContain('- Estampa 31');
    expect(out).toContain('📦 O QUE VOCÊ RECEBE');
  });

  it('reconhece VARIAÇÕES DISPONÍVEIS pelo mesmo caminho', () => {
    const out = atualizarSecaoCores('🎨 VARIAÇÕES DISPONÍVEIS\n\n- Tam.P', ['Tam.P', 'Tam.G']);
    expect(out).toContain('🎨 VARIAÇÕES DISPONÍVEIS');
    expect(out).not.toContain('CORES DISPONÍVEIS');
    expect(out).toContain('- Tam.G');
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

  /**
   * ADR-0103. `✅` é cabeçalho de seção no template, não bullet — mas caía na mesma regra dos
   * checkmarks e virava "- BENEFÍCIOS", um título de seção disfarçado de item de lista. Medido:
   * a string `✅ BENEFÍCIOS` aparece em 295 descrições e `✅` NUNCA aparece em outra posição.
   */
  it('cabeçalho de seção com ✅ vira título, não bullet', () => {
    expect(sanitizarDescricaoML('✅ BENEFÍCIOS')).toBe('BENEFÍCIOS');
  });

  it('✔ e ☑ continuam virando hífen de lista', () => {
    expect(sanitizarDescricaoML('✔ Alta resistência')).toBe('- Alta resistência');
    expect(sanitizarDescricaoML('☑ Item')).toBe('- Item');
  });

  /**
   * O gerador de copy separa as seções só pelo emoji do cabeçalho, sem linha em branco — e é a
   * sanitização que remove esse emoji antes de mandar ao ML. Resultado no anúncio publicado
   * (MLB7345071684, relatado pelo operador em 2026-08-06): 31 quebras de linha e ZERO linhas em
   * branco, com os títulos de seção colados no parágrafo anterior. O respiro tem que ser
   * reconstruído aqui, que é onde o marcador visual é perdido.
   */
  it('cabeçalho sem linha em branco ao redor ganha respiro', () => {
    const colada = ['🧵 POMADA REPARADORA', 'Texto de abertura.', '✅ BENEFÍCIOS', '✔ Um', '✔ Dois', '📌 ESPECIFICAÇÕES', '• Marca: Eucerin'].join('\n');
    expect(sanitizarDescricaoML(colada)).toBe([
      'POMADA REPARADORA', '', 'Texto de abertura.', '', 'BENEFÍCIOS', '', '- Um', '- Dois', '', 'ESPECIFICAÇÕES', '', '• Marca: Eucerin',
    ].join('\n'));
  });

  it('é idempotente: sanitizar duas vezes não muda o espaçamento', () => {
    const colada = ['🧵 TÍTULO', 'Abertura.', '✅ BENEFÍCIOS', '✔ Um'].join('\n');
    const uma = sanitizarDescricaoML(colada);
    expect(sanitizarDescricaoML(uma)).toBe(uma);
  });

  it('descrição legada inteira: cabeçalhos limpos, bullets preservados', () => {
    const legada = ['🧵 FITA DE CETIM', '', '✅ BENEFÍCIOS', '', '✔ Macia', '✔ Durável', '', '📌 ESPECIFICAÇÕES', '', '• Marca: Búfalo'].join('\n');
    expect(sanitizarDescricaoML(legada)).toBe(
      ['FITA DE CETIM', '', 'BENEFÍCIOS', '', '- Macia', '- Durável', '', 'ESPECIFICAÇÕES', '', '• Marca: Búfalo'].join('\n'),
    );
  });
});
