# Auditoria completa do Obsidian Vault

**Data:** 2026-07-24  
**Status:** aprovado para planejamento

## Objetivo

Sincronizar o `obsidian-vault/` com o estado atual do PubliAI sem reorganizar a estrutura existente
nem duplicar a documentação técnica oficial.

## Público

Diego e agentes de desenvolvimento que usam o vault como base viva para contexto operacional,
arquitetural e de produto.

## Fontes de verdade

1. `docs/project-status.md` para o estado atual.
2. `docs/TASKS.md` para entregas e pendências operacionais.
3. `docs/decisions/` para decisões arquiteturais.
4. `docs/ROADMAP.md` e documentos estratégicos para prioridades.
5. `graphify-out/graph.json` para conferir componentes e relações existentes.

Em caso de divergência, `docs/` prevalece sobre o vault. Graphify confirma estrutura, mas não
substitui decisões ou status documentados.

## Escopo

- Auditar todas as notas Markdown em `obsidian-vault/`.
- Corrigir fatos, datas, status, prioridades e terminologia comprovadamente defasados.
- Atualizar índices e notas de roadmap afetados.
- Validar frontmatter e wikilinks.
- Remover ou marcar referências obsoletas somente quando a fonte oficial comprovar a mudança.
- Preservar nomes, pastas, estilo e granularidade atuais.

## Fora de escopo

- Reorganizar pastas ou renomear notas.
- Reescrever notas corretas apenas por preferência editorial.
- Criar novas decisões arquiteturais.
- Alterar `docs/`, código, banco ou infraestrutura.
- Incluir pesquisa externa.

## Método

1. Inventariar notas, frontmatter e wikilinks.
2. Comparar índices, roadmap, arquitetura, módulos, fluxos, decisões e bugs com suas fontes.
3. Classificar achados em factual, link, metadado ou conteúdo ausente.
4. Aplicar o menor conjunto de correções que elimine divergências comprovadas.
5. Executar validação automática de links e frontmatter.
6. Revisar o diff para impedir mudanças editoriais ou estruturais fora do escopo.

## Critérios de conclusão

- Nenhum wikilink interno quebrado, exceto referências deliberadamente externas documentadas.
- Datas e status do vault coerentes com as fontes oficiais.
- Índice de ADRs cobre as decisões existentes aplicáveis.
- Sprint e roadmap refletem o próximo foco oficial.
- Nenhuma nota correta foi reescrita sem necessidade.
- Relatório final lista arquivos alterados, verificações e limitações.
