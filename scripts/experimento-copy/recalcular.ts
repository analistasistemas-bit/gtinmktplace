/**
 * Recalcula as métricas do experimento a partir do resultado.md já gerado, sem chamar a API.
 *
 * Existe porque as métricas evoluem depois que as saídas foram geradas — foi exatamente o que
 * aconteceu quando comparacoesNaoAncoradas passou a comparar contra a fonte. Re-gerar as
 * descrições só para remedir seria desperdício: as saídas não mudaram, a régua mudou.
 *
 * Os cenários são descobertos a partir dos próprios cabeçalhos `### ` do arquivo, então
 * acrescentar um modelo novo em index.ts não exige tocar aqui. As descrições já vêm
 * pós-processadas pelo harness (posProcessarDescricao), não se aplica nada de novo sobre elas.
 *
 * Uso:
 *   pnpm tsx scripts/experimento-copy/recalcular.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectarFormulasProibidas } from '../../supabase/functions/_shared/ai/copywriter-prompt.ts';
import { medidasNaoAncoradas, comparacoesNaoAncoradas, taxaBulletsRepetidos } from './metricas.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));

const md = readFileSync(join(AQUI, 'resultado.md'), 'utf-8');
const produtos = md.split(/\n---\n\n## /).slice(1);
if (produtos.length === 0) throw new Error('resultado.md sem produtos — rode o experimento primeiro');

const bloco = (p: string, titulo: string): string => {
  const m = p.match(new RegExp(`### ${titulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\``));
  return m ? m[1] : '';
};

// Descobre os cenários pelos cabeçalhos do primeiro produto, preservando a ordem do arquivo.
const rotulos = [...produtos[0].matchAll(/^### (.+)$/gm)]
  .map((m) => m[1])
  .filter((r) => r !== 'Fonte');

const fontes: string[] = [];
const saidas: Record<string, string[]> = Object.fromEntries(rotulos.map((r) => [r, []]));

for (const p of produtos) {
  // O cabeçalho é "N. codigo — nome_pai"; a fonte do experimento é nome_pai + descricao_pai.
  // Usar o cabeçalho inteiro incluiria o código numérico do produto e tornaria a checagem de
  // medidas mais permissiva do que a que index.ts aplica.
  const nomePai = p.split('\n')[0].split(' — ').slice(1).join(' — ');
  fontes.push(`${nomePai}\n${bloco(p, 'Fonte')}`);
  for (const r of rotulos) saidas[r].push(bloco(p, r));
}

function metricas(descricoes: string[]) {
  const validas = descricoes.filter(Boolean);
  return {
    n: validas.length,
    formulas_proibidas: descricoes.reduce((n, d) => n + (d ? detectarFormulasProibidas(d).length : 0), 0),
    medidas_nao_ancoradas: descricoes.reduce((n, d, i) => n + (d ? medidasNaoAncoradas(d, fontes[i]).length : 0), 0),
    comparacoes_nao_ancoradas: descricoes.reduce((n, d, i) => n + (d ? comparacoesNaoAncoradas(d, fontes[i]).length : 0), 0),
    taxa_bullets_repetidos: Number(taxaBulletsRepetidos(validas).toFixed(3)),
    chars_media: validas.length ? Math.round(validas.reduce((n, d) => n + d.length, 0) / validas.length) : 0,
    secao_perguntas: validas.filter((d) => d.includes('PERGUNTAS SOBRE ESTE PRODUTO')).length,
  };
}

const resumo = Object.fromEntries(rotulos.map((r) => [r.split(' —')[0], metricas(saidas[r])]));
console.log(`produtos: ${produtos.length} · cenários: ${rotulos.map((r) => r.split(' —')[0]).join(', ')}`);
console.table(resumo);
writeFileSync(join(AQUI, 'resultado.json'), JSON.stringify(resumo, null, 2), 'utf-8');
