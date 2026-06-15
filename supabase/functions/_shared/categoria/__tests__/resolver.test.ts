import { describe, it, expect } from 'vitest';
import { resolverCategoria, type DepsResolver } from '../resolver';
import type { CategoriaCandidata } from '../../ml/domain-discovery';

const furadeira: CategoriaCandidata[] = [
  { domainId: 'MLB-ELECTRIC_DRILLS', domainName: 'Furadeiras elétricas', categoriaId: 'MLB189007', categoriaNome: 'De Mão' },
  { domainId: 'MLB-HAMMER_DRILLS', domainName: 'Furadeiras', categoriaId: 'MLB430376', categoriaNome: 'Marteletes' },
];
const caderno: CategoriaCandidata[] = [
  { domainId: 'MLB-NOTEBOOKS_AND_WRITING_PADS', domainName: 'Cadernos', categoriaId: 'MLB105305', categoriaNome: 'Cadernos' },
];
const furadeiraComTopoRuim: CategoriaCandidata[] = [
  { domainId: 'MLB-NETWORK_GATEWAYS', domainName: 'Adaptadores e Gateways', categoriaId: 'MLB11400', categoriaNome: 'Adaptadores e Gateways' },
  { domainId: 'MLB-ELECTRIC_DRILLS', domainName: 'Furadeiras elétricas', categoriaId: 'MLB189007', categoriaNome: 'De Mão' },
];
const furadeiraSemCandidatoCompativel: CategoriaCandidata[] = [
  { domainId: 'MLB-NETWORK_GATEWAYS', domainName: 'Adaptadores e Gateways', categoriaId: 'MLB11400', categoriaNome: 'Adaptadores e Gateways' },
];

const deps = (candidatos: CategoriaCandidata[], llm?: DepsResolver['llm']): DepsResolver => ({
  preditor: async () => candidatos,
  llm,
});

describe('resolverCategoria', () => {
  it('(a) override casa → regex, sem chamar o preditor', async () => {
    let chamou = false;
    const r = await resolverCategoria({ nome: 'FITA CETIM PROGRESSO N.3 10MT' }, {
      preditor: async () => { chamou = true; return []; },
    });
    expect(r.origem).toBe('regex');
    expect(r.categoriaId).toBe('MLB255054');
    expect(r.tipo).toBe('fita');
    expect(chamou).toBe(false);
  });

  it('(b) sem override, preditor 1 domain → preditor (topo)', async () => {
    const r = await resolverCategoria({ nome: 'Caderno universitário 10 matérias' }, deps(caderno));
    expect(r.origem).toBe('preditor');
    expect(r.categoriaId).toBe('MLB105305');
    expect(r.categoriaNome).toBe('Cadernos');
    expect(r.tipo).toBe('outro');
  });

  it('(c) sem override, ≥2 domains + llm escolhe candidato ≠ topo → ia', async () => {
    const r = await resolverCategoria({ nome: 'Martelete demolidor' }, deps(furadeira, async () => 'MLB430376'));
    expect(r.origem).toBe('ia');
    expect(r.categoriaId).toBe('MLB430376');
  });

  it('(d) llm devolve id fora da lista → topo (preditor)', async () => {
    const r = await resolverCategoria({ nome: 'Furadeira' }, deps(furadeira, async () => 'MLB999999'));
    expect(r.origem).toBe('preditor');
    expect(r.categoriaId).toBe('MLB189007');
  });

  it('(e) preditor [] → manual/outro', async () => {
    const r = await resolverCategoria({ nome: 'Produto inexistente xyz' }, deps([]));
    expect(r.origem).toBe('manual');
    expect(r.categoriaId).toBeNull();
    expect(r.tipo).toBe('outro');
  });

  it('(f) ambíguo mas sem deps.llm → topo (preditor)', async () => {
    const r = await resolverCategoria({ nome: 'Furadeira' }, deps(furadeira));
    expect(r.origem).toBe('preditor');
    expect(r.categoriaId).toBe('MLB189007');
  });

  it('(g) llm escolhe o próprio topo → permanece preditor', async () => {
    const r = await resolverCategoria({ nome: 'Furadeira' }, deps(furadeira, async () => 'MLB189007'));
    expect(r.origem).toBe('preditor');
  });

  it('(h) preditor lança → manual (resiliente)', async () => {
    const r = await resolverCategoria({ nome: 'Algo' }, { preditor: async () => { throw new Error('rede'); } });
    expect(r.origem).toBe('manual');
  });

  it('(i) pista forte no título corrige topo semanticamente incompatível', async () => {
    const r = await resolverCategoria(
      { nome: 'AUDITORIA E1E4 FURADEIRA 650W BIVOLT' },
      deps(furadeiraComTopoRuim),
    );
    expect(r.categoriaId).toBe('MLB189007');
    expect(r.categoriaNome).toBe('De Mão');
  });

  it('(j) pista forte sem candidato compatível → manual (não inventa categoria, operador decide)', async () => {
    const r = await resolverCategoria(
      { nome: 'AUDITORIA REVALIDACAO FURADEIRA 650W BIVOLT' },
      deps(furadeiraSemCandidatoCompativel),
    );
    expect(r.origem).toBe('manual');
    expect(r.categoriaId).toBeNull();
    expect(r.tipo).toBe('outro');
  });
});
