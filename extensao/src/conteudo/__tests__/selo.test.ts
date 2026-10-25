// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { RespostaAnuncio } from '../../../../supabase/functions/_shared/extensao/analisar-anuncio.ts';
import type { MargemTipo } from '../../../../supabase/functions/_shared/extensao/tipos.ts';
import { aoMensagemDoSw, comSessaoEstavel, textoDoSelo, tomDoSelo } from '../selo';

const tipo = (o: Partial<MargemTipo>): MargemTipo => ({ comissao: 0, imposto: 0, frete: 0, custo: null, recebe: 0, lucro: null, margemPct: null, avisos: [], ...o });
const resp = (margem: RespostaAnuncio['margem'], proprio = false): RespostaAnuncio =>
  ({ proprio, catalogoCriadoEm: null, vendedor: null, margem, custo: {} as RespostaAnuncio['custo'], parametros: {} as RespostaAnuncio['parametros'] });
const comClassico = (c: MargemTipo | null) =>
  resp({ preco: 100, classico: c ? { estado: 'ok', valor: c } : { estado: 'indisponivel', motivo: 'x' }, premium: { estado: 'indisponivel', motivo: 'x' } });

describe('textoDoSelo', () => {
  it('com lucro', () => {
    expect(textoDoSelo(comClassico(tipo({ recebe: 120, custo: 52.76, lucro: 67.24, margemPct: 31.54 })))).toBe('Minha margem R$ 67,24 (31,54%)');
  });
  it('sem custo', () => {
    expect(textoDoSelo(comClassico(tipo({ recebe: 1234.5 })))).toBe('Recebe R$ 1.234,50 · informe o custo');
  });
  it('anúncio próprio', () => {
    expect(textoDoSelo(resp(null, true))).toBe('Anúncio seu · abrir no PubliAI');
  });
  it('Clássico indisponível ou margem nula → convite neutro (o painel mostra o que falta)', () => {
    expect(textoDoSelo(comClassico(null))).toBe('Calcular minha margem');
    expect(textoDoSelo(resp(null))).toBe('Calcular minha margem');
    expect(tomDoSelo(comClassico(null))).toBe('neutro');
  });
});

describe('tomDoSelo (cor do selo)', () => {
  it('lucro positivo, zero e negativo', () => {
    expect(tomDoSelo(comClassico(tipo({ lucro: 10, margemPct: 5 })))).toBe('lucro');
    expect(tomDoSelo(comClassico(tipo({ lucro: 0, margemPct: 0 })))).toBe('lucro');
    expect(tomDoSelo(comClassico(tipo({ lucro: -3.2, margemPct: -2 })))).toBe('prejuizo');
  });
  it('sem custo → neutro; próprio → proprio', () => {
    expect(tomDoSelo(comClassico(tipo({ recebe: 50 })))).toBe('neutro');
    expect(tomDoSelo(resp(null, true))).toBe('proprio');
  });
});

describe('aoMensagemDoSw (selo some quando a sessão muda)', () => {
  const doc = () => {
    const d = document.implementation.createHTMLDocument('ml');
    const b = d.createElement('button');
    b.id = 'publiai-selo';
    d.body.append(b);
    return d;
  };
  it('publiai:sessao-mudou remove o selo', () => {
    const d = doc();
    aoMensagemDoSw({ tipo: 'publiai:sessao-mudou' }, d);
    expect(d.getElementById('publiai-selo')).toBeNull();
  });
  it('ativacao e conta-mudou removem o selo', () => {
    for (const tipo of ['publiai:ativacao', 'publiai:conta-mudou']) {
      const d = doc();
      aoMensagemDoSw({ tipo }, d);
      expect(d.getElementById('publiai-selo')).toBeNull();
    }
  });
  it('outras mensagens não mexem no selo', () => {
    const d = doc();
    for (const m of [null, 'x', { tipo: 'publiai:estado-atualizado' }]) aoMensagemDoSw(m, d);
    expect(d.getElementById('publiai-selo')).not.toBeNull();
  });
});

describe('comSessaoEstavel (análise em voo quando a sessão muda não cria selo)', () => {
  it('sessao-mudou durante o await → null', async () => {
    let soltar!: (v: string) => void;
    const r = comSessaoEstavel(new Promise<string>((res) => { soltar = res; }));
    aoMensagemDoSw({ tipo: 'publiai:sessao-mudou' }, document.implementation.createHTMLDocument('ml'));
    soltar('margem da org A');
    expect(await r).toBeNull();
  });
  it('sem mudança → devolve a resposta', async () => {
    expect(await comSessaoEstavel(Promise.resolve('ok'))).toBe('ok');
  });
});
