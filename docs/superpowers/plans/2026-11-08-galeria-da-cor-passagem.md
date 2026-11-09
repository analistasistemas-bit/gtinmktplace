# Galeria da cor — passagem de sessão (08/11/2026)

Sessão anterior encerrada por limite de contexto. Tudo abaixo está commitado na branch `worktree-imagens-anuncio-ia`.

## Onde estamos

- **Desenho fechado** (Diego): ADR-0201 §1–§13, regras `docs/superpowers/specs/2026-11-08-galeria-da-cor-regras.md`, glossário `CONTEXT.md` ("Imagens do anúncio por IA").
- **Plano:** `docs/superpowers/plans/2026-11-08-galeria-da-cor.md`, versão **v9**. Nenhum código escrito.
- **Revisão do plano:** 9 rodadas de Codex (`gpt-6.1-sol` high) e Grok 4.7 xhigh, todas REVISAR, com bloqueadores caindo (Codex: 8 → 1). Regra do Diego: **continuar as rodadas até os dois aprovarem sem nenhum BLOQUEADOR** ("não pode haver erro"; "sem pressa"; consultar GPT e Grok sempre).
- **Teto de 3 gerações por versão do roteiro (R8.2):** confirmado pelo Diego em 08/11.
- **Execução:** depois do plano aprovado, perguntar ao Diego o método (recomendado: subagent-driven). A Task 1 (ensaio no ML) exige que o Diego escolha 1 anúncio Legacy e 1 família UP de teste.

## Pendentes da 9ª rodada (aplicar na v10)

**Codex — BLOQUEADOR:** (Task 9) a trava `where posse = …` protege o banco, não o Storage; upload tardio de um worker que perdeu a posse sobrescreve ou ocupa o caminho da cena. Correção: objeto imutável por tentativa/posse (caminho com `posse`), `cena_path` publicado só por update condicional; arquivos perdedores ficam sem referência e a retenção limpa. Teste: upload antigo terminando por último → bytes servidos são os do vencedor.

**Grok — BLOQUEADOR 1:** (Tasks 13/14) na compensação, depois que o item já aplicou, o GET tem as fotos novas e `planejarFotosItem` devolve `mudou` → nunca restaura. Correção: na volta, a cor-alvo compara com `fotos_depois` e as outras cores com o retrato; cor-alvo divergente → `reversao_incompleta` sem PUT; igual → corpo restaura `fotos_antes` levando as demais cores como estão no GET. Teste com `atual` já contendo as fotos novas.

**Grok — BLOQUEADOR 2:** (Tasks 8/14) cada foto é uma fase e o SQL ignora itens com `publicado_em` nos últimos 3 min mesmo com lease livre; 7 fotos + espera de `pronta` × P/M/G estoura o prazo de 30 min. Correção: os 3 min só seguram mensagem ainda em voo — fase concluída zera `publicado_em` ou publica a fase seguinte na hora em `publish-ml-${familias.user_id}`. O prazo corta só a ida; a compensação segue até `revertida` ou `reversao_incompleta`.

**Menores (Codex e Grok):**
- `somenteEstoque=true` com cor nova (`criandoNovas`) também respeita a reserva; dispensa só quando o corpo efetivo não altera fotos nem variações. Teste explícito.
- Trocar roteiro durante `submetendo|gerando`: separar vigência editorial de execução (o worker conclui a geração, mas a imagem nasce `desatualizada` e não pode ser aprovada/aplicada). Testar na consulta Higgsfield e na resposta OpenRouter.
- Portão da compensação: vigência e prazo bloqueiam só o avanço; restauração usa reserva + conferência de fotos. Testar compensação com aborto, roteiro novo, prazo vencido e reversão dias depois.
- `buscarItemBackfill` devolvendo `null` → `conjunto_incompleto`.
- `update-familia-ml` adiado mantém `familias.status = 'publicando'`; aos 35 min, desfecho `erro` grava o status e finaliza o lote.
- Família UP em `update-familia-ml` cai em `rodarUP` antes de `atualizarAnuncio`: confirmar que esse ramo não reenvia fotos (ressalva, sem bloqueio).

## Como rodar uma rodada de revisão

1. Atualizar em `scripts/revisao-galeria/brief.md` a versão do plano (v10), o número da rodada (10ª) e a seção "Mudanças da v10".
2. Em paralelo, em background:
   `python3 -I scripts/revisao-galeria/revisar.py codex scripts/revisao-galeria/brief.md <saida-codex>` e o mesmo com `grok`.
3. Ler só o fim de cada saída (o veredito vem depois de `tokens used` no Codex; o Grok imprime direto).
4. Aplicar os achados na próxima versão, registrar em "Mudanças da vN", commitar e repetir.

## Material de apoio (fora do repo)

- Medição de modelos e mockups de layout: `~/Desktop/IA/medicao-galeria-2026-11-08/` (`index.html`, `layouts.html`).
- Regras dos agentes de origem: `~/Downloads/Agente 1.md`, `~/Downloads/Agente 2.md`, `~/Downloads/PubliAI-7-imagens-como-eu-faco.md`.

## Avisos de ambiente

- O guard do worktree barra comando bash composto, heredoc complexo e `$(...)`: use script Python em arquivo e `/usr/bin/git` simples.
- `.env.local` do checkout principal: `HF_CREDENTIALS` tem 3 partes; só as 2 últimas autenticam.
- Token do ML para leitura: `get_connection_tokens` (tabela `marketplace_connections`); nunca renovar por fora (refresh é rotativo).
