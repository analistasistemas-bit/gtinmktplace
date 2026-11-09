# Galeria da cor — passagem de sessão (08/11/2026)

Sessão anterior encerrada por limite de contexto. Tudo abaixo está commitado na branch `worktree-imagens-anuncio-ia`.

## Onde estamos

- **Desenho fechado** (Diego): ADR-0201 §1–§13, regras `docs/superpowers/specs/2026-11-08-galeria-da-cor-regras.md`, glossário `CONTEXT.md` ("Imagens do anúncio por IA").
- **Plano:** `docs/superpowers/plans/2026-11-08-galeria-da-cor.md`, versão **v23 — APROVADA** por Codex e Grok na 23ª rodada (09/11), sem BLOQUEADOR; MENORES registrados na seção "Aprovação (23ª rodada)". Nenhum código escrito.
- **Revisão do plano:** concluída. 23 rodadas de Codex (`gpt-6.1-sol` high) e Grok 4.7 xhigh; da 10ª à 23ª o desenho ganhou trava de escrita por MLB compartilhada com os escritores comuns, adiamento durável, identidade por anúncio/partição, relógio no banco e cobrança da galeria separada do gatilho do kit. Regra do Diego cumprida: os dois aprovaram sem nenhum BLOQUEADOR.
- **Teto de 3 gerações por versão do roteiro (R8.2):** confirmado pelo Diego em 08/11.
- **Execução:** depois do plano aprovado, perguntar ao Diego o método (recomendado: subagent-driven). A Task 1 (ensaio no ML) exige que o Diego escolha 1 anúncio Legacy e 1 família UP de teste.

## Próximos passos (dependem do Diego)

1. Escolher o método de execução (recomendado: subagent-driven, com revisão Codex + Grok no diff de cada task).
2. Escolher 1 anúncio Legacy com ≥2 variações e 1 família UP com ≥2 tamanhos da mesma cor para o ensaio da Task 1 (portão: se algum PUT sem `pictures` apagar fotos, a galeria não é liberada e o desenho volta ao Diego).

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
