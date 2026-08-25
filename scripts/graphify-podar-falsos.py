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

A. `src/**` e `supabase/functions/<função>/**` nunca se importam. São runtimes separados:
   bundle do Vite (browser) e Edge Functions (Deno). Uma aresta de chamada entre eles é
   impossível. NÃO vale para `scripts/**`, que importa `_shared/ai/**` de verdade.
   Exceção: `supabase/functions/_shared/**` é código ISOMÓRFICO — roda nos dois runtimes e é
   importado de verdade pelos dois lados. Não é só `import type`: `src/lib/pulse-margem.ts`
   importa e EXECUTA `resumirMercadoQualificado()` de `_shared/concorrencia/qualificacao.ts`
   (ADR-0130). Por isso `_shared/` tem área própria (`shared`) e nenhuma aresta que o envolva
   é podada por A — só o Deno puro, específico de uma Edge Function, é.

B. Nada de produção importa de arquivo de teste. Testes importam produção, nunca o contrário.
   Uma aresta de chamada cujo ALVO está em `__tests__/`/`*.test.*` e cuja ORIGEM não está é
   impossível.

C. Referência fantasma: uma aresta `references` entre arquivos diferentes só é crível se o
   identificador do alvo aparecer, com a CAIXA EXATA, no arquivo de origem. Não aparecendo, foi
   fabricada. Esta regra se autoverifica: lê o arquivo de origem a cada execução.
   Colisões reais que ela pegou: `JSON.parse` (global do JS) casado com o *tipo* `Json` de
   `database.types.ts` (73 arestas, e `Json` era o god node nº 2); `new Map()` casado com a
   constante `MAP` de `_shared/ml/status.ts` (25); `ResumoViabilidade` casado com
   `resumoViabilidade`.

Regras A e B só valem para relações de CHAMADA (`calls`, `indirect_call`, `dyn_call`, `method`).
`imports` nunca entra em nenhuma regra: é a relação mais confiável do extrator.

## Trava

Em A e B, o argumento vem da estrutura do repositório, então uma aresta `EXTRACTED` caindo na
regra é sinal de que a premissa mudou: o script **aborta** e pede análise humana. Hoje as 61 de
A+B são todas `INFERRED`.

Em C a trava não se aplica, porque a prova é o próprio texto do arquivo de origem — e ser
`EXTRACTED` é justamente o achado: o extrator afirmou evidência explícita para um identificador
que não está no arquivo. As 100 encontradas por C são todas `EXTRACTED`.

Uso:
    python3 scripts/graphify-podar-falsos.py [--aplicar]

Sem `--aplicar` só relata. Idempotente: rodar duas vezes não muda nada na segunda.
"""
# O python3 do macOS é 3.9; sem isto, `str | None` numa anotação estoura em runtime.
from __future__ import annotations

import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

GRAFO = Path('graphify-out/graph.json')
CHAMADA = {'calls', 'indirect_call', 'dyn_call', 'method'}
CODIGO = ('.ts', '.tsx', '.mjs', '.js')
_texto: dict[str, str] = {}


def conteudo(sf: str) -> str | None:
    """Fonte do arquivo, em cache. None quando ilegível (apagado, binário)."""
    if sf not in _texto:
        try:
            _texto[sf] = Path(sf).read_text(encoding='utf-8', errors='replace')
        except OSError:
            _texto[sf] = ''
    return _texto[sf] or None


def identificador(label: str) -> str | None:
    """'buscarX()' -> 'buscarX'; '.buscar()' -> 'buscar'. None se não for identificador."""
    if not label:
        return None
    s = label.strip().lstrip('.').removesuffix('()')
    return s if re.fullmatch(r'[A-Za-z_$][A-Za-z0-9_$]*', s) else None


def eh_teste(sf: str) -> bool:
    return '__tests__/' in sf or '.test.' in sf or sf.startswith('tests/')


def area(sf: str) -> str:
    # Antes de 'deno': `_shared/` é isomórfico, importado pelos dois runtimes. Área própria
    # para nunca formar o par {'app','deno'} da regra A.
    if sf.startswith('supabase/functions/_shared/'):
        return 'shared'
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


def _sem_shared(linhas: list[str]) -> list[str]:
    """`_shared/` é isomórfico: import dele (de tipo OU de valor) nao viola a regra A (ADR-0130).

    Este grep é por LINHA, entao nao enxerga import multi-linha — o de `pulse-margem.ts` passa
    batido aqui e foi a trava `EXTRACTED` de classificar() que pegou o caso. Filtro barato de
    proposito; a trava é a rede de seguranca real.
    """
    return [l for l in linhas if '_shared/' not in l]


def reverificar_premissas() -> None:
    """As regras valem porque o repositório é assim HOJE. Confere de novo antes de apagar."""
    a1 = _sem_shared(
        _grep(r"^\s*import .*from ['\"][^'\"]*supabase/functions", 'src'))
    a2 = _sem_shared(
        _grep(r"^\s*import .*from ['\"][^'\"]*\.\./src/", 'supabase/functions'))
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
        rel = e.get('relation')
        if rel not in CHAMADA and rel != 'references':
            continue
        ns, nt = por.get(e.get('source')), por.get(e.get('target'))
        if not ns or not nt:
            continue
        sf_s = ns.get('source_file') or ''
        sf_t = nt.get('source_file') or ''
        motivo = None
        if rel in CHAMADA:
            if {area(sf_s), area(sf_t)} == {'app', 'deno'}:
                motivo = 'A: app <-> deno'
            elif eh_teste(sf_t) and not eh_teste(sf_s):
                motivo = 'B: producao -> teste'
        elif sf_s != sf_t and sf_s.endswith(CODIGO):
            alvo = identificador(nt.get('label') or '')
            fonte = conteudo(sf_s)
            # Sem identificador limpo ou sem fonte legivel: nao da pra provar nada, mantem.
            if alvo and fonte is not None and not re.search(rf'\b{re.escape(alvo)}\b', fonte):
                motivo = 'C: referencia fantasma'
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

    # Trava so para A e B: la o argumento vem da ESTRUTURA do repositorio, entao uma aresta
    # EXTRACTED contradizendo a regra merece olho humano. Em C nao: a prova e o proprio texto
    # do arquivo de origem, e ser EXTRACTED e justamente o achado — o extrator afirmou
    # evidencia explicita para um identificador que nao esta la.
    extraidas = [i for i in falsas
                 if motivos[i][1].get('confidence') == 'EXTRACTED'
                 and not motivos[i][0].startswith('C')]
    if extraidas:
        print('ABORTADO: aresta EXTRACTED caiu nas regras A/B — evidencia explicita nao se apaga '
              'sem analise humana:')
        for i in extraidas[:10]:
            _, e, ns, nt, sf_s, sf_t = motivos[i]
            print(f'  {ns.get("label")} --{e.get("relation")}--> {nt.get("label")}')
            print(f'    {sf_s} -> {sf_t}')
        return 1

    print(f'arestas falsas: {len(falsas)} de {len(links)} ({len(falsas)/len(links):.2%})')
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
