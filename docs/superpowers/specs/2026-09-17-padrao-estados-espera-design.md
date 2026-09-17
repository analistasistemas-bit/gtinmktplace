# Design — padrão único para "o sistema está processando, aguarde"

**Data:** 2026-09-17
**Autor:** Diego + agente
**Status:** aguardando revisão
**Inventário de origem:** [2026-09-17-inventario-estados-espera.md](./2026-09-17-inventario-estados-espera.md)

---

## 1. Problema

O PubliAI tem dois efeitos visuais de "operação em andamento" já implementados, bem resolvidos e com guards de acessibilidade — mas aplicados a esmo:

| Efeito | Definição | Onde aparece hoje |
|---|---|---|
| `.glow-effect-sombra` | `src/components/ui/glow-effect.css:65` | 2 modais |
| `.track-indeterminate` | `src/index.css:217` | 3 lugares |

Fora esses 5 pontos, o sistema tem **37 lugares** onde o operador clica e espera. A maioria não devolve nada além de um botão desabilitado e um texto trocado ("Salvando…"); uns poucos giram um ícone. O relato que originou o pedido do glow em 2026-09-10 (`docs/TASKS.md:6246`) foi exatamente esse: *"o botão virava 'Criando…' e nada mais se mexia — parecia travado"*.

O problema não é a falta de um efeito. É a **ausência de padrão**: cada tela resolve (ou não resolve) do seu jeito, e o operador não tem um sinal único que signifique "está rodando, não clique de novo".

## 2. Objetivo

Um vocabulário visual único e previsível para espera de processamento, aplicado em todas as janelas e botões do sistema onde o operador fica parado esperando.

**Não-objetivos:**

- Não mexer em nenhuma chamada de mutation, edge function ou RPC.
- Não introduzir progresso determinístico onde a operação é indeterminada (proibido pelo contrato de motion §9, regra 6).
- Não criar um terceiro efeito. O trabalho é distribuir os dois que já existem.
- Não refatorar nada fora do ciclo de vida de modal e da sinalização de pendência.

## 3. O padrão

### 3.1 Regra

| Situação | Glow | Barra |
|---|---|---|
| Modal com operação assíncrona | sim | sim |
| Modal de operação **destrutiva** | **não** | sim |
| Botão de espera fora de modal | não | sim |
| Carregamento inicial de dados (abertura de tela/modal) | não | não — é `Skeleton`, caso diferente |

A exceção destrutiva vem do contrato de motion §10 ("ações destrutivas nunca lúdicas — sem bounce, overshoot, comemoração"). O glow cicla três cores de gráfico e lê como celebração; num "Excluir produto" isso é ruído semântico. A barra sozinha informa sem comemorar — que é exatamente o que `lote-card.tsx:132` (excluir lote) já faz hoje. A exceção alinha o resto do sistema com essa escolha; não inventa uma.

**O que conta como destrutivo** é o efeito no Mercado Livre, não a palavra no botão. São cinco: "Excluir produto", "Remover do sistema", "Remover publicação incompleta", "Migrar para preço por variação" (fecha o anúncio original em definitivo) e "Refazer kit" (encerra o kit no ML). "Corrigir e republicar" fica de fora — pausa e reenvia, sem encerrar nada.

### 3.2 Interface

A mecânica mora no componente base, não copiada em cada tela:

```tsx
<DialogContent processando={salvando}>              {/* glow + barra + aria-busy */}
<DialogContent processando={excluindo} destrutivo>  {/* barra + aria-busy */}
<AlertDialogContent processando={removendo} destrutivo>
```

`processando` é o único ponto de entrada. Ele controla, de uma vez:

1. `aria-busy={processando}` no content;
2. a classe `glow-effect-sombra`, salvo quando `destrutivo`;
3. a renderização da barra indeterminada.

Fora de modal:

```tsx
<ProgressoIndeterminado label="Atualizando anúncios" />
```

Cinco linhas em `src/components/ui/progresso-indeterminado.tsx`. Existe para que `role="progressbar"` e `aria-label` não sejam reescritos — e esquecidos — em nove lugares diferentes.

### 3.3 Posição da barra no modal

`absolute inset-x-0 top-0`, encostada no topo do content.

A alternativa natural — barra como primeiro filho do grid, com `sticky` para grudar ao rolar — foi descartada na revisão: o content é `grid gap-4`, então a barra ocuparia um track próprio e o `gap` empurraria todo o conteúdo 16px para baixo no instante em que o sinal liga. Salto de layout no clique é exatamente o que o contrato de motion §9 proíbe, e margem negativa não resolve (gap é espaço entre tracks, não margem).

`absolute` não cria track. O custo é perder o "gruda ao rolar" nos três modais com `overflow-y-auto`; nesses, o glow é box-shadow do container e continua visível durante a rolagem, então o recado não se perde.

A barra tem 6px de altura (`src/index.css:219`) e o botão de fechar começa em 8px (`dialog.tsx`, `absolute top-2 right-2`) — não colidem.

### 3.4 Onde o CSS passa a morar

`glow-effect.css` só entra no bundle pelo componente `GlowEffect` (sidebar, overlay de login). Por isso `dialog-criar-kit.tsx:24` carrega um import manual com um comentário explicando a armadilha.

Com a mecânica dentro de `src/components/ui/dialog.tsx`, o import vai para lá — uma vez — e a armadilha deixa de existir. Os imports manuais nos dois modais que hoje usam a classe saem junto com a migração deles para a prop.

## 4. Escopo

Das 37 ocorrências levantadas, 4 grupos de tratamento:

### Grupo A — 18 modais que já ficam montados durante a espera

Aplicação mecânica de `processando`. Um deles (`dialog-excluir-produto`) leva `destrutivo` junto — os outros dois modais destrutivos do sistema ("Remover do sistema" e "Remover publicação incompleta") são do Grupo B e recebem a prop lá.

Casos que exigem atenção pontual:

- `dialog-cadastro-produto.tsx` — tem três estados de ocupado (`salvando`, `enviandoFoto`, `enviandoFotos`), já consolidados em `ocupado` na linha 395. É esse que a prop recebe.
- `dialog-fiscal-produto.tsx` — `salvando` é uma união `'salvar' | 'proximo' | null`, não um booleano. Passa `!!salvando`.
- `Usuarios.tsx:322` — dois botões independentes no mesmo modal. A prop reflete só o "Salvar"; o "Enviar teste" é instantâneo e continua com o tratamento atual.

### Grupo B — 7 modais que hoje desmontam antes da operação terminar

6 em `Publicados.tsx`, 1 em `DetalheFinanceiro.tsx`. São `AlertDialog` não controlados: o `AlertDialogAction` do Radix fecha o modal no clique, e o estado de pendência vive na linha da tabela. Aplicar o efeito neles sem mudar nada seria código morto.

**Mudança de comportamento (decisão do Diego, 2026-09-17):** esses modais passam a ficar abertos até a operação resolver.

Mecânica:

1. `open` controlado por estado no componente pai (hoje é `AlertDialogTrigger` sem controle);
2. `event.preventDefault()` no `onClick` do `AlertDialogAction`, que impede o fechamento automático do Radix;
3. fechamento em `onSettled` — **sucesso e erro**, para que uma falha nunca deixe o modal preso;
4. `AlertDialogCancel` desabilitado enquanto `processando`, para não fechar no meio.

Estas são as confirmações de **Pausar, Corrigir e republicar, Remover do sistema, Remover publicação incompleta, Migrar para preço por variação e Refazer kit** — todas ações reais no Mercado Livre. Nenhuma chamada de mutation é tocada; só o ciclo de vida do modal que as dispara. Ainda assim é o trecho de maior risco da entrega e o que precisa do escrutínio mais duro na revisão.

### Grupo C — 3 confirmações sem estado de pendência

Os `AlertDialog` de remover capa/2ª/3ª foto em `familia-expanded.tsx` (linhas 671, 716, 755) chamam um handler `async` sem rastrear pendência e sem desabilitar o botão — hoje é possível clicar duas vezes. Aqui o padrão visual vem depois de criar o estado que falta; é correção de comportamento, não cosmética.

### Grupo D — 7 dos 9 botões de espera fora de modal

`ProgressoIndeterminado` junto ao botão. Inclui os "Atualizar" de `Publicados` e `DetalheFinanceiro`, "Reenviar N com erro", "Registrar/Desfazer saque", "Regenerar descrição" (IA), "Cancelar solicitação" e "Reenviar" do kit.

Dois dos nove ficam de fora, com motivo:

- `Organizacoes.tsx:322/455` ("Entrar na operação") não tem estado de pendência nenhum **e** navega para outra tela ao concluir — criar o estado ali é trabalho de comportamento com ganho visual duvidoso, já que a tela troca.
- `variacao-card.tsx:73` (troca de foto) já usa `StatusInline`, que informa mais do que uma barra genérica. Substituir seria piorar.

### Fora de escopo

Menu mobile (`app-shell`), dialog instrucional do iOS (`install-prompt-banner`), foto ampliada (`variacao-card`), carregamento de abertura do `pulse/dialog-detalhe` (já usa `Skeleton`, e é caso diferente por §9 do contrato) e as duas confirmações puramente síncronas.

## 5. Acessibilidade

Os dois efeitos já trazem guards de `prefers-reduced-motion` (glow fica parado mas visível; barra vira trilho cheio) e `forced-colors` (glow some). Nada a fazer além de preservá-los.

O que a entrega acrescenta:

- `aria-busy` no content, que hoje existe em 2 dos 28 modais no escopo;
- `role="progressbar"` com `aria-label` descritivo em cada barra — o rótulo diz a operação ("Enfileirando publicação"), nunca "Carregando";
- no Grupo B, o `AlertDialogCancel` desabilitado enquanto processa, que também protege quem navega por teclado de fechar no meio.

## 6. Testes

O padrão é uma mecânica única aplicada 37 vezes. Testá-la 37 vezes seria ruído, não cobertura.

**Na base — uma suíte, em `src/components/ui/__tests__/`:**

- `processando` liga glow, barra e `aria-busy`;
- `destrutivo` suprime o glow e preserva a barra;
- estado ocioso não renderiza barra nem classe;
- a barra expõe `role="progressbar"` com o `aria-label` recebido;
- idem para `AlertDialogContent`.

**Onde o comportamento muda — teste por caso:**

- Grupo B (7): modal segue aberto durante a mutation; fecha no sucesso; **fecha também no erro**; `Cancel` desabilitado em voo.
- Grupo C (3): botão desabilita durante a remoção; duplo clique não dispara duas chamadas.

**Grupos A e D:** sem teste dedicado por arquivo. A mecânica já está coberta na base, e o que resta é passagem de prop — verificado por typecheck e pela validação visual.

Atenção às duas árvores de teste do repo (`src/**/__tests__/` e `tests/`): a triagem de falhas precisa cobrir as duas.

## 7. Validação

- `pnpm preflight:static` antes do push (portão real de CI deste projeto);
- validação visual com Playwright em sessão isolada, com screenshot real — snapshot de acessibilidade não pega bug de layout CSS. Alvos mínimos: um modal que rola (cadastro de produto, para provar o `sticky`), um destrutivo (para provar a ausência do glow) e um do Grupo B (para provar que segura aberto e fecha sozinho);
- revisão do Fable sobre o plano de implementação e sobre o diff final, antes do merge.

## 8. Documentação

- Emenda ao `docs/motion/contrato-motion-v5.md` §9 e §10, fixando o padrão e a exceção destrutiva. O §9 diz "nunca um padrão universal de carregamento" — a emenda precisa deixar explícito que isso continua valendo para *carregamento de conteúdo* (que segue sendo skeleton por fluxo), e que o padrão aqui é para **ação disparada pelo operador**, que é outra coisa.
- ADR novo registrando a decisão do Grupo B (modal que segura aberto), que é mudança de comportamento em telas de produção. Numeração escolhida **após `git fetch`** — há ADRs sendo criados em paralelo.

## 9. Fases

| # | Fase | Entrega |
|---|---|---|
| 1 | Base | prop `processando`/`destrutivo`, `ProgressoIndeterminado`, suíte da base, import do CSS migrado |
| 2 | Grupo A | 18 modais + remoção dos 2 imports manuais de CSS |
| 3 | Grupo B | 7 modais controlados + 7 testes de comportamento |
| 4 | Grupo C | 3 confirmações com pendência + testes |
| 5 | Grupo D | 9 botões |
| 6 | Fecho | emenda ao contrato, ADR, validação visual |

Fase 1 é pré-requisito de todas. 2, 3, 4 e 5 são independentes entre si.

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Grupo B muda o comportamento de 7 confirmações em telas de produção do ML | Nenhuma mutation tocada; `onSettled` garante fechamento também no erro; teste por caso; revisão do Fable; validação em runtime |
| `sticky` se comportar diferente em modal que rola vs. modal fixo | Screenshot real nos dois layouts, não só teste de unidade |
| Glow pesar em modal grande com muitas linhas | É `box-shadow` animado, sem repaint de conteúdo; já roda hoje no cadastro de kit, que é dos maiores |
| Emenda ao contrato de motion contradizer o §9 | A emenda separa explicitamente "carregar conteúdo" de "ação do operador" |
| Regressão em teste de data fixa ou em arquivo fora do diff | Provar "pré-existente" rodando em `origin/main`, nunca inferindo do diff |
