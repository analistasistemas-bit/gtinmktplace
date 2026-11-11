"""Revisão do plano da Galeria da cor por Codex e Grok (read-only).

Uso (a partir da raiz do worktree):
    python3 -I scripts/revisao-galeria/revisar.py codex scripts/revisao-galeria/brief.md /tmp/codex.txt
    python3 -I scripts/revisao-galeria/revisar.py grok  scripts/revisao-galeria/brief.md /tmp/grok.txt
Rodar os dois em paralelo (em background). Edite em brief.md a versão do plano e o número da rodada.
"""
import os
import subprocess
import sys

quem, brief, saida = sys.argv[1], sys.argv[2], sys.argv[3]
prompt = open(brief, encoding='utf-8').read()
raiz = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
cmd = {
    # codex: -i é variádico; se anexar imagem, o prompt vem ANTES dos -i
    'codex': ['codex', 'exec', '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort=high', '-s', 'read-only', prompt],
    # diff por task e pré-merge (definitivo desde 11/11, CLAUDE.md)
    'grok': ['cursor-agent', '-p', '--mode', 'ask', '--model', 'grok-4.7-high', '--trust', '--output-format', 'text', prompt],
    # reserva do Codex quando a cota acabar (memória feedback_revisor_fallback_kimi)
    'gemini': ['cursor-agent', '-p', '--mode', 'ask', '--model', 'gemini-4-argon-high', prompt],
    # revisor das tasks desde 10/11 (pedido do Diego): Fable 5.2 da conta Claude, só leitura; prompt pelo stdin
    'fable': ['claude', '-p', '--model', 'claude-fable-5-2',
              '--allowedTools', 'Read,Grep,Glob', '--disallowedTools', 'Edit,Write,Bash,NotebookEdit'],
}[quem]
entrada = prompt if quem == 'fable' else None
with open(saida, 'w') as out:
    subprocess.run(cmd, input=entrada, text=True, stdin=None if entrada else subprocess.DEVNULL,
                   stdout=out, stderr=subprocess.STDOUT, timeout=1800, cwd=raiz)
