/**
 * Título de roupa em grade (ADR-0184, emenda 2026-10-18 "palavras-chave"): [Kit N] + Peça +
 * [Sinônimo] + Público + Característica + [Característica 2] + Tecido + [Uso] + [Cor] + [Marca].
 *
 * Roda DEPOIS de normalizarSlots/aplicarGuardsTitulo/validarSlotsAncorados (que já trataram
 * marca, marketing e contagem) e substitui removerSlotsRedundantes na grade. Tudo aqui opera
 * sobre slots — a montagem continua única, no fim (titulo-montar.ts).
 */
import { ehCorIndefinida } from '../cor/indefinida.ts';
import type { DadosFonteTitulo } from './titulo-guards.ts';
import { extrairContagem } from './titulo.ts';
import { ORDEM_LEITURA_GRADE, type SlotTitulo, type TituloSlots } from './titulo-slots.ts';

// Sem acento, minúsculo, só letra/dígito/% — compara TOKEN inteiro, nunca substring.
function tok(w: string): string {
  return w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9%]/g, '');
}
function tokens(s: string): string[] {
  return (s ?? '').split(/\s+/).map(tok).filter(Boolean);
}

const ATONAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'com', 'sem', 'para', 'por', 'a', 'o']);

// Regra do Diego: promessa, adjetivo vazio e logística nunca entram — por PALAVRA, qualquer slot.
const PROIBIDOS = new Set([
  'promocao', 'imperdivel', 'barato', 'barata', 'frete', 'gratis', 'original', 'originais',
  'garantido', 'garantida', 'garantia', 'milagroso', 'milagrosa', 'lindo', 'linda', 'maravilhoso',
  'maravilhosa', 'perfeito', 'perfeita', 'premium', 'melhor', 'envio', 'pagamento', 'top',
]);
// "Top" é peça de roupa: proibido como adjetivo, nunca no slot `produto`.
const PERMITIDOS_EM_PRODUTO = new Set(['top']);

// Pontuação excessiva, emoji e traço decorativo saem dos slots.
const RE_DECORATIVO = /[!?*]|\p{Extended_Pictographic}|\s[-–—]+\s|^[-–—]+\s*|\s*[-–—]+$/gu;

/** Gênero cadastrado (ADR-0182) → palavras aceitas no slot `publico`. */
const PUBLICO_POR_GENERO: Record<string, string[]> = {
  masculino: ['masculino', 'masculina'],
  feminino: ['feminino', 'feminina'],
  unissex: ['unissex'],
  meninos: ['infantil', 'menino', 'masculino'],
  meninas: ['infantil', 'menina', 'feminino'],
  sem_genero_infantil: ['infantil'],
};
const TODO_VOCABULARIO_GENERO = new Set([
  ...Object.values(PUBLICO_POR_GENERO).flat(), 'masculinos', 'femininos', 'meninas', 'meninos',
]);

// Emenda ADR-0184 (2026-10-18): a IA escreveu "Camisa Masculino" (forma da lista, concordância
// errada). Exceções medidas da regra do "a" final; peça nova fora delas segue a regra.
const PECA_MASCULINA_EM_A = new Set(['pijama', 'sutia', 'cardiga']);
const PECA_FEMININA_SEM_A = new Set(['legging', 'leggings', 'lingerie', 'polo']);

/** Público determinístico pelo gênero do cadastro, concordando com a 1ª palavra da peça. */
function publicoPadrao(genero: string, produto: string): string {
  if (genero === 'unissex') return 'Unissex';
  if (genero === 'meninos') return 'Infantil Menino';
  if (genero === 'meninas') return 'Infantil Menina';
  if (genero === 'masculino' || genero === 'feminino') {
    // Plural concorda pelo singular ("Camisetas" → feminina).
    const peca = tok(produto.split(/\s+/)[0] ?? '').replace(/(?<=a)s$/, '');
    const fem = PECA_FEMININA_SEM_A.has(peca) || (peca.endsWith('a') && !PECA_MASCULINA_EM_A.has(peca));
    return genero === 'masculino' ? (fem ? 'Masculina' : 'Masculino') : (fem ? 'Feminina' : 'Feminino');
  }
  return 'Infantil';
}

/** Devolve o `publico` e, se a IA pôs na peça um gênero que contradiz o cadastro, a peça sem ele. */
function guardPublico(slots: TituloSlots, fonte: DadosFonteTitulo): { produto: string; publico: string } {
  const genero = fonte.genero?.trim();
  const aceitos = genero ? PUBLICO_POR_GENERO[genero] : undefined;
  if (!aceitos) return { produto: slots.produto, publico: '' }; // sem gênero cadastrado: nunca inventa
  const generoNaPeca = tokens(slots.produto).filter((t) => TODO_VOCABULARIO_GENERO.has(t));
  // Peça que já traz o gênero CERTO ("Conjunto Infantil") não ganha outro.
  if (generoNaPeca.length > 0 && generoNaPeca.every((t) => aceitos.includes(t))) {
    return { produto: slots.produto, publico: '' };
  }
  // Gênero errado na peça ("Cueca Boxer Feminina" numa família masculina): a palavra sai (achado Codex).
  const produto = slots.produto.split(/\s+/).filter((p) => !TODO_VOCABULARIO_GENERO.has(tok(p))).join(' ');

  // Emenda 2026-10-18 (palavras-chave): o público é sempre do código; "Plus Size" é característica.
  return { produto, publico: publicoPadrao(genero!, produto) };
}

function semProibidos(valor: string, slot: SlotTitulo): string {
  return valor
    .split(/\s+/)
    .filter((p) => {
      const t = tok(p);
      return !PROIBIDOS.has(t) || (slot === 'produto' && PERMITIDOS_EM_PRODUTO.has(t));
    })
    .join(' ');
}

/** Slot sem nenhuma letra ("100%") ou só com átona sobrando não informa nada. */
function aproveitavel(valor: string): string {
  const ts = tokens(valor);
  return ts.some((t) => /[a-z]/.test(t) && !ATONAS.has(t)) ? valor : '';
}

const RE_PERCENTUAL = /^\d+(?:[.,]\d+)?%$/;

/** Tecido sem composição (emenda 2026-10-18): "90% Algodão e 10% Elastano" → "Algodão Com
 *  Elastano"; "100% Algodão" → "Algodão". No máximo duas fibras; sem percentual fica como está. */
function tecidoSemPercentual(valor: string): string {
  const palavras = separarPercentual(valor).split(/\s+/).filter(Boolean);
  if (!palavras.some((p) => RE_PERCENTUAL.test(p))) return valor;
  const fibras: string[][] = [];
  for (const p of palavras) {
    if (RE_PERCENTUAL.test(p)) { fibras.push([]); continue; }
    if (fibras.length === 0) fibras.push([]);
    fibras[fibras.length - 1].push(p);
  }
  const nomes = fibras
    .map((f) => { const w = [...f]; while (w.length && ATONAS.has(tok(w[w.length - 1]))) w.pop(); return w.join(' '); })
    .filter(Boolean);
  return nomes.slice(0, 2).join(' Com ');
}

// Tamanho nunca entra no título (nem disfarçado de característica).
const TAMANHOS = new Set(['pp', 'p', 'm', 'g', 'gg', 'ggg', 'xg', 'xgg', 'eg', 'egg', 'g1', 'g2', 'g3', 'g4']);
function semTamanho(valor: string): string {
  return valor.replace(/\b\d{1,2}\s+anos?\b/gi, ' ')
    .split(/\s+/).filter((p) => !TAMANHOS.has(tok(p))).join(' ').replace(/\s{2,}/g, ' ').trim();
}

/** Sequência de tokens da fonte sem as átonas de ligação — "com"/"sem"/"para" ficam, porque
 *  mudam o sentido ("Sem Bolso" não comprova "Com Bolso"). */
const LIGACAO = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'a', 'o']);
/** "100%algodão" → "100% algodão" (revisão Codex): percentual e fibra são palavras distintas. */
const separarPercentual = (s: string) => s.replace(/(\d+(?:[.,]\d+)?%)(?=\p{L})/gu, '$1 ');
const seq = (s: string) => tokens(separarPercentual(s)).filter((t) => !LIGACAO.has(t));

/** Característica/uso: a EXPRESSÃO precisa aparecer contígua na fonte (não basta cada palavra). */
function expressaoAncorada(valor: string, fonteSeq: string[]): string {
  const v = seq(valor);
  if (v.length === 0) return '';
  for (let i = 0; i + v.length <= fonteSeq.length; i++) {
    if (v.every((t, j) => fonteSeq[i + j] === t)) return valor;
  }
  return '';
}

/** Ocorrência negada: logo depois de "sem", ou até 2 palavras depois de "não" ("não contém X"). */
function negada(fonteSeq: string[], i: number): boolean {
  return fonteSeq[i - 1] === 'sem' || fonteSeq[i - 1] === 'nao' || fonteSeq[i - 2] === 'nao';
}

/** Tecido: cada palavra na fonte e nunca só depois de "sem" (declaração positiva). */
function tecidoAncorado(valor: string, fonteSeq: string[]): string {
  const positivas = new Set(fonteSeq.filter((_, i) => !negada(fonteSeq, i)));
  const ts = tokens(valor).filter((t) => !ATONAS.has(t));
  return ts.length > 0 && ts.every((t) => positivas.has(t)) ? valor : '';
}

/** Sinônimo da peça (emenda 2026-10-18): dicionário fechado; o termo também precisa estar na fonte
 *  (T7, validarSlotsAncorados). O dicionário autoriza a equivalência, nunca cria palavra. */
const SINONIMOS: Record<string, string[]> = {
  short: ['bermuda'], bermuda: ['short'], moletom: ['blusa de frio'], 'blusa de frio': ['moletom'],
  jaqueta: ['casaco'], casaco: ['jaqueta'],
};
function sinonimoValido(produto: string, sinonimo: string, fonte: string): string {
  const peca = tokens(produto).join(' ');
  const alvo = tokens(sinonimo);
  const pares = Object.entries(SINONIMOS).find(([p]) => peca === p || peca.startsWith(`${p} `))?.[1];
  if (!pares?.includes(alvo.join(' '))) return '';
  // Revisão Codex: "Não é casaco" e "tecido moletom" citam a palavra sem nomear a peça.
  const ts = tokens(separarPercentual(fonte));
  const comoPeca = ts.some((_, i) => alvo.every((a, j) => ts[i + j] === a)
    && !negada(ts, i) && !['tecido', 'em', 'de'].includes(ts[i - 1] ?? ''));
  return comoPeca ? sinonimo : '';
}

/** Palavra repetida sai do slot posterior. `produto`, cor e kit nunca perdem palavra: entram
 *  primeiro no conjunto visto, e quem cede é o slot comum (achado Codex r2). */
// Emenda 2026-10-18: prioridade própria — quem vem antes fica com a palavra. Marca e sinônimo
// são expressões inteiras: repetiu, sai o slot todo (nunca "mutilar" uma marca).
const PRIORIDADE_DEDUPE: SlotTitulo[] = ['publico', 'material', 'caracteristica', 'caracteristica2', 'marca', 'aplicacao', 'sinonimo'];
const INTEIROS = new Set<SlotTitulo>(['marca', 'sinonimo']);

/** Característica que começa pela fibra principal do tecido ("Algodão Egípcio" × "Algodão Com
 *  Elastano") é qualificador do tecido: vira o tecido inteiro ("Algodão Egípcio Com Elastano"),
 *  em vez de se partir em "Egípcio Algodão…" na deduplicação. */
function absorverNoTecido(out: TituloSlots): void {
  const fibra = out.material.split(/\s+/)[0] ?? '';
  if (!tok(fibra)) return;
  for (const slot of ['caracteristica', 'caracteristica2'] as const) {
    const palavras = out[slot].split(/\s+/);
    if (tok(palavras[0] ?? '') !== tok(fibra)) continue;
    const ja = new Set(palavras.map(tok));
    const resto = out.material.split(/\s+/).slice(1).filter((p) => !ja.has(tok(p)) || ATONAS.has(tok(p)));
    const limpo = (ws: string[]) => ws.join(' ').replace(/(\s+(?:com|e))+$/i, '').replace(/^(?:com|e)$/i, '').trim();
    // 1ª característica (incortável) fica com a fibra qualificada; o resto do tecido segue no
    // material cortável — nem duplica, nem perde a característica, nem estoura (revisão Codex).
    if (slot === 'caracteristica') out.material = limpo(resto);
    else { out.material = limpo([...palavras, ...resto]); out.caracteristica2 = ''; }
    return;
  }
}

function deduplicar(slots: TituloSlots): TituloSlots {
  const out = { ...slots };
  absorverNoTecido(out);
  const fixos: SlotTitulo[] = ['produto', 'variacao', 'quantidade'];
  const vistos = new Set(fixos.flatMap((s) => tokens(out[s])).filter((t) => !ATONAS.has(t)));
  for (const slot of PRIORIDADE_DEDUPE) {
    if (!out[slot]) continue;
    if (INTEIROS.has(slot)) {
      if (tokens(out[slot]).some((t) => !ATONAS.has(t) && vistos.has(t))) out[slot] = '';
      for (const t of tokens(out[slot])) if (!ATONAS.has(t)) vistos.add(t);
      continue;
    }
    // Percentual colado na palavra removida sai junto ("90% Algodão" → nada, nunca "90%" órfão).
    const palavras = out[slot].split(/\s+/);
    const sai = palavras.map((p) => { const t = tok(p); return !!t && !ATONAS.has(t) && vistos.has(t); });
    const mantidas = palavras.filter((p, i) => !sai[i] && !(/^\d+(?:[.,]\d+)?%$/.test(p) && sai[i + 1]));
    // Átona pendurada nas pontas DEPOIS de uma remoção sai ("Linho com Linho" → "com" solto);
    // sem remoção, "Com Bolso" é legítimo e fica.
    if (mantidas.length < out[slot].split(/\s+/).length) {
      while (mantidas.length && ATONAS.has(tok(mantidas[0]))) mantidas.shift();
      while (mantidas.length && ATONAS.has(tok(mantidas[mantidas.length - 1]))) mantidas.pop();
    }
    out[slot] = aproveitavel(mantidas.join(' '));
    for (const t of tokens(out[slot])) if (!ATONAS.has(t)) vistos.add(t);
  }
  return out;
}

export function aplicarRegrasGrade(slots: TituloSlots, fonte: DadosFonteTitulo): TituloSlots {
  const fonteTokens = new Set(tokens(`${fonte.nomePai} ${fonte.descricaoPai}`));
  // Fora da estrutura: não renderiza na grade; zerar deixa o diagnóstico (ADR-0116) honesto.
  const out: TituloSlots = { ...slots, modelo: '', medida: '', compatibilidade: '' };
  const fonteSeq = seq(`${fonte.nomePai} ${fonte.descricaoPai}`);

  for (const slot of ORDEM_LEITURA_GRADE) {
    out[slot] = semProibidos(out[slot].replace(RE_DECORATIVO, ' '), slot).replace(/\s{2,}/g, ' ').trim();
  }
  for (const slot of ['sinonimo', 'caracteristica', 'caracteristica2', 'material', 'aplicacao'] as const) {
    out[slot] = semTamanho(out[slot]);
  }
  out.material = out.material ? tecidoAncorado(tecidoSemPercentual(out.material), fonteSeq) : '';
  for (const slot of ['caracteristica', 'caracteristica2', 'aplicacao'] as const) {
    out[slot] = out[slot] ? expressaoAncorada(out[slot], fonteSeq) : '';
  }
  out.sinonimo = out.sinonimo ? sinonimoValido(out.produto, out.sinonimo, `${fonte.nomePai} ${fonte.descricaoPai}`) : '';
  // Revisão Codex: a peça não é passagem para qualificador inventado ("Camisa Social Slim Fit"
  // com fonte "Camisa Algodão"). A 1ª palavra (a peça) fica sempre — zerar derrubaria a família.
  const fonteTodos = new Set(tokens(separarPercentual(`${fonte.nomePai} ${fonte.descricaoPai}`)));
  out.produto = out.produto.split(/\s+/)
    .filter((p, i) => i === 0 || !tok(p) || ATONAS.has(tok(p)) || fonteTodos.has(tok(p)))
    .join(' ');
  ({ produto: out.produto, publico: out.publico } = guardPublico(out, fonte));

  // Kit: aplicarGuardsTitulo já reduziu a contagem ancorada a "Nun"/"Npc" (N > 1).
  // O número também precisa estar na fonte (a contagem da IA sem respaldo não entra).
  const n = out.quantidade.match(/^(\d+)(?:un|pc)$/i)?.[1];
  const daFonte = extrairContagem(`${fonte.nomePai}\n${fonte.descricaoPai}`)?.match(/^\d+/)?.[0];
  // "Conjunto 2 Peças" descreve o conjunto, não um pacote de 2 conjuntos (emenda 2026-10-18).
  const pecasDoConjunto = /pc$/i.test(out.quantidade) && tok(out.produto.split(/\s+/)[0] ?? '') === 'conjunto';
  out.quantidade = n && !pecasDoConjunto && (n === daFonte || fonteTokens.has(n)) ? `Kit ${n}` : '';

  // Cor (ADR-0044, decisão do Diego): só a cor única entra, e só se a peça/público ainda não a
  // dizem. Sem cor única, `variacao` vazia — tamanho nunca vai para o título.
  const corUnica = fonte.cores.length === 1 ? fonte.cores[0] : null;
  const coberta = !!corUnica && tokens(corUnica).every((t) => tokens(out.produto).includes(t));
  out.variacao = corUnica && !ehCorIndefinida(corUnica) && !coberta ? corUnica : '';

  return deduplicar(out);
}
