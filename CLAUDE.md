# CLAUDE.md — Bootstrap do projeto PubliAI

> Este arquivo é o bootstrap curto do projeto. Leia primeiro. Estado atual e histórico detalhado vivem fora daqui.

**Última atualização:** 2026-07-01

---

# O que é este projeto

PubliAI é um sistema interno que transforma planilhas de produtos em anúncios publicados em marketplaces, com foco inicial no Mercado Livre e evolução para operação multicanal.

**Usuário-operador principal:** Diego

**Domínios principais:** lotes, famílias, variações, anúncios externos

**Primeiro marketplace em produção:** Mercado Livre

**Próximo épico planejado:** E5 — Conector Shopee

---

# Fontes de conhecimento

Este projeto utiliza três fontes oficiais de contexto:

- **Graphify** → entendimento da arquitetura, dependências e impacto de mudanças.
- **docs/** → documentação técnica oficial (Diátaxis).
- **obsidian-vault/** → documentação viva do projeto (arquitetura, decisões, fluxos, roadmap e contexto).

---

# Ordem de leitura

Antes de tocar no código, siga esta ordem:

1. Consulte o **Graphify** para entender arquitetura e impacto.
2. Leia:
   - docs/README.md
   - docs/project-status.md
   - docs/ROADMAP.md
   - docs/TASKS.md
3. Consulte o ADR relacionado em `docs/decisions/`.

Se precisar de contexto histórico:

- docs/project-history.md
- docs/auditoria-e1-e4-browser-use.md

---

# Uso obrigatório do Graphify

Antes de investigar arquitetura, fluxos, dependências ou impacto de mudanças:

- Consulte o Graphify.
- Identifique os módulos envolvidos.
- Leia apenas os arquivos realmente necessários.
- Antes de editar código, explique quais arquivos serão impactados.
- Após mudanças estruturais relevantes, atualize o Graphify.

---

# MCPs prioritários

Sempre prefira MCP/CLI antes de sugerir operação manual.

Prioridade:

- supabase-mcp-server
- upstash
- render
- shadcn
- context7

---

# Regras operacionais inegociáveis

- Leia o ADR relacionado antes de propor mudança arquitetural.
- Se a decisão for nova e não-trivial, escreva um ADR antes da implementação.
- Edge Functions devem ser idempotentes.
- Tokens e segredos nunca vão para código ou repositório.
- RLS por `user_id` ou `org_id` é obrigatória em tabelas de domínio.
- Sempre existe revisão humana antes da publicação em marketplaces.
- Prefira o caminho pragmático e verificável ao mais elegante.
- Atualize `TASKS.md` e a documentação afetada ao concluir trabalho relevante.
- Toda mudança relevante deve passar pela verificação da documentação antes de ser considerada concluída.

---

# Manutenção da documentação

A documentação possui dois papéis:

## docs/

Documentação técnica oficial seguindo o padrão Diátaxis.

## obsidian-vault/

Base de conhecimento viva do projeto.

Sempre que houver:

- mudança arquitetural
- novo módulo
- novo fluxo
- integração
- decisão técnica importante

Atualize também o Obsidian Vault.

---

## Regra de conclusão

Antes de concluir qualquer alteração relevante:

1. Consultar o Graphify.
2. Implementar a mudança.
3. Verificar a documentação em `docs/`.
4. Atualizar o `obsidian-vault/` quando houver impacto arquitetural ou funcional.
5. Informar explicitamente se:
   - documentação atualizada; ou
   - documentação conferida sem necessidade de alterações.

---

# Mapa código → documentação

| Mudou... | Atualize |
|----------|----------|
| supabase/functions/** | docs/reference/edge-functions.md |
| supabase/config.toml | docs/reference/edge-functions.md |
| supabase/migrations/** | docs/reference/modelo-de-dados.md |
| termos de domínio | docs/reference/glossario.md |
| arquitetura, fluxos, integrações | docs/explanation/arquitetura.md + diagrams |
| scripts, setup | docs/how-to/desenvolvimento-local.md |
| deploy ou migrations | docs/how-to/deploy-e-migrations.md |
| procedimentos operacionais | docs/how-to/operacoes-rotineiras.md |
| nova decisão arquitetural | docs/decisions/ |
| fluxo do operador | docs/tutorials/ |

---

# Convenções essenciais

## Stack

Frontend

- React 18
- TypeScript
- Vite
- shadcn/ui
- Tailwind
- TanStack Query
- Zustand

Backend

- Supabase
- PostgreSQL
- Edge Functions
- Storage
- Auth

Infraestrutura

- QStash
- Redis

IA

- OpenRouter
- Modelos OpenAI

---

# Domínio

- PAI = 0 representa agrupador.
- Uma família gera um anúncio.
- Uma variação gera um SKU.
- CREATE cria anúncio.
- UPDATE atualiza anúncio existente.

---

# Planilha

Campos obrigatórios:

- CODIGO
- PAI
- NOME
- UNIDADE
- GTIN
- CUSTO
- PRECO
- ESTOQUE
- DESCRICAO_DETALHADO
- PESO_GRAMAS
- ALTURA_CM
- LARGURA_CM
- COMPRIMENTO_CM
- FORNECEDOR

---

# Arquivos

Fotos das variações:

- 00CODIGO.ext

Fotos comuns:

- CAPA_00CODIGO.ext
- CAPA2_00CODIGO.ext
- CAPA3_00CODIGO.ext

---

# Agent Skills

Issue Tracker

GitHub Issues:

analistasistemas-bit/gtinmktplace

Labels:

- needs-info
- ready-for-agent
- ready-for-human
- wontfix

Referências principais:

- CLAUDE.md
- docs/README.md
- docs/decisions/
- docs/agents/

---

# ADRs recorrentes

Consulte `docs/decisions/`.

Mais relevantes:

- 0003 variações agrupadas por pai
- 0004 atribuição de cor
- 0005 lifecycle publish/update
- 0006 QStash
- 0007 modelo de dados
- 0016 UPDATE com reposição
- 0018 dimensões e peso
- 0021 catálogo
- 0024 abstração de canais
- 0025 anúncios multicanal
- 0026 IA para atributos
- 0027 multi-tenancy
- 0028 billing

---

# Estado atual

Resumo atualizado:

- docs/project-status.md

Situação:

- E1 até E4 em produção.
- anuncios_externos ativo.
- process-familia validado.
- publish-familia-ml validado.
- remover-publicado validado.
- Taxonomia canônica adiada para segundo canal.
- Próximo épico: Shopee.

---

# O que nunca fazer

Nunca:

- inventar dados de produto;
- publicar sem revisão humana;
- quebrar idempotência;
- salvar tokens em texto puro;
- ignorar RLS;
- criar estrutura sem ADR;
- alterar anúncios reais fora do fluxo controlado.

---

# Histórico

Histórico completo:

- docs/project-history.md
- docs/TASKS.md
