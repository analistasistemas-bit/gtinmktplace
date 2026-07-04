# ADR-0058 — Categoria genérica ("Outros") como fallback visível, não bloqueio

**Status:** Aceito
**Data:** 2026-07-04
**Decisores:** Diego
**Relaciona:** revisa parcialmente [ADR-0054](0054-categoria-titulo-tipo-produto-generico.md) (decisão 3: "genéricos nunca
são resposta automática"); estende [ADR-0057](0057-categoria-selecao-livre-e-sugestao-concorrente.md) (busca livre de
categoria)

## Contexto

O ADR-0057 fechou o caso "BAINHA INSTANTÂNEA 4MT UND" (lote 51) dando ao operador uma busca livre — mas a família
continuava nascendo **bloqueada** ("Categoria indefinida — busque antes de publicar") sempre que o preditor do ML só
encontrava categorias genéricas tipo "Outros" (comportamento do ADR-0054, decisão 3).

Diego pediu explicitamente: quando o resolver não achar uma categoria específica, a família deve vir com "Outros" já
aplicado como padrão (não bloqueada), mantendo a opção de buscar e trocar quando quiser.

## Decisão

1. **`resolverCategoria` (`_shared/categoria/resolver.ts`)**: quando todos os candidatos retornados pelo preditor são
   genéricos (`especificos.length === 0`), em vez de travar em `manual`/`categoriaId: null`, aplica o **topo** (melhor
   candidato genérico rankeado pelo ML) com uma origem nova, `'generico'` — distinta de `'preditor'`/`'ia'` (que
   indicam uma categoria específica) e de `'manual'` (verdadeiro impasse, sem nenhum candidato).
   - **Não muda** o caso "pista forte sem candidato compatível" (`sem-candidato`): ali o problema não é ausência de
     candidato específico, é desconfiança de que os candidatos disponíveis sirvam — continua em `manual`.
   - **Não muda** o caso zero candidatos (preditor não achou nada): não há genérico algum pra usar como fallback —
     continua em `manual`.
2. **Novo valor de enum** `tipo_origem = 'generico'` (migration aditiva, mesmo padrão do ADR-0026 que adicionou
   `'preditor'`).
3. **`process-familia` não muda.** O branch que decide entre caminho curado e caminho genérico já é baseado em
   `categoriaParaTipo(tipo) != null`, não na origem — com `categoriaMlId` agora preenchido, o caminho genérico
   (`resolverAtributosGenericos`, schema real da API) já roda automaticamente, sem nenhuma alteração.
4. **Frontend (`CardCategoria`)**: com `tipoOrigem === 'generico'`, a família aparece como **definida** (nome +
   category_id, não mais o alerta vermelho de bloqueio), com um selo de aviso distinto ("Categoria genérica — busque
   uma melhor se quiser") e o campo de busca do ADR-0057 continua disponível abaixo — reaproveitado, não duplicado —
   pra trocar quando o operador quiser.

## Por que isso não reabre o incidente do ADR-0054

O ADR-0054 encontrou categorias genéricas erradas sendo aceitas **silenciosamente e automaticamente**, sem sinal
nenhum pro operador — a família publicava (ou quase publicava) sem revisão. Aqui:

- A categoria genérica fica **visível e sinalizada** (selo de aviso), nunca escondida atrás de uma família
  "aparentemente normal".
- **Revisão humana antes de publicar continua obrigatória** (regra operacional do projeto, inalterada) — a família
  ainda passa pela Revisão antes de qualquer publicação real; o selo de aviso existe exatamente pra chamar atenção
  nesse momento.
- O operador sempre pode buscar e trocar — a via de escape do ADR-0057 nunca foi removida, só deixou de exigir ação
  manual pra sair do estado "indefinida".

## Consequências

**Boas:**
- Fecha o atrito real: famílias fora do domínio de aviamentos deixam de travar por padrão — "Outros" desbloqueia,
  busca corrige.
- Reaproveita 100% do que o ADR-0057 já construiu (busca, `resolverAtributosGenericos`, `definir-categoria-familia`)
  — zero código novo de infraestrutura, só o desvio de decisão no resolver + 1 badge novo no front.

**Tradeoffs aceitos:**
- Menos visibilidade que o bloqueio total (uma família com "Outros" pode passar pela Revisão sem o operador notar o
  selo, se ele não olhar o card de categoria). Mitigado pelo selo de aviso + revisão humana continuar obrigatória.
- Categoria "Outros" ainda pode ser tecnicamente incorreta pro nicho do produto (mesmo problema de sempre) — a busca
  existe justamente pra isso.

## Como reverter

Trocar o `return` do passo 3 em `resolver.ts` de volta pra `{ categoriaId: null, categoriaNome: null, tipo: 'outro',
origem: 'manual' }` restaura o comportamento do ADR-0054/0057. O valor de enum `'generico'` pode ficar sem uso (enums
Postgres não encolhem, mas isso é inofensivo).

## Adendo (2026-07-04) — resgate pro genérico também quando a IA descarta um específico

Caso real (lote 51, "BAINHA INSTANTÂNEA 4MT UND"): o preditor do ML devolveu, na mesma busca, o genérico correto do
segmento (`MLB1371` "Outros" — Artes e artesanatos) **e** um específico falso-amigo ("Bainhas para Facas" — bainha
de faca, homônimo de bainha de tecido). A IA de desempate corretamente recusou o específico errado, mas o resolver
então caía direto em `manual` — descartando o genérico correto que já estava na mesma lista de candidatos. A
família ficava bloqueada mesmo tendo a categoria certa (do segmento) disponível o tempo todo.

Fix: `resolverCategoria` agora computa `genericos` da lista COMPLETA de candidatos (não só quando não sobra nenhum
específico) e resgata pro melhor genérico disponível em todo ponto que devolveria `manual` — exceto quando o
preditor não devolve candidato nenhum (nada pra resgatar). Nunca escolhe um específico errado; só evita jogar fora
um genérico que já estava na resposta do ML. Testes `(n2)`/`(n3)` em `resolver.test.ts` reproduzem o caso real.

Separadamente, `CardCategoria` ganhou um link "Trocar categoria" sempre visível pra qualquer categoria já definida
(não só a genérica automática) — sem isso, um operador que escolhesse manualmente uma categoria errada pela busca
(`tipo_origem='manual'`, não `'generico'`) ficava sem nenhuma forma visível de buscar de novo. Foi exatamente o que
aconteceu ao vivo: o operador digitou literalmente "outros" no campo de busca, o ML devolveu buckets "Outros" de
domínios de veículos náuticos (`MLB1905` e afins — coincidência textual, não erro do sistema), e a categoria errada
ficou permanentemente presa sem saída visível. Corrigido com um toggle sempre presente + `useEffect` sincronizando
a abertura automática quando a categoria vira genérica num refetch ao vivo (card já montado, sem remount).
