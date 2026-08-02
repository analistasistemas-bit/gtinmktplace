/**
 * Recalcula as métricas do experimento a partir do resultado.md já gerado, sem chamar a API.
 *
 * Existe porque as métricas evoluem depois que as saídas foram geradas — foi exatamente o que
 * aconteceu quando comparacoesNaoAncoradas passou a comparar contra a fonte. Re-gerar as 60
 * descrições só para remedir seria desperdício: as saídas não mudaram, a régua mudou.
 *
 * Uso:
 *   pnpm tsx scripts/experimento-copy/recalcular.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectarFormulasProibidas, removerPerguntasIncompletas } from '../../supabase/functions/_shared/ai/copywriter-prompt.ts';
import { medidasNaoAncoradas, comparacoesNaoAncoradas, taxaBulletsRepetidos } from './metricas.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));

const md = readFileSync(join(AQUI, 'resultado.md'), 'utf-8');
const produtos = md.split(/\n---\n\n## /).slice(1);

const bloco = (p: string, titulo: string): string => {
  const m = p.match(new RegExp(`### ${titulo}[\\s\\S]*?\`\`\`\\n([\\s\\S]*?)\\n\`\`\``));
  return m ? m[1] : '';
};

const fontes: string[] = [];
const saidas = { A: [] as string[], B: [] as string[], C: [] as string[] };

for (const p of produtos) {
  fontes.push(`${p.split('\n')[0]}\n${bloco(p, 'Fonte')}`);
  saidas.A.push(bloco(p, 'A — baseline de produção'));
  // o guard de R6 entrou depois da geração; aplicá-lo aqui mede o resultado como produção entrega
  saidas.B.push(removerPerguntasIncompletas(bloco(p, 'B — prompt novo, gpt-4o-mini')));
  saidas.C.push(removerPerguntasIncompletas(bloco(p, 'C — prompt novo, gpt-4o')));
}

function metricas(descricoes: string[]) {
  return {
    formulas_proibidas: descricoes.reduce((n, d) => n + detectarFormulasProibidas(d).length, 0),
    medidas_nao_ancoradas: descricoes.reduce((n, d, i) => n + medidasNaoAncoradas(d, fontes[i]).length, 0),
    comparacoes_nao_ancoradas: descricoes.reduce((n, d, i) => n + comparacoesNaoAncoradas(d, fontes[i]).length, 0),
    taxa_bullets_repetidos: Number(taxaBulletsRepetidos(descricoes).toFixed(3)),
    chars_media: Math.round(descricoes.reduce((n, d) => n + d.length, 0) / descricoes.length),
    tem_secao_perguntas: descricoes.filter((d) => d.includes('PERGUNTAS SOBRE ESTE PRODUTO')).length,
  };
}

const resumo = { A: metricas(saidas.A), B: metricas(saidas.B), C: metricas(saidas.C) };
console.log(`produtos: ${produtos.length}`);
console.table(resumo);
writeFileSync(join(AQUI, 'resultado.json'), JSON.stringify(resumo, null, 2), 'utf-8');
