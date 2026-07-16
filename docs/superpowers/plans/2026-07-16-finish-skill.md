# Finish Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar o prompt personalizado `finish` para uma skill pessoal validada.

**Architecture:** Uma skill autocontida em `~/.codex/skills/finish`, formada por `SKILL.md` e metadados de interface. Nenhum script ou dependência adicional.

**Tech Stack:** Markdown, YAML e validadores do `skill-creator`.

## Global Constraints

- Preservar todos os itens do checklist atual.
- Permitir invocação explícita por `$finish` e descoberta implícita por pedidos de encerramento.
- Remover o prompt obsoleto somente depois da validação da skill.

---

### Task 1: Migrar e validar `finish`

**Files:**
- Create: `/Users/diego/.codex/skills/finish/SKILL.md`
- Create: `/Users/diego/.codex/skills/finish/agents/openai.yaml`
- Delete: `/Users/diego/.codex/prompts/finish.md`

**Interfaces:**
- Consumes: pedidos como `$finish`, “finalize a tarefa” e “encerre a tarefa”.
- Produces: revisão final com arquivos, verificações, Graphify, docs, Obsidian Vault, ADR e pendências.

- [ ] **Step 1: Executar teste-base sem a skill**

Solicitar a um agente sem acesso à nova skill que finalize uma tarefa e registrar a ausência do checklist específico.

- [ ] **Step 2: Inicializar a skill**

```bash
python /Users/diego/.codex/skills/.system/skill-creator/scripts/init_skill.py finish --path /Users/diego/.codex/skills --interface display_name="Finish" --interface short_description="Finaliza tarefas com revisão e documentação" --interface default_prompt="Use $finish para concluir e revisar a tarefa atual."
```

- [ ] **Step 3: Substituir o template pelo checklist aprovado**

Criar `SKILL.md` com frontmatter `name: finish`, descrição iniciada por `Use when...`, fluxo de revisão e resumo obrigatório definido na especificação.

- [ ] **Step 4: Validar a estrutura**

```bash
python /Users/diego/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/diego/.codex/skills/finish
```

Expected: `Skill is valid!`

- [ ] **Step 5: Executar teste com a skill**

Solicitar a um agente que use `$finish` e confirmar que o resultado inclui todos os campos obrigatórios.

- [ ] **Step 6: Remover o prompt obsoleto**

```bash
rm /Users/diego/.codex/prompts/finish.md
```

- [ ] **Step 7: Verificar os arquivos finais**

```bash
find /Users/diego/.codex/skills/finish -maxdepth 2 -type f -print
test ! -e /Users/diego/.codex/prompts/finish.md
```

Expected: somente `SKILL.md` e `agents/openai.yaml`; prompt antigo ausente.
