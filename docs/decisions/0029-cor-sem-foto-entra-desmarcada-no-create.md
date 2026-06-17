# ADR-0029 — Cor sem foto entra desmarcada da publicação (CREATE)

**Status:** Aceito
**Data:** 2026-06-17
**Estende:** [ADR-0016](0016-update-com-reposicao-e-cor-nova.md) (cor nova entra desmarcada no UPDATE — opt-in)

## Contexto

No lote #40 (FITA CETIM PROGRESSO N.5, CREATE, 74 cores) o operador não conseguia
marcar o checkbox da família para publicar. Causa: 2 cores com estoque (`Cereja 2018`,
`Verde Botânico 2017`) estavam **sem foto**. A regra de publicabilidade
(`familiaPublicavel`, ADR de publicação CREATE) exige foto+cor+preço para toda cor
incluída com estoque > 0; faltando a foto, `pub.ok = false` e o checkbox de seleção da
família inteira fica `disabled`. Uma cor sem foto entre 74 travava o anúncio todo.

No **UPDATE** isso já não acontecia: a cor nova (`ml_variation_id` null) nasce
**desmarcada** no ingest (opt-in, ADR-0016), então não bloqueia a família. O **CREATE**
era a lacuna: lá toda variação nascia incluída (`excluida_da_publicacao` default `false`),
independente de ter foto.

Diego pediu: "o que estiver sem foto já tem de vir desmarcado, só avisar" — não travar,
e sinalizar o que ficou de fora.

## Decisão

### 1. Ingest CREATE: cor sem foto nasce desmarcada

No `ingest-lote`, a variação CREATE passa a entrar com
`excluida_da_publicacao = (imagem_path == null)`. Espelha a política do opt-in da cor
nova no UPDATE. Cores com foto continuam incluídas; cores sem foto saem da publicação
por padrão, sem bloquear a família.

### 2. Re-inclusão automática ao ganhar foto

No `upload-imagens-lote`, quando uma cor que **não tinha imagem** recebe foto, ela volta
para a publicação (`excluida_da_publicacao = false`) junto com o `imagem_path`. Botou a
foto = quer publicar. Cor que **já tinha foto** e foi excluída na mão preserva a decisão
do operador (não é re-incluída).

### 3. Aviso na Revisão

Selo na linha da família (CREATE): `📷 N sem foto (fora)`, a partir da função pura
`coresSemFotoExcluidas` (cor excluída, sem foto, estoque > 0). No UPDATE o selo existente
"cores novas" já cobre o mesmo caso, então o novo selo é restrito ao CREATE para não
duplicar a contagem.

## Consequências

- Família com cores sem foto continua publicável (publica o que tem foto); o operador é
  avisado do que ficou de fora e completa depois.
- Estoque 0 já dormia pela regra anterior (não exige foto); o aviso conta só cores com
  estoque, que são as que o operador de fato venderia.
- Fluxo natural de recuperação: subir a foto na Revisão re-inclui a cor sozinho.
- Lotes **já existentes** não passam pelo novo ingest. O lote #40 foi corrigido
  pontualmente (as 2 cores sem foto marcadas como excluídas via SQL) para destravar a
  publicação no mesmo dia.

## Pendências / riscos conhecidos

- Caso raro: cor sem foto excluída manualmente que depois recebe foto será re-incluída
  (não distinguimos "auto-excluída por falta de foto" de "excluída na mão sem foto").
  Aceito como trade-off — evita uma coluna extra de bookkeeping (YAGNI). Se virar
  problema real, adicionar flag dedicada.
