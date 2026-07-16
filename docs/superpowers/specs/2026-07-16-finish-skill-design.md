# Skill `finish`

## Objetivo

Substituir o prompt obsoleto `~/.codex/prompts/finish.md` por uma skill pessoal descoberta pelo Codex.

## Design

- Criar `~/.codex/skills/finish/SKILL.md` com o checklist existente.
- Criar `agents/openai.yaml` com nome, descrição curta e prompt padrão.
- Disparar explicitamente com `$finish` e implicitamente em pedidos para finalizar ou encerrar uma tarefa.
- Manter a execução contextual: itens como Graphify, documentação, Obsidian, ADR e changelog são atualizados somente quando aplicáveis.
- Exigir no resultado final: arquivos alterados, verificações, estado de cada artefato e pendências.
- Remover o prompt antigo após validar a nova skill.

## Validação

- Confirmar primeiro que, sem a skill, um agente não recebe o checklist específico.
- Validar estrutura e metadados com `quick_validate.py`.
- Executar um teste de uso com a skill e confirmar que todos os campos obrigatórios aparecem.

## Limites

Nenhum script, dependência ou recurso adicional será criado.
