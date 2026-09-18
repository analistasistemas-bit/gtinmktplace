# Painel gerado do RoadmapMaestri

Como registrar fase e ler o status do time de agentes Maestri. Ver `memory/LogMaestri.md` (entradas
de 2026-09-18, "PAINEL GERADO") para o design completo e os critérios de aceite.

## Assinatura

```
scripts/maestri-fase.sh <fase> "<Agente>" ["nota"] [--tarefa T] [--aguarda A] [--entrega E] [--fim] [--encerrar]
```

- `<fase>` — uma das 9: `0 1 2 3a 3b 4 5 6 7`.
- `<Agente>` — um dos 9 nomes válidos: `Spec`, `Arquiteto`, `Frontend`, `Backend`, `Reviewer`,
  `"Testes / Verificador"`, `Docs`, `"Release / Github"`, `Orquestrador`.
- `[nota]` — texto livre de uma linha, opcional (3º posicional).

## Semântica

- **Sem `--fim`**: abre a fase (se nunca foi aberta) ou reentra nela (incrementa `rodadas`, zera
  `fim`). Também atualiza `fase_atual`, `responsavel` e `desde` do state.
- **Com `--fim`**: fecha a fase (grava `fim`) e **não** muda `fase_atual` — avançar de fase é a
  próxima chamada sem `--fim`, já na fase seguinte.
- **`--aguarda ""`** (string vazia): limpa a pendência com Diego (`aguarda_diego = null`).
  `--aguarda "texto"` grava a pendência.
- **`--encerrar`**: marca a **tarefa** (não a fase) como concluída — zera `fase_atual`,
  `responsavel` e `desde`, e seta `tarefa_encerrada = true`; não toca em `.fases[]`. O painel passa
  a mostrar `COM QUEM: — (tarefa encerrada)` e `PRÓXIMO: —` em vez de congelar na última fase
  aberta. Resolve o cabeçalho que, terminada a tarefa, continuava mostrando o último agente e a
  próxima fase para sempre — só limpava quando a tarefa seguinte abria a Fase 1.
  `tarefa_encerrada` volta a `false` automaticamente quando qualquer fase é aberta ou reentrada.
  Combinado com `--fim` na mesma chamada (a forma natural do Release no fim do fluxo), fecha a
  fase primeiro (grava `.fases[N].fim`, preserva `inicio`/`rodadas`) e só depois encerra a tarefa.

### Fase 0 — Setup/time

Única fase que o **próprio Orquestrador abre E fecha** (nas demais, abrir é do Orquestrador e
fechar é do agente da fase). Registra: conferir por `maestri list` que os agentes necessários
estão conectados, e fixar o modo de trabalho (Completo ou Hotfix) — dito pelo Diego, nunca
assumido pelo agente. Rodar antes de delegar a primeira fase de qualquer tarefa:

```
scripts/maestri-fase.sh 0 "Orquestrador" "<o que foi checado>"
scripts/maestri-fase.sh 0 "Orquestrador" "<o que foi checado>" --fim
```

Pular a Fase 0 deixa ela `⏳` para sempre no painel — foi o que aconteceu em todas as tarefas até
18/09/2026, porque nada neste doc explicava para que ela servia.

## O que é gerado — nunca editar à mão

- `memory/RoadmapMaestri.md` — regenerado por `scripts/maestri-painel.sh` a partir só de
  `memory/maestri-state.json` (nunca lê `LogMaestri.md`). Sincroniza também a nota do canvas
  `roadmapmaestri-time-de-age`.
- `memory/maestri-state.json` — fonte de verdade do estado. Ambos os arquivos estão no
  `.gitignore` (junto com os temporários `memory/.maestri-state.*` e `memory/.roadmap.*`).

`maestri-fase.sh` chama `maestri-painel.sh` automaticamente ao final de cada chamada
(auto-refresh) — não é preciso rodar os dois.

## Lock — por que existe e como se comporta

`maestri-fase.sh` serializa leitura→gravação com um lock por `mkdir` (`memory/.maestri-state.lock`,
atômico por POSIX; `flock(1)` não existe no macOS). Sem ele, duas chamadas simultâneas liam o
mesmo state e a última a gravar apagava em silêncio o que a outra tinha acabado de escrever — por
exemplo, uma pendência `--aguarda` recém-gravada.

Comportamento verificado do lock (E12):

- **Lock ocupado por outro agente**: a chamada espera em passos de 0,1s até 10s tentando adquirir.
  Se o dono liberar dentro do teto, a chamada segue normalmente.
- **Sinal (`INT`/`TERM`) no processo dono**: aborta a execução (`exit 130`/`143`) em vez de só
  liberar o lock e continuar — nenhuma escrita acontece depois do sinal.
- **Sem quebra automática de lock preso.** Se o teto de 10s estourar, a chamada sai `6` e a própria
  mensagem de erro traz o comando de resgate manual (`rm -rf "<caminho-do-lock>"`) — o operador
  confirma que nenhum agente está rodando antes de rodá-lo. Não há recuperação automática por
  idade: um verificador que checa "órfão → apaga → adquire" não é atômico e dois verificadores
  concorrentes podiam apagar o lock novo um do outro, admitindo dois escritores ao mesmo tempo —
  exatamente o defeito que o lock existe para impedir. Lock preso só acontece com `SIGKILL`/queda
  de energia durante a janela de leitura→gravação (~30-50ms); é raro e a recuperação manual é o
  preço aceito para não reabrir essa corrida.

## Variáveis de teste — nunca em produção

- `MAESTRI_STATE=<caminho>` — substitui `memory/maestri-state.json`.
- `MAESTRI_LOG=<caminho>` — substitui `memory/LogMaestri.md`.
- `MAESTRI_SKIP_NOTE=1` — pula a sincronização da nota do canvas (imprime o que enviaria).

Usar as três ao testar em scratch para não sujar o log/state reais.

## Exit codes

- `2` — argumento inválido (fase/agente fora da allowlist, flag sem valor).
- `3` — state corrompido ou com schema incompleto (faltam chaves das 9 fases).
- `4` — âncora de repositório não resolvida (`git rev-parse` falhou e nenhuma env var de teste foi
  definida).
- `6` — não obteve o lock dentro do teto de espera (10s). É o único modo de falha que pode travar
  o time — ver a seção "Lock" acima para os cenários e o comando de recuperação.

## Time e failover

### `maestri-fase.sh` é chamado pelos 9 roles

Os 8 agentes (Spec, Arquiteto, Frontend, Backend, Reviewer, Testes / Verificador, Docs,
Release / Github) e o Orquestrador têm, no próprio prompt (`.maestri/roles/<uuid>/CLAUDE.md`), a
instrução de rodar `scripts/maestri-fase.sh` ao abrir/fechar uma fase. Essa instrução testa a
existência do script **na RAIZ do projeto informada como working directory** — nunca no
diretório de role (`.maestri/roles/<uuid>/`), e nunca um script de mesmo nome achado em outro
repositório do disco.

Por quê: o `cwd` de um role não é a raiz do projeto, então um teste relativo ao `cwd` (rodado de
dentro do diretório de role) dá falso negativo mesmo dentro do próprio PubliAI. E se o agente
buscar o script pelo nome em outro lugar do disco, pode achar o `maestri-fase.sh` de outro
repositório e rodá-lo com o `cwd` errado — gravando fase/log no `memory/` do projeto errado, em
silêncio.

### Protocolo de failover de consultor

Consultor de reserva do time: **Consultor Grok Backup** (`cursor-agent --model
cursor-grok-4.6-high`, preset Shell — não existe preset Cursor nativo no `maestri preset list`).
Terceira família de modelo (Claude, GPT/Astra, agora xAI/Grok). Só assume quando um titular
(Astra ou Fable) falha por indisponibilidade — nunca corre em paralelo como uma terceira opinião.

1. **Diagnosticar por evidência, nunca por saída vazia.** Confirmar a falha do titular com
   `ps` (processo morto ou parado) — saída vazia ao ler o terminal costuma ser sintoma de como
   você está lendo, não de agente morto. Achado concreto: `cut -c` descarta em silêncio linhas
   com acento UTF-8 (`Illegal byte sequence`) — leia com `head`/`tail` puro ou redirecione para
   arquivo, nunca por `cut`.
2. **Repassar ao backup o prompt IDÊNTICO** que o titular recebeu, precedido de um cabeçalho
   `[FAILOVER]` explicando por que o titular caiu — nunca um resumo do que o titular teria
   respondido.
3. **"Agir" sobre um veredito tem definição fechada:** é mandar qualquer texto ao Diego citando
   esse veredito, ou escrever em log/fase a partir dele. Antes disso, se o titular voltar, o
   titular prevalece e o veredito do backup é descartado. Depois disso, o titular atrasado entra
   como adendo declarado — nunca reescrevendo em silêncio o que já foi dito.
4. **Carimbar a origem em todo reporte:** `[veredito do BACKUP]` ou `[veredito do TITULAR]`. O
   Diego nunca deve precisar adivinhar quem respondeu.
5. **O backup recusa** qualquer pedido sem o cabeçalho `[FAILOVER]` enquanto `ps` mostrar o
   titular vivo — dois consultores respondendo o mesmo gate em paralelo é o modo de falha a
   evitar, não redundância desejada. Esta regra vive no prompt do role `Consultor Sênior`
   (`.maestri/roles/<uuid>/CLAUDE.md`, compartilhado por titular e backup) — não só no prompt do
   Orquestrador —, então o próprio backup a aplica sem depender do Orquestrador para arbitrar.

### ⚠️ `SIGCONT` sozinho não restaura um agente de terminal suspenso

Depois de `kill -STOP` num agente rodando em terminal interativo (ex.: `codex`), `kill -CONT`
**não** o devolve ao trabalho. O processo volta a estado parado (`T`) imediatamente: quando o job
parou, o shell retomou o controle do terminal; o `kill -CONT` devolve o agente como grupo de
**background**, ele tenta ler o tty, leva `SIGTTIN` (sinal que atinge leitura de tty em
background, não em foreground) e volta a `T`. A restauração correta é **`Ctrl-C`**
(fecha o prompt de continuação que o texto vazado deixa aberto) **e depois `fg`**. Quem repetir
um teste de failover precisa saber disto antes de suspender o agente — parar é trivial, restaurar
não é.

### O que é versionado e o que não é

- `memory/RoadmapMaestri.md` e `memory/maestri-state.json` — **gitignored** (ver seção "O que é
  gerado" acima).
- `.maestri/roles/*` (10 diretórios versionados: os 9 do fluxo + `Consultor Sênior`) e
  `memory/LogMaestri.md` — **versionados**; mudança de regra de gate, roteamento de modelo ou
  escalação passa por commit normal, revisável em diff.
