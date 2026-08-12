#!/usr/bin/env python3
"""Remove do grafo do Graphify as arestas de chamada que são impossíveis neste repositório.

## O problema

O extrator AST do graphify liga chamadas por NOME, sem escopo. Um `render()` no teste do
frontend (o do testing-library) casa com o `render()` de `_shared/ai/titulo-montar.ts`, que
roda em Deno. O resultado aparece em "Surprising Connections" do GRAPH_REPORT.md com cara de
achado arquitetural, quando é só homônimo. Nomes curtos (`f()`, `p()`, `v()`, `row()`, `get()`)
são os piores ofensores.

## As duas regras

Ambas foram verificadas no repositório antes de virarem código, e o script REVERIFICA a
premissa a cada execução — se algum dia passar a existir um import real, ele aborta em vez de
apagar aresta legítima.

A. `src/**` e `supabase/functions/**` nunca se importam. São runtimes separados: bundle do
   Vite (browser) e Edge Functions (Deno). Uma aresta de chamada entre eles é impossível.
   NÃO vale para `scripts/**`, que importa `_shared/ai/**` de verdade.

B. Nada de produção importa de arquivo de teste. Testes importam produção, nunca o contrário.
   Uma aresta de chamada cujo ALVO está em `__tests__/`/`*.test.*` e cuja ORIGEM não está é
   impossível.

Só relações de CHAMADA entram (`calls`, `indirect_call`, `dyn_call`, `method`). `references` e
`imports` ficam de fora de propósito: há vários comentários "espelha
supabase/functions/..." que são referência textual legítima entre os dois runtimes.

## Trava

Aresta `EXTRACTED` (evidência explícita no código) nunca é removida — se aparecer alguma nas
regras, o script aborta e pede análise humana. Hoje as 61 encontradas são todas `INFERRED`.

Uso:
    python3 scripts/graphify-podar-falsos.py [--aplicar]

Sem `--aplicar` só relata. Idempotente: rodar duas vezes não muda nada na segunda.
"""
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

GRAFO = Path('graphify-out/graph.json')
CHAMADA = {'calls', 'indirect_call', 'dyn_call', 'method'}


def eh_teste(sf: str) -> bool:
    return '__tests__/' in sf or '.test.' in sf or sf.startswith('tests/')


def area(sf: str) -> str:
    if sf.startswith('supabase/functions/'):
        return 'deno'
    if sf.startswith('src/') or sf.startswith('tests/'):
        return 'app'
    return 'outro'


def _grep(padrao: str, *caminhos: str) -> list[str]:
    r = subprocess.run(['grep', '-rnE', padrao, *caminhos,
                        '--include=*.ts', '--include=*.tsx'],
                       capture_output=True, text=True)
    return [l for l in r.stdout.splitlines() if l.strip()]


def reverificar_premissas() -> None:
    """As regras valem porque o repositório é assim HOJE. Confere de novo antes de apagar."""
    a1 = _grep(r"^\s*import .*from ['\"][^'\"]*supabase/functions", 'src')
    a2 = _grep(r"^\s*import .*from ['\"][^'\"]*\.\./src/", 'supabase/functions')
    b = [l for l in _grep(r"^\s*import .*from ['\"][^'\"]*(__tests__|\.test)",
                          'src', 'supabase/functions', 'scripts')
         if '__tests__/' not in l.split(':')[0] and '.test.' not in l.split(':')[0]]
    if a1 or a2:
        raise SystemExit(
            'ABORTADO: passou a existir import real entre src/ e supabase/functions/.\n'
            'A regra A não vale mais — revise este script antes de podar.\n'
            + '\n'.join((a1 + a2)[:5]))
    if b:
        raise SystemExit(
            'ABORTADO: código de produção passou a importar de arquivo de teste.\n'
            'A regra B não vale mais — revise este script antes de podar.\n'
            + '\n'.join(b[:5]))


def classificar(links, por):
    """Devolve (falsas, motivo_por_indice)."""
    falsas, motivos = [], {}
    for i, e in enumerate(links):
        if e.get('relation') not in CHAMADA:
            continue
        ns, nt = por.get(e.get('source')), por.get(e.get('target'))
        if not ns or not nt:
            continue
        sf_s = ns.get('source_file') or ''
        sf_t = nt.get('source_file') or ''
        motivo = None
        if {area(sf_s), area(sf_t)} == {'app', 'deno'}:
            motivo = 'A: app <-> deno'
        elif eh_teste(sf_t) and not eh_teste(sf_s):
            motivo = 'B: producao -> teste'
        if motivo:
            falsas.append(i)
            motivos[i] = (motivo, e, ns, nt, sf_s, sf_t)
    return falsas, motivos


def main() -> int:
    aplicar = '--aplicar' in sys.argv
    if not GRAFO.exists():
        raise SystemExit(f'{GRAFO} nao existe — rode o graphify primeiro.')
    reverificar_premissas()

    g = json.loads(GRAFO.read_text(encoding='utf-8'))
    links = g.get('links', [])
    por = {n['id']: n for n in g['nodes']}
    falsas, motivos = classificar(links, por)

    if not falsas:
        print('Nenhuma aresta falsa encontrada. Nada a fazer.')
        return 0

    extraidas = [i for i in falsas if motivos[i][1].get('confidence') == 'EXTRACTED']
    if extraidas:
        print('ABORTADO: aresta EXTRACTED caiu nas regras — evidencia explicita nao se apaga '
              'sem analise humana:')
        for i in extraidas[:10]:
            _, e, ns, nt, sf_s, sf_t = motivos[i]
            print(f'  {ns.get("label")} --{e.get("relation")}--> {nt.get("label")}')
            print(f'    {sf_s} -> {sf_t}')
        return 1

    print(f'arestas de chamada falsas: {len(falsas)} de {len(links)} '
          f'({len(falsas)/len(links):.2%})')
    print('por regra:', dict(Counter(motivos[i][0] for i in falsas)))
    print('alvos mais frequentes:',
          Counter(motivos[i][3].get('label') for i in falsas).most_common(8))

    if not aplicar:
        print('\n(somente relatorio — use --aplicar para gravar)')
        return 0

    alvo = set(falsas)
    g['links'] = [e for i, e in enumerate(links) if i not in alvo]
    GRAFO.write_text(json.dumps(g, ensure_ascii=False), encoding='utf-8')
    print(f'\ngravado: {len(links)} -> {len(g["links"])} arestas')
    print('Reclusterize e regere o relatorio para o GRAPH_REPORT.md refletir a poda.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
