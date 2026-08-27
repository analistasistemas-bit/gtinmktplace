---
name: orquestracao-dsh
description: Use somente quando o usuário invocar explicitamente `$orquestracao-dsh`, `orquestracao-dsh` ou `Orquestracao_DSH` para executar uma tarefa por orquestração multiagente no DSH com os combos do OmniRoute. Nunca use por inferência, similaridade ou ativação automática.
compatibility: Requer o DSH com o plugin Superpowers, a ferramenta workflow e o provedor omniroute configurado com os modelos Super-Modelo, Planejamento e Combo-free.
---

# Orquestração DSH

## Ativação explícita

- Ative somente quando o usuário escrever `$orquestracao-dsh`, `orquestracao-dsh` ou `Orquestracao_DSH`.
- Nunca ative automaticamente por inferência, similaridade ou complexidade da tarefa.
- Aceite a tarefa escrita junto da invocação.
- Se a invocação contiver somente o nome da skill, pergunte: **"Qual tarefa você quer que a Orquestração DSH execute?"**
- Não planeje nem despache agentes antes de receber a tarefa.

## Processo obrigatório: Superpowers

O plugin Superpowers define o fluxo principal desta skill. Após receber a tarefa, invoque realmente cada sub-skill abaixo na ordem indicada; citar, resumir ou reproduzir suas instruções não substitui a invocação:

1. **REQUIRED SUB-SKILL:** Use `superpowers:brainstorming` antes de qualquer implementação. Respeite seu gate de aprovação humana.
2. **REQUIRED SUB-SKILL:** Após a aprovação do design, use `superpowers:using-git-worktrees` antes de editar arquivos.
3. **REQUIRED SUB-SKILL:** Use `superpowers:writing-plans` para criar o plano de implementação.
4. Submeta esse plano ao **Gate 1** desta skill.
5. **REQUIRED SUB-SKILL:** Com o plano aprovado, use `superpowers:subagent-driven-development`; dentro desse processo, antes de cada tarefa de implementação ou correção, invoque `superpowers:test-driven-development` como **REQUIRED SUB-SKILL** e cumpra RED–GREEN–REFACTOR.
6. **REQUIRED SUB-SKILL:** Após integrar os resultados, use `superpowers:requesting-code-review`.
7. **REQUIRED SUB-SKILL:** Use `superpowers:verification-before-completion` com evidências recentes e então submeta o resultado ao **Gate 2** desta skill.
8. **REQUIRED SUB-SKILL:** Com o Gate 2 aprovado, use `superpowers:finishing-a-development-branch` antes da entrega final.

As instruções completas de cada sub-skill são vinculantes. Quando houver sobreposição de processo, siga o Superpowers; os combos OmniRoute e os dois gates abaixo continuam obrigatórios como roteamento e controles adicionais. Se o plugin, uma sub-skill requerida, a ferramenta `workflow`, o provedor `omniroute` ou um modelo exato requerido não estiver disponível, pare e informe o bloqueio sem simular conformidade.

## Papéis dos combos OmniRoute

Direcione sempre pelo provedor `omniroute` e pelo ID exato do modelo. Não tente escolher os modelos internos de cada combo.

| Modelo | Papel |
|---|---|
| `Super-Modelo` | Arquiteto e orquestrador: interpreta, planeja, coordena, integra, resolve conflitos e entrega |
| `Planejamento` | Revisor independente: revisa o plano e o resultado consolidado |
| `Combo-free` | Executor: pesquisa, implementa, testa e corrige tarefas delimitadas |

## Mecanismo obrigatório

Use a ferramenta `workflow`, pois ela permite selecionar `provider` e `model` para cada agente ou fase. Não substitua isso por `subagent` ou `subagent_fork` quando essas ferramentas não permitirem fixar os combos exigidos. Dentro de `superpowers:subagent-driven-development`, o processo da sub-skill governa o ciclo das tarefas e revisões, enquanto `workflow` é o mecanismo obrigatório para despachar seus agentes com os combos exigidos.

O script do workflow deve:

- declarar fases correspondentes ao fluxo abaixo;
- chamar agentes com `provider: "omniroute"` e o `model` exato do papel;
- usar resultados estruturados quando isso reduzir ambiguidade;
- manter o Super-Modelo responsável pelo planejamento e pela integração;
- manter o Planejamento independente dos executores;
- usar `pipeline` para cadeias independentes por item e `parallel` somente quando houver uma barreira real entre resultados.

## Fluxo DSH dentro do Superpowers

As fases abaixo complementam o processo Superpowers obrigatório; não o substituem nem permitem pular suas sub-skills.

### 1. Arquitetura e plano

Durante `superpowers:brainstorming` e `superpowers:writing-plans`, use um agente `Super-Modelo` para:

1. interpretar objetivo, restrições, entregáveis e critérios de conclusão;
2. examinar apenas o contexto necessário;
3. decompor o trabalho em tarefas concretas;
4. registrar dependências, responsável, escopo de escrita e verificação de cada tarefa;
5. estimar a quantidade mínima de executores necessária;
6. definir a estratégia de integração e validação final.

Nenhum executor começa antes de existir um plano explícito.

### 2. Gate 1 — revisão do plano

Use um agente `Planejamento` independente para revisar:

- cobertura do objetivo e dos critérios de aceite;
- dependências e ordem de execução;
- riscos de segurança, integridade e regressão;
- isolamento do escopo de cada executor;
- estratégia de testes;
- excesso ou falta de agentes;
- oportunidades concretas de reduzir tokens e coordenação.

O revisor deve retornar **aprovado** ou listar falhas objetivas e correções necessárias. Não bloquear por preferência estilística.

Se houver falha objetiva, devolva o plano ao `Super-Modelo` para uma correção e nova decisão do Gate 1. Não despache executores com plano reprovado.

### 3. Execução adaptativa

Execute o plano com `superpowers:subagent-driven-development`. Use agentes `Combo-free` somente para tarefas presentes no plano aprovado e obrigue cada executor que altera comportamento a seguir `superpowers:test-driven-development` com RED–GREEN–REFACTOR comprovado.

Cada executor recebe um pacote autocontido contendo:

- objetivo concreto;
- contexto mínimo necessário;
- arquivos ou área sob responsabilidade;
- dependências e insumos disponíveis;
- ações permitidas e proibidas;
- critérios de aceite;
- validação obrigatória;
- formato conciso de retorno: alterações, arquivos, validação, riscos e bloqueios.

Escolha a estratégia:

- sequencial quando uma tarefa depende do resultado anterior;
- paralela quando escopos e escritas são independentes;
- investigação paralela apenas diante de incerteza relevante;
- um único executor quando dividir aumentaria a coordenação sem benefício.

Não atribua dois executores ao mesmo escopo de escrita. Em tarefas somente de análise, duplique trabalho apenas quando revisão adversarial ou comparação realmente justificar o custo.

### 4. Integração e code review

Use o `Super-Modelo` para:

- consolidar os resultados dos executores;
- resolver inconsistências e conflitos;
- identificar lacunas em relação ao plano;
- solicitar correções localizadas ao executor responsável quando possível;
- realizar ou coordenar a verificação integrada;
- produzir um resultado consolidado para revisão.

Não transfira ao executor a responsabilidade arquitetural ou a decisão final. Com o resultado integrado, invoque `superpowers:requesting-code-review`, trate os achados conforme essa sub-skill e só então execute `superpowers:verification-before-completion` com evidências recentes.

### 5. Gate 2 — revisão final

Use um agente `Planejamento` independente para revisar:

- atendimento ao objetivo e aos critérios de aceite;
- integração correta dos resultados;
- evidências de testes e verificações;
- regressões, segurança e integridade;
- alterações fora do escopo;
- limitações não declaradas.

O revisor deve retornar **aprovado** ou falhas objetivas. Correções localizadas voltam ao `Combo-free` responsável; problemas de arquitetura ou integração voltam ao `Super-Modelo`. Depois da correção, revise novamente apenas o que mudou e seus efeitos relevantes.

### 6. Finalização e entrega

Somente após o Gate 2 aprovado, invoque `superpowers:finishing-a-development-branch`. Depois, use o `Super-Modelo` para consolidar a resposta ao usuário com:

- resultado alcançado;
- principais alterações ou entregáveis;
- verificações realizadas;
- limitações ou riscos reais;
- arquivos modificados quando aplicável.

## Limite e orçamento de agentes

- Mantenha no máximo **10 agentes ativos**, contando orquestrador, revisor e executores.
- O limite é um teto, nunca uma meta.
- Use normalmente:
  - tarefa simples: 1 Super-Modelo + 1 Planejamento + 1 Combo-free;
  - tarefa média: 1 Super-Modelo + 1 Planejamento + 2–4 Combo-free;
  - tarefa alta e realmente paralelizável: 1 Super-Modelo + 1 Planejamento + 5–8 Combo-free, respeitando o teto ativo.
- Considere agentes de correção e revisão dentro do mesmo limite.
- Reutilize resultados e, quando a ferramenta permitir, o agente responsável para correções.
- Não use um agente para tarefa trivial que o orquestrador conclui com menos custo.
- Não abra todos os slots preventivamente.

## Economia de tokens

1. Envie a cada agente somente o contexto necessário para sua função.
2. Não peça que executores repitam o planejamento global.
3. Não replique investigações sem incerteza ou risco concreto.
4. Prefira validação localizada; amplie apenas quando o impacto justificar.
5. Exija retornos estruturados e concisos.
6. Faça no máximo uma rodada normal de correção por gate; novas rodadas exigem falha objetiva remanescente.
7. Pare quando os critérios de conclusão estiverem comprovadamente satisfeitos.

## Segurança e disciplina

- Respeite as instruções do sistema, do usuário e do workspace em todos os agentes.
- Preserve aprovações humanas obrigatórias, políticas de sandbox e limites de ferramentas.
- Não permita que subagentes contornem restrições ou executem mudanças destrutivas sem autorização.
- Se uma limitação da ferramenta impedir o plugin Superpowers, uma sub-skill obrigatória ou o roteamento exato dos combos, informe o bloqueio; não simule que o processo ou os modelos corretos foram usados.
- Se a tarefa não justificar multiagentes, ainda siga o processo Superpowers e os dois gates, mas use somente um executor.
