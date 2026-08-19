// Calibração v2 do veredito (ADR-0127/D12): re-deriva as métricas dos 3 fixtures-gabarito e
// confere que os cortes reproduzem média / média / alta. Roda offline sobre os JSONs commitados —
// nenhuma chamada de rede, nenhum custo. É a definição executável das fórmulas: se a Task 8
// implementar em TS e der outro número, é a implementação que divergiu, não o corte.
//
//   node scripts/sonar-gabarito-verificar.mjs
//
// Confere as 4 variantes (nickname cru vs. normalizado × %Full sobre N vs. só sobre medidos);
// sai com código 1 se qualquer variante não bater o gabarito.
import { readFileSync } from 'node:fs';

const DIR = 'src/lib/__tests__/fixtures/sonar-gabarito';
const GABARITO = [
  ['eucerin-protetor-solar', 'media'],
  ['protetor-solar-facial', 'media'],
  ['tecido-oxford-10-metros', 'alta'],
];

// --- Cortes (ADR-0127, seção "Calibração v2") ---------------------------------------------------
const DEMANDA = { liquidezBoa: 0.70, vendasBoas: 5_000, vendasMinimas: 1_000, liquidezRuim: 0.30 };
const DISPUTA_V2 = { pulverizacaoConcentrada: 0.25, pulverizacaoAberta: 0.40, fullMuito: 60, fullPouco: 40 };
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
    disputa = (m.pulverizacao <= DISPUTA_V2.pulverizacaoConcentrada || m.fullPct >= DISPUTA_V2.fullMuito) ? 'ruim'
      : (m.pulverizacao >= DISPUTA_V2.pulverizacaoAberta && m.fullPct <= DISPUTA_V2.fullPouco) ? 'bom' : 'medio';
    tracao = m.tracao >= TRACAO_V2.boa ? 'bom' : m.tracao >= TRACAO_V2.media ? 'medio' : 'ruim';
    fatores.push(disputa, tracao);
  }
  const soma = fatores.reduce((a, nivel) => a + PONTOS[nivel], 0);
  const maximo = fatores.length * 2;
  const nivel = (demanda === 'ruim' || soma <= maximo / 3) ? 'baixa'
    : (soma >= maximo - 1 && fatores.length >= PISO_FATORES_ALTA) ? 'alta' : 'media';
  return { demanda, disputa, tracao, soma, maximo, nivel };
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
if (falhou) { console.error('\nGabarito NÃO reproduzido — não mexer nos cortes sem re-medir (ADR-0127/D12).'); process.exit(1); }
console.log('\nGabarito reproduzido nas 4 variantes: média / média / alta.');
