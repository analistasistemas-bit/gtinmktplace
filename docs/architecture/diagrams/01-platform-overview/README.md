# 01 · Visão Geral da Plataforma

**Tipo Archify:** `architecture` · **Status:** AS-IS

## Especificação (antes da geração)

- **Mensagem principal:** PubliAI é um SaaS multi-tenant que transforma planilhas de produtos em anúncios publicados em marketplaces, hoje só Mercado Livre.
- **Público:** gestor / stakeholder novo, sem contexto técnico.
- **Elementos:** Operadores (por organização/tenant), PubliAI, Mercado Livre, Outros marketplaces (vitrine), OpenRouter, Mercado Pago, Telegram.
- **Relações:** upload/revisão (operador→PubliAI); publicação e leitura de status (PubliAI↔ML); IA de copy/atributos; leitura de liberações (Mercado Pago); alertas (Telegram); vitrine sem conector real.
- **Direção de leitura:** esquerda (operador) → centro (PubliAI) → direita (sistemas externos).
- **Omitido:** módulos internos, banco de dados, filas, infraestrutura — ver [02](../02-general-architecture/) e [07](../07-infrastructure/).
- **Fontes principais:** `obsidian-vault/00-Home/Visão Geral.md`; `docs/explanation/arquitetura.md`; `docs/project-status.md` (E7/E6).

## O que mostra

O PubliAI como caixa única vista de fora: quem usa (operadores de uma organização cliente), o que a plataforma faz, e com quais sistemas externos ela troca dados.

## Como ler

Da esquerda para a direita: o operador sobe planilha/fotos e revisa/aprova; o PubliAI processa com IA (OpenRouter) e publica no Mercado Livre; o Mercado Livre devolve webhooks (pedidos, perguntas, devoluções, moderação); o Mercado Pago informa liberações financeiras; o Telegram recebe alertas. "Outros marketplaces" é a vitrine já visível no menu, mas sem conector implementado.

## Fontes

- `obsidian-vault/00-Home/Visão Geral.md`, `obsidian-vault/01-Arquitetura/Arquitetura Geral.md`
- `docs/explanation/arquitetura.md`, `docs/project-status.md` (seção "Menus multi-marketplace", 2026-07-15)
- Graphify (`graphify-out/graph.json`, snapshot 2026-07-18) — confirmação de fronteiras de módulo, não usado para o conteúdo deste diagrama (é alto nível demais para o grafo de código)

## Limitações

- Não mostra multiusuário/permissões de menu (ADR-0047) nem o isolamento por organização (ver [06](../06-multi-tenant/)).
- "Outros marketplaces" agrega 4 marketplaces da vitrine (Shopee, Amazon, Magalu, Casas Bahia) em 1 nó — o próximo real é Shopee (E5).
- Não representa volumetria nem SLA de nenhuma integração.

## Atualização

- **Última revisão:** 2026-07-19.
- **Regenerar quando:** um novo marketplace conector for implementado (sai da vitrine); mudar o conjunto de sistemas externos (ex.: novo canal de IA, novo canal de alerta); mudar o modelo de tenant na visão de alto nível.
- **Como regenerar:** editar `diagram.architecture.json` e rodar (a partir da pasta da skill):
  ```bash
  node bin/archify.mjs validate architecture <caminho>/diagram.architecture.json --json
  node bin/archify.mjs render architecture <caminho>/diagram.architecture.json <caminho>/diagram.html
  ```
  Exportar SVG/PNG: ver `docs/architecture/archify-usage.md` (seção "Exportação").
