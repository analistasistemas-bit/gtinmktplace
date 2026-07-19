#!/bin/bash

mkdir -p obsidian-vault

mkdir -p obsidian-vault/00-Home
mkdir -p obsidian-vault/01-Arquitetura
mkdir -p obsidian-vault/02-Fluxos
mkdir -p obsidian-vault/03-Módulos
mkdir -p obsidian-vault/04-Decisões
mkdir -p obsidian-vault/05-Bugs
mkdir -p obsidian-vault/06-Roadmap
mkdir -p obsidian-vault/07-IA
mkdir -p obsidian-vault/08-Reuniões/2026
mkdir -p obsidian-vault/09-Logs
mkdir -p obsidian-vault/99-Templates

touch "obsidian-vault/00-Home/Home.md"
touch "obsidian-vault/00-Home/Visão Geral.md"
touch "obsidian-vault/00-Home/Glossário.md"

touch "obsidian-vault/01-Arquitetura/Arquitetura Geral.md"
touch "obsidian-vault/01-Arquitetura/Frontend.md"
touch "obsidian-vault/01-Arquitetura/Backend.md"
touch "obsidian-vault/01-Arquitetura/Supabase.md"
touch "obsidian-vault/01-Arquitetura/Banco de Dados.md"
touch "obsidian-vault/01-Arquitetura/Edge Functions.md"
touch "obsidian-vault/01-Arquitetura/APIs.md"
touch "obsidian-vault/01-Arquitetura/Segurança.md"
touch "obsidian-vault/01-Arquitetura/Integrações.md"

touch "obsidian-vault/02-Fluxos/Login.md"
touch "obsidian-vault/02-Fluxos/Publicação Mercado Livre.md"
touch "obsidian-vault/02-Fluxos/Processamento IA.md"
touch "obsidian-vault/02-Fluxos/Upload Planilha.md"
touch "obsidian-vault/02-Fluxos/Upload Fotos.md"
touch "obsidian-vault/02-Fluxos/Publicação Shopee.md"
touch "obsidian-vault/02-Fluxos/Amazon.md"
touch "obsidian-vault/02-Fluxos/Fluxo Completo.md"

touch "obsidian-vault/03-Módulos/Dashboard.md"
touch "obsidian-vault/03-Módulos/Produtos.md"
touch "obsidian-vault/03-Módulos/Marketplace.md"
touch "obsidian-vault/03-Módulos/Usuários.md"
touch "obsidian-vault/03-Módulos/Assinaturas.md"
touch "obsidian-vault/03-Módulos/Billing.md"
touch "obsidian-vault/03-Módulos/IA.md"
touch "obsidian-vault/03-Módulos/Configurações.md"

touch "obsidian-vault/04-Decisões/ADR-001.md"
touch "obsidian-vault/04-Decisões/ADR-002.md"
touch "obsidian-vault/04-Decisões/ADR Template.md"

touch "obsidian-vault/05-Bugs/Bugs Conhecidos.md"
touch "obsidian-vault/05-Bugs/Problemas Resolvidos.md"
touch "obsidian-vault/05-Bugs/Incidentes.md"

touch "obsidian-vault/06-Roadmap/Backlog.md"
touch "obsidian-vault/06-Roadmap/Sprint Atual.md"
touch "obsidian-vault/06-Roadmap/Próximas Features.md"
touch "obsidian-vault/06-Roadmap/Ideias.md"

touch "obsidian-vault/07-IA/Claude.md"
touch "obsidian-vault/07-IA/Graphify.md"
touch "obsidian-vault/07-IA/Serena.md"
touch "obsidian-vault/07-IA/Prompts.md"
touch "obsidian-vault/07-IA/Agentes.md"

touch "obsidian-vault/09-Logs/Changelog.md"
touch "obsidian-vault/09-Logs/Deploys.md"
touch "obsidian-vault/09-Logs/Releases.md"

touch "obsidian-vault/99-Templates/ADR.md"
touch "obsidian-vault/99-Templates/Feature.md"
touch "obsidian-vault/99-Templates/Bug.md"
touch "obsidian-vault/99-Templates/Reunião.md"
touch "obsidian-vault/99-Templates/Sprint.md"

echo ""
echo "✅ Vault criado com sucesso!"
