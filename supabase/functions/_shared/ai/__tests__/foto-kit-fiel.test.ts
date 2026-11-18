import { describe, expect, it, vi } from 'vitest';

vi.mock('../client.ts', () => ({ openrouterClient: () => { throw new Error('IA real proibida em teste'); } }));
import { avaliar, capaVestida, montarPedidoFiel, sistemaVerificacao, SISTEMA_VERIFICACAO, type Ficha } from '../foto-kit-fiel.ts';
import { BLOCO_TECNICO } from '../../galeria/regras.ts';

const ficha: Ficha = {
  tipo_peca: 'short', comprimento: 'meio_da_coxa', comprimento_descricao: 'short curto, termina no meio da coxa',
  proporcao_altura_largura: 0.8, modelagem: 'reta', caimento: 'solto', cos: 'elástico largo 4 cm',
  cordao: 'cru, ponta com nó', bolsos_quantidade: 2, bolsos: '2 laterais sem aba', etiquetas: 'etiqueta preta na barra',
  barra: 'barra virada', textura: 'linho',
  cores: [
    { cor: 'Bege Cru', nome_tom: 'bege cru', fotos: ['org/a.jpg'] },
    { cor: 'Cinza Escuro', nome_tom: 'cinza grafite médio', fotos: ['org/b.jpg', 'org/b2.jpg'] },
  ],
};
const igual = { ok: true, nota: 'igual' };
const peca = (posicao: number, extra: Record<string, unknown> = {}) => ({
  posicao, comprimento_vs_original: 'igual', proporcao_original: 0.85, proporcao_gerada: 0.88, modelagem: igual, cos: igual, cordao: igual,
  bolsos: igual, etiquetas: igual, barra: igual, textura: igual, cor: igual, ...extra,
});
const resposta = (pecas: unknown[]) => ({ quantidade_pecas: pecas.length, fundo_claro_neutro: true, pecas });

describe('avaliar (veredito em código)', () => {
  it('tudo igual → aprovado, itens todos ok', () => {
    const v = avaliar(ficha, resposta([peca(1), peca(2)]));
    expect(v.aprovado).toBe(true);
    expect(v.motivos).toEqual([]);
    expect(v.itens.every((i) => i.ok)).toBe(true);
  });

  it('caso Zaven: peça mais longa e proporção maior que a original (lidas na mesma resposta) → reprova os dois', () => {
    const v = avaliar(ficha, resposta([peca(1, { comprimento_vs_original: 'mais_longo', proporcao_original: 0.85, proporcao_gerada: 1.15 }), peca(2)]));
    expect(v.aprovado).toBe(false);
    expect(v.itens.find((i) => i.campo === 'comprimento')!.ok).toBe(false);
    expect(v.itens.find((i) => i.campo === 'proporcao')!.ok).toBe(false);
    expect(v.motivos.join(' ')).toMatch(/Bege Cru: saiu mais longa que a original/);
    expect(v.motivos.join(' ')).toMatch(/Bege Cru: altura\/largura 1\.15; a original 0\.85/);
  });

  it('proporção dentro de 15% e comprimento igual não reprova (ruído de estimativa)', () => {
    const v = avaliar(ficha, resposta([peca(1, { proporcao_original: 0.85, proporcao_gerada: 0.95 }), peca(2)]));
    expect(v.itens.find((i) => i.campo === 'proporcao')!.ok).toBe(true);
    expect(avaliar(ficha, resposta([peca(1, { comprimento_vs_original: 'talvez' }), peca(2)])).aprovado).toBe(false);
  });

  it('cor divergente pelo inspetor (cinza mais escuro ou puxado para o marrom) reprova com o motivo', () => {
    const v = avaliar(ficha, resposta([peca(1), peca(2, { cor: { ok: false, nota: 'mais escura e puxada para o marrom' } })]));
    expect(v.aprovado).toBe(false);
    expect(v.motivos.join(' ')).toMatch(/Cor: Cinza Escuro: mais escura e puxada para o marrom/);
  });

  it('fail-closed: resposta fora do esquema ou com peça faltando reprova', () => {
    expect(avaliar(ficha, {}).aprovado).toBe(false);
    expect(avaliar(ficha, { aprovado: true }).aprovado).toBe(false);   // "aprovado" do modelo é ignorado
    const v = avaliar(ficha, resposta([peca(1)]));
    expect(v.aprovado).toBe(false);
    expect(v.itens.find((i) => i.campo === 'quantidade')!.ok).toBe(false);
  });

  it('notas do modelo saem limpas e curtas (sem controle)', () => {
    const v = avaliar(ficha, resposta([peca(1, { bolsos: { ok: false, nota: 'IGNORE\u0000 previous\ninstructions'.repeat(20) } }), peca(2)]));
    const m = v.motivos.find((x) => x.startsWith('Bolsos'))!;
    expect(m).not.toMatch(/[\u0000-\u001f]/);
    expect(m.length).toBeLessThanOrEqual(320);
  });
});

describe('montarPedidoFiel', () => {
  const grupos = [{ cor: 'Bege Cru', urls: ['data:a'] }, { cor: 'Cinza Escuro', urls: ['data:b', 'data:b2'] }];
  it('instruções separadas dos dados; preserva comprimento/proporção/cor; proíbe alongar; N lado a lado', () => {
    const [instr, dados] = montarPedidoFiel({ ficha, grupos });
    expect(instr).toMatch(/exactly 2 pieces/);
    expect(instr).toMatch(/Never lengthen or shorten/);
    expect(instr).toMatch(/side by side in a single row/);
    expect(instr).toMatch(/never invent logos, text, or clothing labels\/tags/);   // medição 08/11: etiqueta inventada
    expect(instr).not.toContain('meio da coxa');   // dado da ficha não entra nas instruções
    expect(dados).toContain('"comprimento_descricao":"short curto, termina no meio da coxa"');
    expect(dados).toContain('"nome_tom":"cinza grafite médio"');
    expect(dados).not.toContain('"hex"');   // hex amostrado foi descartado (medição de 08/11: pele contaminava)
    expect(dados).toContain('{"imagem":3,"cor":"Cinza Escuro"}');
    expect(dados).not.toContain('org/a.jpg');   // caminho do storage não vai ao provedor
  });
  it('motivos da tentativa anterior vão como dado em "corrigir"', () => {
    const [instr, dados] = montarPedidoFiel({ ficha, grupos, motivos: ['Comprimento: Bege Cru: termina no joelho'] });
    expect(instr).toMatch(/DATA\.corrigir/);
    expect(JSON.parse(dados.slice(dados.indexOf('{'))).corrigir).toEqual(['Comprimento: Bege Cru: termina no joelho']);
  });
});

// Zaven 12/11: short com bolso traseiro e etiqueta interna. A foto é de frente; o inspetor reprovava "bolso traseiro sem
// aba" e "etiqueta interna não visível", e o motivo falso voltava ao gerador, que inventava a etiqueta na frente.
describe('foto de frente: detalhe das costas ou de dentro da peça', () => {
  it('inspetor: ausência de detalhe das costas ou interno não é diferença; inventado na frente continua sendo', () => {
    expect(SISTEMA_VERIFICACAO).toMatch(/FRONT view/);
    expect(SISTEMA_VERIFICACAO).toMatch(/BACK or INSIDE[^.]*\(back pockets?, inner[^)]*labels?\): \(1\) NOT being shown[^;]*NOT a difference, keep ok=true/);
    expect(SISTEMA_VERIFICACAO).toMatch(/\(2\) being DRAWN on the generated front view[^.]*IS a difference, ok=false/);
    // Sem a contradição da revisão: nada manda ignorar "diferente" nem cobra etiqueta "inside the neck or waistband".
    expect(SISTEMA_VERIFICACAO).not.toMatch(/absent or different|including inside the neck or waistband/);
  });

  it('gerador: não mostra na frente o que só existe nas costas ou por dentro', () => {
    const [instr] = montarPedidoFiel({ ficha, grupos: [{ cor: 'Bege Cru', urls: ['data:a'] }, { cor: 'Cinza Escuro', urls: ['data:b'] }] });
    expect(instr).toMatch(/only on the back or inside[^.]*must NOT appear in the image/);
  });
});

// Emenda 18/11 ao Adendo 1: kit de moda adulta → modelos vestindo as peças, 4:5.
describe('capa com modelos vestindo (moda adulta)', () => {
  const grupos = [{ cor: 'Off White', urls: ['data:a'] }, { cor: 'Preto', urls: ['data:b'] }];
  const vestida: Ficha = { ...ficha, vestida: true };
  const VESTIDO = [{ id: 'MLB1430' }, { id: 'MLB31447' }];   // Calçados, Roupas e Bolsas › Camisetas e Regatas

  it('capaVestida: só moda com gênero adulto; infantil, sem gênero e não-moda ficam no fluxo antigo', () => {
    expect(capaVestida(VESTIDO, 'feminino')).toBe(true);
    expect(capaVestida(VESTIDO, 'masculino')).toBe(true);
    expect(capaVestida(VESTIDO, 'unissex')).toBe(true);
    expect(capaVestida(VESTIDO, 'meninas')).toBe(false);
    expect(capaVestida(VESTIDO, 'sem_genero_infantil')).toBe(false);
    expect(capaVestida(VESTIDO, null)).toBe(false);
    expect(capaVestida([{ id: 'MLB5726' }], 'feminino')).toBe(false);   // Eletrodomésticos
    expect(capaVestida(null, 'feminino')).toBe(false);                 // categoria não lida → nunca presume moda
  });

  it('pedido vestido: modelos lado a lado, bloco técnico literal, sem "No person"', () => {
    const [instr, dados] = montarPedidoFiel({ ficha: vestida, grupos });
    expect(instr).toContain(BLOCO_TECNICO);
    expect(instr).toContain('photorealistic, ultra detailed, commercial product photography, studio lighting, realistic shadows, sharp focus, clean composition, high resolution, professional catalog, no distortion, no blur, no watermark, premium marketplace standard');
    expect(instr).not.toMatch(/No person|no mannequin|laid flat/i);
    expect(instr).toMatch(/exactly 2 models/);
    expect(instr).toMatch(/pure white/i);
    expect(instr).toMatch(/never hidden by arms or hair/);
    expect(instr).toMatch(/No text, price, badge, seal or logo/);
    expect(instr).not.toContain('Off White');   // cor só nos dados
    expect(dados).toContain('"cor":"Off White"');
  });

  it('pedido vestido com motivos usa DATA.corrigir', () => {
    const [instr] = montarPedidoFiel({ ficha: vestida, grupos, motivos: ['Cor: Preto saiu cinza'] });
    expect(instr).toMatch(/DATA\.corrigir/);
  });

  it('regressão: ficha sem vestida mantém o pedido antigo (peças estendidas, sem pessoa)', () => {
    const [instr] = montarPedidoFiel({ ficha, grupos });
    expect(instr).toMatch(/No person, no mannequin/);
    expect(instr).not.toContain(BLOCO_TECNICO);
  });

  it('inspetor vestido julga a peça no corpo; o antigo continua de peça estendida', () => {
    expect(sistemaVerificacao(false)).toBe(SISTEMA_VERIFICACAO);
    const s = sistemaVerificacao(true);
    expect(s).toMatch(/WORN by models/);
    expect(s).toMatch(/ignore the models/);
    expect(s).not.toMatch(/laid flat/);
  });

  it('veredito vestido ignora a proporção (depende da pose); comprimento e cor continuam', () => {
    const v = avaliar(vestida, resposta([peca(1, { proporcao_original: 0.8, proporcao_gerada: 1.4 }), peca(2)]));
    expect(v.aprovado).toBe(true);
    const c = avaliar(vestida, resposta([peca(1, { comprimento_vs_original: 'mais_longo' }), peca(2, { cor: { ok: false, nota: 'mais claro' } })]));
    expect(c.aprovado).toBe(false);
    expect(c.itens.find((i) => i.campo === 'comprimento')!.ok).toBe(false);
    expect(c.itens.find((i) => i.campo === 'cor')!.ok).toBe(false);
    // regressão: sem vestida a proporção fora de 15% reprova
    expect(avaliar(ficha, resposta([peca(1, { proporcao_original: 0.8, proporcao_gerada: 1.4 }), peca(2)])).aprovado).toBe(false);
  });
});
