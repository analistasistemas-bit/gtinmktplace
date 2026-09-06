# SDD ledger — plan: docs/superpowers/plans/2026-09-06-central-organizacoes.md

## Preflight

Base inicial: `88d57a70db87d9bd0695f8cba0fd2d4ae2dcbbfc`.

| Tarefas/interface | Produz → consome | Resultado do preflight |
|---|---|---|
| Task 1 | schema/DTO/auth/condições | Coerente após tornar `version` obrigatório no DTO persistido e validar vigência mensal. |
| Task 2 | núcleo puro + métricas | Coerente; preservar bruto com refunded e estornos separados, e markup compartilhado. |
| Task 3 | resultado/busca/evento/entrega Sonar | Coerente com unidade única no endpoint convergente e reabertura por resultado durável. |
| Task 4 | prévia/fechamento/auditoria/router | Coerente; prova de atomicidade exige PostgreSQL real local. |
| Task 5 | API/hooks/export do snapshot | Coerente; não recalcula total nem reutiliza caches operacionais. |
| Task 6 | carteira/detalhe/resultados/Pulse/auditoria | Coerente; importa contratos de Task 5 e componentes de Task 7. |
| Task 7 | condições/cobrança/configurações | Coerente; zero é valor válido e conflito exige nova conferência. |
| Task 8 | integração/evidências/docs | Coerente; somente ambiente local/efêmero e sem promoção externa. |
| Tasks 1→2 | DTO `OrgMetrics`, validação de org/mês | Compatível. |
| Tasks 1→3 | condição vigente e identidade de org/ator | Compatível com resolução `starts_on desc, version desc`. |
| Tasks 1→4 | auth/DTO/condições → backend | Compatível. |
| Tasks 1→5/7 | tipos comerciais → cliente/formulários | Compatível; `version` está no retorno, não no input de criação. |
| Tasks 2→4/6 | cálculo/métricas → router/UI | Compatível; código de produção deve importar o núcleo testado. |
| Tasks 3→4/6 | entregas/eventos → apuração/Pulse | Compatível; competência definida no `complete` pelo relógio servidor. |
| Tasks 4→5/7 | ações/snapshots → hooks/cobrança | Compatível. |
| Tasks 5→6/7 | hooks/export → páginas/componentes | Compatível. |
| Tasks 6↔7 | `OrgBilling`/`OrgSettings` e `Organizacoes.tsx` | Evitar escrita concorrente em `Organizacoes.tsx`; Task 7 cria componentes sem extração até Task 6 liberar. |
| Tasks 6/7→8 | UI completa → integração | Compatível. |

Ruling: `platform_commercial_terms.version` é obrigatório, positivo e parte de `UNIQUE(org_id, starts_on, version)`; a condição aplicável é a maior `starts_on`, depois maior `version`, sem flag/índice de ativo que exija atualizar versão antiga — preserva append-only aprovado — custo se errado: consumidores podem esperar uma única linha futura sem histórico de versões.

Ruling: competência de entrega Sonar é calculada na conclusão atômica no servidor em `America/Fortaleza`; início da busca e body do navegador não definem competência — evita cobrar no mês errado quando uma coleta cruza a virada — custo se errado: contratos que pretendam competência pela intenção exigirão migração de regra e reapuração.

Ruling: uso Daludi registra evento isento e não ocupa `UNIQUE(org_id,result_id)` da entrega de cliente; cliente sem contrato registra entrega isenta durável — atende primeira entrega independente e vedação de retroatividade — custo se errado: relatórios que tratem toda tentativa como uma linha de entrega precisarão consultar eventos também.

Ruling: fechamento já existente por organização/competência retorna o snapshot imutável e não cria duplicata; `expected_revision` protege apenas a primeira transição aberta→fechada — mantém idempotência de retry — custo se errado: um cliente que espere conflito ao repetir fechamento com revisão velha receberá o snapshot já fechado.

Ruling: o runtime conta threads concluídas no limite global e não oferece close/evict; com raiz, Astra, Sol e Terra, o spawn de Luna falha com `agent thread limit reached`. Reutilizar `/root/terra_foundation` sequencialmente para Tasks 2–8, inclusive as Tasks 5/7 originalmente delimitadas para Luna, preservando briefs, escopos e revisão Sol — é o único caminho suportado para concluir a implementação sem trocar para Astra ou escrever no coordenador — custo se errado: perde-se o ganho de velocidade/custo do Luna e o paralelismo originalmente planejado.

Task 1: fix round 1/5 (2 achados originais e 2 lacunas de re-review endereçados, 0 abertos; commits `f32e519..f6d88f1`). O script SQL agora recusa banco fora do nome/local dedicado; RPC e tabela rejeitam missing, decimal e centavos fora de inteiro seguro; setup_due inválido retorna 22023.

Task 1: complete (commits `7fa6d44..f6d88f1`, review Sol: spec ✅, quality approved; 10/10 unitários, Deno PASS, SQL PostgreSQL real/concorrência exit 0).

Ruling: em resposta explícita ao bloqueio de execução, o usuário autorizou Sol a assumir também a implementação de Tasks 2–8; isso substitui nesta tarefa a restrição anterior de escrita exclusiva Terra/Luna, mantendo os mesmos contratos, escopos, revisão e validação — permite concluir apesar do executor reutilizado encerrar sem erro técnico — custo se errado: reduz a independência entre implementação e revisão, compensada por testes reais e revisão final documentada.

Task 2: implementação concluída. O frontend reexporta o mesmo núcleo puro usado pela central para resumo, custos, canonicalização, tipos e custo congelado. O repositório pagina vendas/variações, filtra `org_id` em todas as fontes, valida filhos embutidos, calcula série de seis meses e período anterior equivalente em Fortaleza e torna markup indisponível com aviso quando custo ou configuração falham. Contagens operacionais permanecem indisponíveis com aviso porque não há fonte única confiável no escopo aprovado.

Task 3: implementação concluída. Resultados Sonar são versionados e imutáveis após publicação; uma intenção concorrente elege um coletor, retries aguardam o mesmo resultado e lease expirado pode ser retomado com fencing. Entrega principal, resultado durável e consumo são concluídos atomicamente; preço/competência vêm da condição e relógio do servidor. Reabertura usa a versão histórica mesmo após TTL, Daludi permanece isento sem ocupar a chave de entrega cliente, complementos recebem apenas correlação persistida e a UI separa histórico/query cache por organização, ator e suporte.
