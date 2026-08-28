// Calibração v2 do veredito (ADR-0127/D12): re-deriva as métricas dos 3 fixtures-gabarito e
// confere que os cortes reproduzem média / média / alta. Roda offline sobre os JSONs commitados —
// nenhuma chamada de rede, nenhum custo. É a definição executável das fórmulas: se a Task 8
// implementar em TS e der outro número, é a implementação que divergiu, não o corte.
//
//   node scripts/sonar-gabarito-verificar.mjs
//
// Confere as 4 variantes (nickname cru vs. normalizado × %Full sobre N vs. só sobre medidos);
// sai com código 1 se qualquer variante não bater o gabarito.
//
// Ganha também a variante do caminho B (ADR-0137): censura os rótulos dos 3 fixtures (todo
// `vendedor` vira null), força a concentração por anúncio e confere contra o gabarito medido em
// 27/08 — a definição executável do caminho B, nos moldes das 4 variantes acima.
import { readFileSync } from 'node:fs';

const DIR = 'src/lib/__tests__/fixtures/sonar-gabarito';
const GABARITO = [
  ['eucerin-protetor-solar', 'media'],
  ['protetor-solar-facial', 'media'],
  ['tecido-oxford-10-metros', 'alta'],
];
// ADR-0137 §Calibração: Disputa medida pelo caminho B com os rótulos dos mesmos 3 fixtures censurados.
const GABARITO_CAMINHO_B = [
  ['eucerin-protetor-solar', 'ruim'], // top1 36,8% >= 30%
  ['protetor-solar-facial', 'ruim'], // Full 100% sobre os medidos >= 60%
  ['tecido-oxford-10-metros', 'medio'], // top1 19,6% < 30%, Full 21% < 60% — teto do caminho B
];

// --- Cortes (ADR-0127, seção "Calibração v2") ---------------------------------------------------
const DEMANDA = { liquidezBoa: 0.70, vendasBoas: 5_000, vendasMinimas: 1_000, liquidezRuim: 0.30 };
const DISPUTA_V2 = { pulverizacaoConcentrada: 0.25, pulverizacaoAberta: 0.40, fullMuito: 60, fullPouco: 40 };
// Caminho B da Disputa (ADR-0137): concentração por anúncio, quando o rótulo não cobre a amostra.
const DISPUTA_B = { top1Dominante: 0.30, minElegiveis: 5 };
const TRACAO_V2 = { boa: 350_000, media: 15_000 };
const COBERTURA_MIN = 0.50; // "menos de 50% derruba" — 0,50 exato PASSA (oxford está nele)
// Com a trava de cobertura sobra só a Demanda: `maximo` cai para 2 e `soma >= maximo - 1` faria a
// Demanda 🟡 SOZINHA virar "oportunidade alta" (ADR-0127/D10, ajuste da Task 8).
const PISO_FATORES_ALTA = 2;
const PONTOS = { bom: 2, medio: 1, ruim: 0 };

/** O card do ML imprime "NOME Loja oficial" e "NOME" para o MESMO vendedor (ZZ STORE / ZZ store
 *  Loja oficial). Sem isso, um vendedor conta como dois. */
const normalizarVendedor = (s) => s.toLowerCase().replace(/\s+loja oficial\s*$/, '').trim();

function metricas(fixture, { normalizar, fullLoud }) {
  const v = fixture.vendas;
  // Produção ainda pode não ter `itens` (deploy na Task 13) — por_anuncio é o fallback.
  const amostra = Array.isArray(v.itens) ? v.itens : Object.values(v.por_anuncio);
  const n = v.itens_analisados;
  const comVendedor = amostra.filter((i) => i.vendedor != null);
  const nicks = new Set(comVendedor.map((i) => (normalizar ? normalizarVendedor(i.vendedor) : i.vendedor)));
  // Numerador e denominador na MESMA subamostra nomeada (D11): sem isso o denominador censurado
  // infla a razão. Item sem preço OU sem vendidos não soma (LOUD: ausência não vira zero).
  const faturamento = comVendedor.reduce(
    (a, i) => a + (i.preco != null && i.vendidos != null ? i.preco * i.vendidos : 0), 0,
  );
  const comFull = amostra.filter((i) => i.full != null);
  return {
    liquidez: v.itens_com_vendas / n,
    vendasTotais: v.vendas_totais,
    cobertura: comVendedor.length / n,
    nicks: nicks.size,
    pulverizacao: comVendedor.length > 0 ? nicks.size / comVendedor.length : null,
    fullPct: fullLoud
      ? (comFull.length > 0 ? (comFull.filter((i) => i.full === true).length / comFull.length) * 100 : null)
      : (v.raio_x.full / n) * 100,
    tracao: nicks.size > 0 ? faturamento / nicks.size : null,
  };
}

function veredito(m) {
  const demanda = (m.vendasTotais < DEMANDA.vendasMinimas || m.liquidez < DEMANDA.liquidezRuim) ? 'ruim'
    : (m.liquidez >= DEMANDA.liquidezBoa && m.vendasTotais >= DEMANDA.vendasBoas) ? 'bom' : 'medio';
  const fatores = [demanda];
  let disputa = null, tracao = null;
  // Trava de cobertura (D10): nickname em menos de 50% dos itens → Disputa e Tração indisponíveis.
  if (m.cobertura >= COBERTURA_MIN) {
    // Sem Full medido (fullPct null) a Disputa fica limitada a 'medio': ausência de dado não pode
    // promover o fator (senão o facial, 🔴 só pela cláusula de Full, viraria 🟢 e o nicho, alta).
    disputa = (m.pulverizacao <= DISPUTA_V2.pulverizacaoConcentrada
      || (m.fullPct != null && m.fullPct >= DISPUTA_V2.fullMuito)) ? 'ruim'
      : (m.pulverizacao >= DISPUTA_V2.pulverizacaoAberta
        && m.fullPct != null && m.fullPct <= DISPUTA_V2.fullPouco) ? 'bom' : 'medio';
    tracao = m.tracao >= TRACAO_V2.boa ? 'bom' : m.tracao >= TRACAO_V2.media ? 'medio' : 'ruim';
    fatores.push(disputa, tracao);
  }
  const soma = fatores.reduce((a, nivel) => a + PONTOS[nivel], 0);
  const maximo = fatores.length * 2;
  // "Alta" exige dado completo: sem rótulo de loja na maioria dos anúncios OU sem nenhum tipo de
  // envio informado o veredito é PARCIAL e não passa de média — ausência não melhora veredito.
  const parcial = disputa === null || m.fullPct == null;
  const nivel = (demanda === 'ruim' || soma <= maximo / 3) ? 'baixa'
    : (soma >= maximo - 1 && fatores.length >= PISO_FATORES_ALTA && !parcial) ? 'alta' : 'media';
  return { demanda, disputa, tracao, soma, maximo, nivel, parcial };
}

let falhou = false;
for (const [normalizar, fullLoud] of [[false, false], [true, false], [false, true], [true, true]]) {
  console.log(`\n--- nickname=${normalizar ? 'normalizado' : 'cru'} · %Full=${fullLoud ? 'só medidos' : 'sobre N'} ---`);
  for (const [slug, esperado] of GABARITO) {
    const fixture = JSON.parse(readFileSync(`${DIR}/${slug}.json`, 'utf8'));
    const m = metricas(fixture, { normalizar, fullLoud });
    const r = veredito(m);
    const ok = r.nivel === esperado;
    if (!ok) falhou = true;
    console.log(
      `${ok ? 'ok  ' : 'FALHA'} ${slug.padEnd(24)} cob=${m.cobertura.toFixed(2)} pulv=${m.pulverizacao.toFixed(2)} ` +
      `full=${String(Math.round(m.fullPct)).padStart(3)}% tracao=${String(Math.round(m.tracao)).padStart(8)} ` +
      `| ${r.demanda}/${r.disputa}/${r.tracao} = ${r.soma}/${r.maximo} -> ${r.nivel} (esperado ${esperado})`,
    );
  }
}
// --- Caminho B (ADR-0137): rótulos censurados, concentração por anúncio -------------------------
function concentracaoCaminhoB(amostra) {
  const elegiveis = amostra.filter((i) => i.vendidos != null && i.preco != null);
  if (elegiveis.length < DISPUTA_B.minElegiveis) return null;
  const faturamentos = elegiveis.map((i) => i.vendidos * i.preco);
  const total = faturamentos.reduce((a, f) => a + f, 0);
  if (total <= 0) return null;
  const top1 = Math.max(...faturamentos) / total;
  const corte = Math.max(DISPUTA_B.top1Dominante, 2 / elegiveis.length);
  return { elegiveis: elegiveis.length, top1, corte, dominante: top1 >= corte };
}

function disputaCaminhoB(amostra) {
  const comFull = amostra.filter((i) => i.full != null);
  const fullPct = comFull.length > 0 ? (comFull.filter((i) => i.full === true).length / comFull.length) * 100 : null;
  const conc = concentracaoCaminhoB(amostra);
  if (fullPct == null && conc == null) return null; // nem envio nem concentração — nada pra medir
  return (fullPct != null && fullPct >= DISPUTA_V2.fullMuito) || conc?.dominante === true ? 'ruim' : 'medio';
}

console.log('\n--- caminho B (ADR-0137): rótulos censurados, concentração por anúncio ---');
for (const [slug, esperado] of GABARITO_CAMINHO_B) {
  const fixture = JSON.parse(readFileSync(`${DIR}/${slug}.json`, 'utf8'));
  const v = fixture.vendas;
  const amostra = Array.isArray(v.itens) ? v.itens : Object.values(v.por_anuncio);
  const r = disputaCaminhoB(amostra); // "censura" é implícita: a função nunca lê `vendedor`
  const ok = r === esperado;
  if (!ok) falhou = true;
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${slug.padEnd(24)} disputaB=${String(r).padEnd(6)} (esperado ${esperado})`);
}

if (falhou) { console.error('\nGabarito NÃO reproduzido — não mexer nos cortes sem re-medir (ADR-0127/D12, ADR-0137).'); process.exit(1); }
console.log('\nGabarito reproduzido nas 4 variantes do caminho A (média/média/alta) e no caminho B (ruim/ruim/medio).');
