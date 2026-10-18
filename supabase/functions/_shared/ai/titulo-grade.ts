/**
 * Título de roupa em grade (ADR-0184): Peça + Público + Marca + Característica + Material + Kit.
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

/** Fallback determinístico quando a IA erra ou omite o público.
 *  ponytail: concordância pelo "a" final da peça — erra em exceções ("Pijama" sai feminino); a IA
 *  recebe o gênero e acerta a concordância na maioria dos casos. */
function publicoPadrao(genero: string, produto: string): string {
  if (genero === 'unissex') return 'Unissex';
  if (genero === 'masculino' || genero === 'feminino') {
    const peca = tok(produto.split(/\s+/)[0] ?? '');
    const fem = peca.endsWith('a');
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

  const fonteTokens = new Set(tokens(`${fonte.nomePai} ${fonte.descricaoPai}`));
  const plusSize = fonteTokens.has('plus') && fonteTokens.has('size');
  const ts = tokens(slots.publico);
  const valido = ts.some((t) => aceitos.includes(t))
    && ts.every((t) => aceitos.includes(t) || (plusSize && (t === 'plus' || t === 'size')));
  return { produto, publico: valido ? slots.publico.trim() : publicoPadrao(genero!, produto) };
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

/** Toda palavra (inclusive número/sigla), exceto átona, precisa estar na fonte. */
function ancorado(valor: string, fonteTokens: Set<string>): string {
  const ts = tokens(valor).filter((t) => !ATONAS.has(t));
  return ts.length > 0 && ts.every((t) => fonteTokens.has(t)) ? valor : '';
}

/** Slot sem nenhuma letra ("100%") ou só com átona sobrando não informa nada. */
function aproveitavel(valor: string): string {
  const ts = tokens(valor);
  return ts.some((t) => /[a-z]/.test(t) && !ATONAS.has(t)) ? valor : '';
}

/** Palavra repetida sai do slot posterior. `produto`, cor e kit nunca perdem palavra: entram
 *  primeiro no conjunto visto, e quem cede é o slot comum (achado Codex r2). */
function deduplicar(slots: TituloSlots): TituloSlots {
  const out = { ...slots };
  const fixos: SlotTitulo[] = ['produto', 'variacao', 'quantidade'];
  const vistos = new Set(fixos.flatMap((s) => tokens(out[s])).filter((t) => !ATONAS.has(t)));
  for (const slot of ORDEM_LEITURA_GRADE) {
    if (fixos.includes(slot) || !out[slot]) continue;
    const mantidas = out[slot].split(/\s+/).filter((p) => {
      const t = tok(p);
      return !t || ATONAS.has(t) || !vistos.has(t);
    });
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
  const out: TituloSlots = {
    ...slots, modelo: '', medida: '', compatibilidade: '', aplicacao: '', sinonimo: '',
  };

  for (const slot of ORDEM_LEITURA_GRADE) {
    out[slot] = semProibidos(out[slot].replace(RE_DECORATIVO, ' '), slot).replace(/\s{2,}/g, ' ').trim();
  }
  for (const slot of ['material', 'caracteristica', 'caracteristica2'] as const) {
    out[slot] = out[slot] ? ancorado(out[slot], fonteTokens) : '';
  }
  ({ produto: out.produto, publico: out.publico } = guardPublico(out, fonte));

  // Kit: aplicarGuardsTitulo já reduziu a contagem ancorada a "Nun"/"Npc" (N > 1).
  // O número também precisa estar na fonte (a contagem da IA sem respaldo não entra).
  const n = out.quantidade.match(/^(\d+)(?:un|pc)$/i)?.[1];
  const daFonte = extrairContagem(`${fonte.nomePai}\n${fonte.descricaoPai}`)?.match(/^\d+/)?.[0];
  out.quantidade = n && (n === daFonte || fonteTokens.has(n)) ? `Kit ${n}` : '';

  // Cor (ADR-0044, decisão do Diego): só a cor única entra, e só se a peça/público ainda não a
  // dizem. Sem cor única, `variacao` vazia — tamanho nunca vai para o título.
  const corUnica = fonte.cores.length === 1 ? fonte.cores[0] : null;
  const coberta = !!corUnica && tokens(corUnica).every((t) => tokens(`${out.produto} ${out.publico}`).includes(t));
  out.variacao = corUnica && !ehCorIndefinida(corUnica) && !coberta ? corUnica : '';

  return deduplicar(out);
}
