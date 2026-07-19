# Backlog de diagramas complementares

> Diagramas que podem ser criados no futuro, fora do conjunto principal de 8. Não gerados nesta rodada — a maioria não é indispensável para explicar os diagramas principais.

| Item | Objetivo | Público | Motivo | Prioridade | Condição para criar |
|---|---|---|---|---|---|
| Autenticação e autorização (detalhado) | Explicar JWT, `is_admin`, `is_super_admin`, `allowed_menus` | Novo dev, segurança | O diagrama 06 cobre isolamento por org, não o RBAC de menu (ADR-0047) | Baixa | Se o modelo de papéis crescer (enum `org_role`, E8) |
| Segurança (superfícies de ataque) | Mapear fronteiras de confiança e segredos | Segurança | `docs/explanation/arquitetura.md` já tem uma seção textual; falta visual | Média | Antes de auditoria de segurança externa ou certificação |
| Observabilidade | Onde ficam logs/métricas hoje (ou a lacuna) | Infra | Card do diagrama 07 já registra a lacuna; falta plano concreto | Baixa | Quando uma stack de observabilidade for adotada |
| CI/CD | Pipeline de deploy passo a passo | Infra, novo dev | Hoje é só CLI manual (`supabase functions deploy`, Render auto-deploy) — pouco a diagramar ainda | Baixa | Se um pipeline de CI real for introduzido |
| Backup e recuperação de desastre | Procedimento de backup/restore | Infra | Existe "backup lógico pré-rollout" mencionado no E7, mas sem procedimento documentado geral | Média | Antes de um incidente real expor a lacuna |
| Estados do anúncio (`familias.status`, `anuncios_externos.status`) | Máquina de estado completa por canal | Novo dev | Mencionado nos diagramas 03/04, mas as transições completas (erro, retry) não estão visuais | Média | Se o suporte/debug de publicação precisar de referência visual |
| Estados de pedido (Faturamento) | Ciclo de vida de `ml_vendas`/devoluções | Novo dev | Fora do escopo desta tarefa (é módulo "além da publicação") | Baixa | Se o módulo Faturamento crescer em complexidade |
| Tratamento de erros por canal | `classificarErroCanal`, retry vs. não-retry | Novo dev | Detalhe de implementação do worker genérico (ADR-0061 D-E6.6) | Baixa | Quando o 2º canal real (Shopee) expuser mais casos de erro |
| Webhooks (detalhado por tipo) | Um diagrama por tipo de evento (pedido/pergunta/devolução/moderação) | Novo dev | O diagrama 04 já unifica os 4 em "Evento ML" — está correto no nível certo | Baixa | Se um tipo específico ganhar fluxo próprio complexo |
| Permissões (RBAC por menu) | `allowed_menus`, tela Usuários | Novo dev | Módulo pequeno, bem coberto por `docs/reference/modelo-de-dados.md` | Baixa | Se o RBAC ganhar granularidade nova |
| Integrações por marketplace | 1 diagrama por conector (ML, Shopee, …) | Novo dev | Só existe 1 conector real hoje (ML) — prematuro | Baixa | Quando o 2º conector real (Shopee, E5) entrar em produção |
| Modelo de dados detalhado (ERD completo) | Todas as tabelas e colunas | DBA, novo dev aprofundando | O diagrama 05 é deliberadamente simplificado | Baixa | `docs/diagrams/erd-modelo-de-dados.drawio` já cobre isso (drawio) — regenerar em Archify só se o drawio for descontinuado |
| Mapa de capacidades do produto | Visão por capacidade (conectar marketplace, publicar, sincronizar…) em vez de técnica | Gestor, novo PM | Considerado como substituto do diagrama 01/02, mas os 2 já cumprem esse papel para o público-gestor | Baixa | Se um público não-técnico (vendas, novos gestores) precisar de uma visão ainda mais alto nível |
