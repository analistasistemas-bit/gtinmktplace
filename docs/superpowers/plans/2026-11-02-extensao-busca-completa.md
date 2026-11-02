# Modo busca completo — plano de implementação

> **Para execução:** usar `superpowers:executing-plans` ou `superpowers:subagent-driven-development`, conforme o método autorizado. Executar uma tarefa por vez, com TDD e commits pequenos.
>
> **Estado:** planejamento concluído; implementação, testes e deploy não executados. Aprovar os números abaixo antes da fatia 2.

**Objetivo:** entregar análise automática da busca, Mini-bloco da busca em cada card, painel com miniaturas, Enriquecimento de catálogo progressivo e Simulação sem vínculo.

**Arquitetura:** o content script observa apenas os cards carregados e desenha Mini-blocos da busca em Shadow DOM fechado. O SW coordena filas, identidade, gerações e estado por aba, independentemente do painel. A edge resolve dados da organização, controla cotas e consulta o ML com cache transitório; cálculos financeiros reutilizam o núcleo existente.

**Stack:** Chrome MV3, TypeScript, React 18, Vite, Vitest/jsdom, Supabase Edge Functions/Deno, PostgreSQL e Redis.

**Fonte da verdade:** [ADR-0189, emenda de 02/11](../../decisions/0189-extensao-publiai-navegador.md), glossário de `CONTEXT.md` e [ADR-0173](../../decisions/0173-fanout-por-org-workers-agendados-cpu.md). As decisões anteriores à emenda não prevalecem sobre ela.

## Números a aprovar pelo Diego

**Todos os valores propostos nesta tabela estão a aprovar. Não são limites oficiais do ML nem resultados já medidos.**

| Controle | Proposta inicial | Justificativa |
|---|---|---|
| Cota de enriquecimento | **20 catálogos/min por usuário e organização**; janela UTC fixa | Uma busca com 25 catálogos atravessa até duas janelas; separa carga automática das 30 análises/min existentes. |
| Teto global por app | **120 chamadas ML/min para o novo enriquecimento**, compartilhadas entre usuários e organizações do mesmo Client ID | Limita a carga adicional. Antes da aprovação, medir consumo dos demais módulos e verificar a folga real do app. |
| Trabalho por requisição | **5 catálogos**, **100 ofertas por catálogo**, **10 itens exatos**, **5 perfis**; até **20 perfis por busca** | Limita parsing, transformação, consultas de comissão e serialização. |
| TTLs de catálogo | `/products`: **6 h**; `/products/items`: **60 s**; `/users`: **24 h** | Metadados mudam menos que ofertas. Cache substitui valores, sem série histórica. |
| TTLs financeiros e espera | Comissão e frete: **6 h**, preservando isolamento financeiro; retomar cotas na próxima janela com dispersão de **0–2 s** | Reaproveita o comportamento financeiro existente e evita retomada simultânea. |

O teto de 120/min é um **orçamento global do novo enriquecimento por app**, incluindo `/products`, `/products/items`, `/users` e comissão solicitada pelo Mini-bloco. Não representa um limitador de todas as chamadas dos outros módulos. Sua aprovação depende da medição dessa carga existente; a documentação do ML informa controle principalmente por Client ID e endpoint. [Referência oficial](https://developers.mercadolivre.com.br/pt_br/usuarios-e-aplicativos/rate-limit-erro-429)

**Critério de CPU proposto:** p95 abaixo de **1.000 ms**, nenhuma amostra acima de **1.500 ms** e nenhum encerramento por CPU. O limite hospedado é de 2 segundos de CPU; duração de rede não mede esse consumo. [Referência oficial](https://supabase.com/kb/troubleshooting/edge-function-cpu-limits)

## Restrições globais

1. **Sessão e ativação:** preservar D-4 vigente, sessão própria, `identidadeEsperada`, época do SW e geração da página. Pausa, logout, troca de usuário/org/suporte ou sessão definitivamente inválida removem Mini-blocos e descartam respostas em voo. Desativada: nenhuma análise, fila ou consulta.
2. **Página do ML:** nunca esconder, ordenar ou mover cards. Ignorar `.avantpro-product-container`, subárvores próprias e cards aninhados. Sem API de busca, PDP oculta, interceptação de tráfego ou novas permissões.
3. **Procedência:** categoria, vendedor e tipo somente da oferta cujo `item_id` corresponde ao card. Desconhecido não vira zero, ausência, “sem medalha” ou “não participa”. Frete e comissão sempre identificados como **“na sua conta”**.
4. **Semântica:** usar os termos do glossário na interface e nos identificadores novos. Volume mínimo ao preço atual é piso × preço observado; nunca chamar esse número de faturamento. SKU vinculado e anúncio próprio são estados independentes.
5. **Execução:** criar worktree dedicada por fatia; preservar as alterações existentes em `CONTEXT.md` e ADR-0189. Preparar `.env.test` e `.env.local` sem imprimir valores. Migrations apenas pela CLI; RLS e consultas com escopo de organização.

## Design premium (obrigatório nas Tasks 4, 5, 10, 13 e nos gates 6, 11, 14)

Pedido do Diego (02/11): o painel atual está "muito sem cor"; usar as cores do PubliAI para dar vida aos painéis. Visual premium, limpo e organizado.

**Skills responsáveis**

| Momento | Skill / revisor | Entrega |
|---|---|---|
| Antes de codar a UI (Tasks 4, 5, 10, 13) | `frontend-design-fable5` (modo sistema: tela dentro de produto existente) | Direção visual: hierarquia do mini-bloco, layout da lista com miniatura, resumo em blocos, estados vazio/aguardando/parcial/erro, claro/escuro |
| Durante | `ui-ux-pro-max-fable5` | Acessibilidade, contraste, densidade e espaçamento no painel estreito (320–600 px) |
| Prova | `playwright-cli` no harness `extensao/qa/` | Prints reais claro/escuro, 320/400/600 px, zoom 150% (screenshot, não só snapshot de acessibilidade) |
| Revisão visual | Codex `gpt-6.1-sol` high com os prints (fallback Gemini 4 Argon High) | Aprovação de UI/UX antes do merge da fatia |

**Paleta de marca na extensão** — trazer de `src/index.css` para `extensao/src/painel/painel.css` (claro e escuro) e para o CSS do Shadow DOM do mini-bloco:

- `--brand-gradient` (roxo 277 → violeta 300): cabeçalho do painel e cabeçalho do resumo da busca; `--brand-glow` nos números de destaque.
- `--brand-gradient-soft`: fundo dos blocos de resumo (sai o cinza chapado).
- `--chart-1..5` com significado fixo: roxo = meu anúncio / minha margem; violeta = catálogo e faixa de vendedores; ciano = Full/frete/logística; âmbar = medalhas e idade do catálogo; rosa = patrocinado/oferta.
- Semânticas: `--success` lucro, `--destructive` prejuízo, `--warning` aguardando/leitura parcial.
- Chips de filtro tingidos pela categoria; miniatura com borda na cor do estado (meu anúncio, vinculado, sem vínculo).
- Mini-bloco no card do ML: filete lateral em `--brand-gradient` para ser reconhecível ao lado do Avant sem poluir o card.
- Contraste ≥ 4,5:1 em texto de 12–13 px (o roxo puro no escuro não passa; usar `--link`). Cor sempre acompanhada de texto. `color-mix` em `oklab`, não `oklch` (bug conhecido puxando para vermelho).

## Regime de revisão

- **Por task:** ao fim de cada Task de código, Codex `gpt-6.1-sol` high revisa o diff da task (read-only, `< /dev/null`); fallback Gemini 4 Argon High via `cursor-agent`. Corrigir antes de seguir; nunca avançar com pendência.
- **Pré-merge da fatia:** Grok 4.7 xhigh revisa o diff completo da fatia (rodada única: corrigiu → teste + CI → merge).
- **UI:** aprovação visual do Codex com prints (seção Design premium).

## Foco da revisão

| Condição | Resultado exigido | Testes responsáveis |
|---|---|---|
| Mesmo item orgânico e patrocinado com preços diferentes | Posições preservadas; margem nunca aplicada ao preço errado | Tasks 1, 3 e 4 |
| Avant modifica o card durante atualização do PubliAI | Sem leitura contaminada ou ciclo de MutationObserver | Tasks 1 e 4 |
| Pausa ou troca de identidade durante requisição | Nenhuma resposta antiga reaparece | Tasks 3 e 10 |
| Catálogo parcial ou oferta exata ausente | Cobertura explícita; nenhum vendedor/tipo emprestado | Tasks 9 e 10 |
| SKU escolhido apenas para simulação | Nenhum vínculo persistido ou contador de vinculados alterado | Tasks 12 e 13 |

## Organização dos arquivos

| Responsabilidade | Arquivos principais |
|---|---|
| Leitura e totais | `extensao/src/leitura/busca.ts`, `compartilhado/busca-resumo.ts`, novo `compartilhado/volume-minimo.ts` |
| Estado e execução automática | `extensao/src/busca-sw.ts`, `roteador.ts`, `abas.ts`, `sw.ts` |
| Mini-bloco e painel | `conteudo/busca.ts`, novo `conteudo/mini-bloco-busca.ts`, `painel/Busca.tsx`, `painel/painel.css` |
| Banco, enriquecimento e cotas | `supabase/functions/extensao/{index,roteamento}.ts`, novos módulos em `_shared/extensao/` |
| Simulação | Novos `_shared/extensao/simulacao-sem-vinculo.ts` e `extensao/src/painel/SimulacaoSemVinculo.tsx` |

---

## Fatia 1 — busca automática e apresentação local — versão 0.4.0

**Entrega publicável:** Mini-bloco com dados observados, reconhecimento de anúncio próprio pelo banco, margem vinculada pelo caminho existente e painel redesenhado.

“Sem chamada nova ao ML” significa: miniatura, identificação própria, volume e sinais locais não consultam o ML. A margem vinculada reutiliza `analisar_busca`, seus endpoints e a cota atual; passa a funcionar automaticamente.

### Task 1 — preservar ocorrências, miniaturas e escopos dos totais

**Arquivos**

- Modificar: `extensao/src/leitura/busca.ts`, `extensao/src/compartilhado/busca-resumo.ts`.
- Criar: `extensao/src/compartilhado/volume-minimo.ts`.
- Testar: `extensao/src/leitura/__tests__/busca.test.ts`, `extensao/src/compartilhado/__tests__/busca-resumo.test.ts`, novo `extensao/src/compartilhado/__tests__/volume-minimo.test.ts`.

**Interfaces**

```ts
interface OcorrenciaBusca {
  posicao: number | null;
  patrocinado: boolean;
  preco: number | null;
}

interface CardBusca {
  // Campos atuais preservados.
  miniaturaUrl: string | null;
  ocorrencias: OcorrenciaBusca[];
}

function volumeMinimoAoPrecoAtual(
  vendidosTexto: string | null,
  preco: number | null,
): number | null; // centavos
```

- [ ] **1. RED:** cobrir imagem do ML versus imagem dentro do Avant, URL inválida, imagem ausente, item repetido com duas posições/preços e campos que aparecem depois. Fixar:
  ```ts
  expect(volumeMinimoAoPrecoAtual('+100 vendidos', 19.9)).toBe(199000);
  expect(volumeMinimoAoPrecoAtual(null, 19.9)).toBeNull();
  expect(volumeMinimoAoPrecoAtual('+100 vendidos', null)).toBeNull();
  ```
- [ ] **2. Executar e confirmar falha:**
  `rtk pnpm --dir extensao test -- src/leitura/__tests__/busca.test.ts src/compartilhado/__tests__/busca-resumo.test.ts src/compartilhado/__tests__/volume-minimo.test.ts`.
- [ ] **0. Medir antes (lazy loading):** salvar o HTML real de uma busca (topo e após scroll) como fixture sintética em `extensao/src/leitura/__fixtures__/busca-*.html`, anotando em que atributo a imagem real chega nos cards abaixo da dobra (`src` provisório/`data:`, `data-src`, `srcset`). Nenhum teste atual cobre imagem de card.
- [ ] **3. Implementar:** ler a imagem real do próprio card (`currentSrc || src`, e `data-src`/`srcset` conforme o passo 0; `data:` e placeholder = sem miniatura); quando a imagem real chegar depois, o MutationObserver (atributos `src`/`srcset` do `<img>` do card) atualiza só a miniatura; aceitar apenas HTTPS em domínio de imagens ML observado e validado, sem credenciais. Preservar ocorrências sem transformar o preço de uma ocorrência no preço de outra. O `<img>` do painel reutiliza essa URL, sem fetch, proxy ou consulta de resolução.
- [ ] **4. GREEN:** repetir o comando. Totais usam chave canônica com precedência **catálogo → `/up/` → anúncio**, propagando associações apenas quando comprovadas pelos mesmos itens. Conflito entre identidades exclui o grupo da soma e aparece na cobertura. Por grupo, somar o piso uma vez; para volume, escolher a menor contribuição completa observada, sem combinar piso de um card com preço de outro.
- [ ] **5. Commit:** `rtk git commit -m "feat(extensao): preservar ocorrencias e volume minimo da busca"`.

**Aceite:** contagens distinguem ocorrências, anúncios únicos e grupos de vendas. Sinais Full/oficial/patrocinado contam anúncios; totais de vendidos e volume contam grupos deduplicados, com denominador próprio.

### Task 2 — separar vínculo de anúncio próprio usando somente o banco

**Arquivos**

- Criar: `supabase/functions/_shared/extensao/busca-local.ts`.
- Modificar: `supabase/functions/extensao/index.ts`, `supabase/functions/extensao/roteamento.ts`.
- Testar: novo `supabase/functions/_shared/extensao/__tests__/busca-local.test.ts`, `supabase/functions/extensao/__tests__/index.test.ts`, `supabase/functions/extensao/__tests__/roteamento.test.ts`.

**Interfaces**

```ts
interface MetadadosCardBusca {
  itemId: string;
  proprio: boolean | null; // null = verificação indisponível
  vinculo: { fonte: FonteCusto; codigo: string } | null;
}

type PedidoIdentificarBusca = {
  acao: 'identificar_busca';
  eanDaBusca: string | null;
  itens: { itemId: string; catalogProductId: string | null }[];
};
```

- [ ] **1. RED:** SKU vinculado sem anúncio próprio; anúncio próprio sem SKU vinculado; item de outra org; erro em uma fonte; card sem preço. Asserções obrigatórias: zero chamadas ML, zero renovação OAuth e zero débito de margem.
- [ ] **2. Executar:** `rtk pnpm test -- supabase/functions/_shared/extensao/__tests__/busca-local.test.ts supabase/functions/extensao/__tests__/index.test.ts supabase/functions/extensao/__tests__/roteamento.test.ts`; confirmar falha.
- [ ] **3. Implementar:** reutilizar `casarCards` para vínculos e consultar somente os IDs pedidos nas sete fontes já documentadas em `varrer-anuncios-orfaos/index.ts`: `familias.ml_item_id`, `anuncios_externos.item_externo_id`, `anuncios_externos_itens.item_externo_id`, `kits_virtuais.ml_item_id`, os dois `catalog_listing_id` e `anuncios_externos.ml_item_id_anterior`. Aplicar `org_id` explícito; na fonte legada, também o escopo da família. Não executar a varredura ML nem carregar o inventário inteiro.
- [ ] **4. GREEN:** repetir os testes. Falha de consulta retorna verificação indisponível, nunca `proprio:false` conclusivo. Aceitar até 50 itens deduplicados; manter respostas legadas de `analisar_busca` intactas.
- [ ] **5. Commit:** `rtk git commit -m "feat(extensao): identificar anuncios proprios na busca pelo banco"`.

### Task 3 — executar automaticamente com isolamento de sessão e página

**Arquivos**

- Modificar: `extensao/src/busca-sw.ts`, `extensao/src/roteador.ts`, `extensao/src/abas.ts`, `extensao/src/sw.ts`.
- Testar: novo `extensao/src/__tests__/busca-sw.test.ts`, `extensao/src/__tests__/roteador.test.ts`, `extensao/src/__tests__/sessao.test.ts`.

**Interfaces**

Adicionar `metadados: Record<string, MetadadosCardBusca>` à resposta de `EstadoBusca`, mantendo `resultados` financeiro separado.

```ts
function processarBuscaDaAba(tabId: number, epoca: number): Promise<void>;
function cancelarBuscaDaAba(tabId: number): void;
```

- [ ] **1. RED:** registrar 60 itens com painel fechado processa identificação em lotes 50+10; margem só dos vinculados elegíveis. Abrir painel durante processamento não duplica chamadas. Testar navegação, preço alterado, pausa, suporte expirado, logout e reinício do SW.
- [ ] **2. Executar:** `rtk pnpm --dir extensao test -- src/__tests__/busca-sw.test.ts src/__tests__/roteador.test.ts src/__tests__/sessao.test.ts`; confirmar falha.
- [ ] **3. Implementar:** registrar cards → identificar no banco → analisar margens elegíveis pelo caminho existente. Reutilizar filas de escrita/análise; o painel passa a consumir estado. Validar época capturada antes do primeiro `await`, identidade, geração da página, URL e assinatura do item antes de chamar, gravar ou transmitir. Levar a geração às mensagens de cards/resultados.
- [ ] **4. GREEN:** repetir testes. Limite financeiro mantém “Minha margem aguardando cota” **também no Mini-bloco**; a próxima janela retoma sem painel aberto. **Telemetria:** `extensao_registrar_uso` tipo `busca` registra uma vez por geração de página (URL de busca nova), nunca a cada lote do scroll ou retomada de cota — teste: 60 cards em 3 lotes + retomada = 1 registro. O content script fornece o pulso de retomada, pois MV3 não garante timers longos no SW. Pausa ou fechamento cancela a fila; nova mensagem após reinício reconstrói o processamento.
- [ ] **5. Commit:** `rtk git commit -m "feat(extensao): analisar busca automaticamente com geracoes"`.

**Regra de invalidação:** mudança só da miniatura atualiza apresentação; mudança de preço invalida margem; mudança de catálogo invalida vínculo e dependências. Resposta de uma ocorrência nunca confirma margem em outra com preço diferente.

### Task 4 — substituir o selo isolado pelo Mini-bloco da busca

**Arquivos**

- Criar: `extensao/src/conteudo/mini-bloco-busca.ts`.
- Modificar: `extensao/src/conteudo/busca.ts`, `extensao/src/conteudo/selo-busca.ts`.
- Testar: novo `extensao/src/conteudo/__tests__/mini-bloco-busca.test.ts`, `extensao/src/conteudo/__tests__/busca-conteudo.test.ts`, `extensao/src/conteudo/__tests__/busca-boot.test.ts`.

**Interface**

```ts
function renderizarMiniBlocoDaBusca(
  card: CardBusca,
  metadados: MetadadosCardBusca | undefined,
  margem: ResultadoCard | undefined,
): HTMLElement;
```

- [ ] **1. RED:** card sem vínculo recebe bloco local; margem só aparece quando `margem.preco` coincide com o preço da ocorrência. Capturar `attachShadow` no teste e exigir `mode:'closed'`. Testar reuso do nó pelo ML, remoção do host, mutação Avant, mutação própria e sessão alterada.
- [ ] **2. Executar:** `rtk pnpm --dir extensao test -- src/conteudo/__tests__/mini-bloco-busca.test.ts src/conteudo/__tests__/busca-conteudo.test.ts src/conteudo/__tests__/busca-boot.test.ts`; confirmar falha.
- [ ] **3. Implementar:** host `.publiai-mini-bloco-busca`, inserção segura após o preço, texto dinâmico via `textContent`. Mostrar vendedor observado, sinais explícitos, **“Volume mínimo ao preço atual”**, **“Meu anúncio · posição X · orgânico/patrocinado”** e **“Minha margem · simulação Clássico”**, quando disponíveis. Posição ausente permanece “posição não informada”.
- [ ] **4. GREEN:** atualização idempotente por host/assinatura; nunca remover e reconstruir todos os blocos a cada mutação. Ignorar mutações dentro do Avant ou dos hosts PubliAI, inclusive `characterData`; observar alterações úteis de preço, imagem e link. Ignorar também essas subárvores no parser e na contagem de ocorrências.
- [ ] **5. Commit:** `rtk git commit -m "feat(extensao): mostrar mini bloco local nos cards da busca"`.

**Aceite visual:** até quatro linhas compactas nesta fatia, quebra de texto permitida, sem cobrir preço, foto ou links. Encaixe inseguro mantém o painel disponível. Shadow DOM isola estilos; não é garantia absoluta de sigilo.

### Task 5 — redesenhar o painel com miniaturas e cobertura

**Arquivos**

- Modificar: `extensao/src/painel/Busca.tsx`, `extensao/src/painel/painel.css`, `extensao/src/painel/App.tsx`, `extensao/src/compartilhado/busca-resumo.ts`.
- Testar: `extensao/src/painel/__tests__/Busca.test.tsx`, `extensao/src/painel/__tests__/App.test.tsx`, `extensao/src/compartilhado/__tests__/busca-resumo.test.ts`.

- [ ] **1. RED:** renderizar miniatura/fallback, anúncio próprio e SKU vinculado independentes, zero versus desconhecido, cobertura parcial e ausência de análise duplicada ao montar o painel.
- [ ] **2. Executar:** `rtk pnpm --dir extensao test -- src/painel/__tests__/Busca.test.tsx src/painel/__tests__/App.test.tsx src/compartilhado/__tests__/busca-resumo.test.ts`; confirmar falha.
- [ ] **3. Implementar:** resumo nesta ordem: quantidade lida e cobertura → “Meus anúncios”/“SKUs vinculados” → faixa de preço → pisos e Volume mínimo ao preço atual. Cada linha usa miniatura de 56 px, título, preço, margem e sinais; composição financeira fica em detalhes. Remover o efeito que dispara análise na montagem.
- [ ] **4. GREEN:** filtros distintos `meus` e `vinculados`; ordenações afetam só a lista PubliAI. Manter paginação de 15 linhas, destaque do card e vínculo explícito. Imagem com dimensões reservadas, `loading="lazy"`, `referrerPolicy="no-referrer"` e fallback no erro. Usar tokens/Geist existentes, foco visível e controles próprios da extensão.
- [ ] **5. Commit:** `rtk git commit -m "feat(extensao): redesenhar painel de busca com miniaturas"`.

**Aceite:** sem overflow a 320 px, 400 px ou zoom de 150%; margem e preço identificáveis sem abrir detalhes; texto completo acessível por expansão.

### Task 6 — validar e publicar a fatia 1

**Arquivos**

- Modificar: `extensao/manifest.json`, `extensao/package.json` → **0.4.0**; `docs/TASKS.md`, `docs/project-status.md`.
- Criar: `extensao/qa/busca.html`, `extensao/qa/busca.tsx`, `extensao/qa/busca-fixtures.ts`.
- Testar: `extensao/src/__tests__/checar-dist.test.ts`; evidências visuais fora do pacote publicado.

- [ ] **1. Preparar prova reproduzível:** harness monta o componente `Busca` real e os Mini-blocos reais com dados fictícios, imagens locais e respostas controladas; nenhum token. Incluir imagem quebrada, título longo, margem negativa, 68 ocorrências e duplicatas. O build de produção não inclui `qa/`.
- [ ] **2. Validar visualmente** (ver "Design premium"): iniciar `rtk pnpm --dir extensao exec vite --host 127.0.0.1 --port 5174`; abrir com `rtk playwright-cli -s=publiai-busca-f1 open http://127.0.0.1:5174/qa/busca.html`. Capturar claro/escuro, 320/400/600 px e zoom 150%. Corrigir em um lote e confirmar uma vez. Fazer smoke real com `build:dev`, extensão carregada em perfil isolado, painel fechado, scroll, Avant, pausa e religamento.
- [ ] **3. Verificar e revisar:** executar o pacote de verificação abaixo; revisão final do diff da fatia pelo Grok 4.7 xhigh cobrindo os cinco focos deste plano (as tasks já passaram pela revisão do Codex). Corrigir achados bloqueantes antes do commit de release.
- [ ] **4. Integrar e deployar:** CI `frontend` e `backend-lint` verdes no SHA final → merge fast-forward e push da `main` → `rtk supabase functions deploy extensao --project-ref txvncrgkoynoxwopfkbp`. Conferir versão ACTIVE e compatibilidade com 0.3.2. Esta fatia não tem migration.
- [ ] **5. Publicar:** build de produção, ZIP do conteúdo de `extensao/dist` como `extensao/publiai-extensao-0.4.0.zip`, `unzip -t`, atualização do mesmo item na Web Store e smoke após distribuição. Registrar SHA, edge, ZIP e evidências em `docs/TASKS.md`.

---

## Fatia 2 — enriquecimento progressivo e cota híbrida — versão 0.5.0

**Entrega publicável:** Mini-bloco completo e resumo de vendedores, medalhas, UF, tipo e faixas de vendedores por catálogo.

### Task 7 — medir fontes, custo e CPU antes do código funcional

**Arquivos**

- Criar: `docs/spikes/2026-11-02-extensao-busca-medicoes.md`.
- Atualizar após aprovação: seção de números deste plano e emenda do ADR-0189.

- [ ] **1. Medir contratos:** selecionar catálogos com 0, poucos, 100 e mais de 100 resultados. Confirmar `paging.total`, duplicidade de vendedor, `category_id`, `listing_type_id`, `date_created` e casamento do item exato. Em `/users`, verificar `power_seller_status`, `level_id` e `address.state`, incluindo campos ausentes. Usar apenas GETs autorizados; não persistir respostas de concorrentes no repositório.
- [ ] **2. Medir baseline:** obter `cpu_time_used` de pelo menos dez análises atuais de catálogo, separando cache frio/quente e tamanho da ficha. Registrar chamadas ML e bytes. A CPU do lote novo será medida novamente na Task 11; não extrapolar linearmente esse baseline.
- [ ] **3. Medir folga do app:** consumo e 429 dos demais módulos durante uma janela normal e uma de pico. Comparar com o orçamento adicional de 120/min; não assumir uma cota oficial universal.
- [ ] **4. Fechar valores:** Diego aprova cota, teto, lote e TTLs com esse relatório. Se 5 catálogos não couberem no orçamento de CPU projetado, propor 3 ou 1 e registrar a alteração antes de implementar.
- [ ] **5. Commit:** `rtk git commit -m "docs(extensao): registrar medicoes e limites aprovados da busca"`.

**Pontos de atenção:** o normalizador atual de perfil exige `transactions.total`; isso pode descartar medalha/UF válidas. Ausência de `power_seller_status` também não prova “sem medalha”. A documentação é referência de contrato; a medição confirma o payload acessível à conta. [Consulta oficial de usuários](https://developers.mercadolivre.com.br/pt_br/servico-consulta-de-usuarios)

### Task 8 — cotas separadas no Redis (sem migration)

> Revisão 02/11: a cota atual de 30/min já é contador atômico no Redis (`redisIncrComTTL(chaveLimite(...), 120)` em `supabase/functions/extensao/index.ts`). As novas cotas seguem o mesmo mecanismo — sem tabela, sem trava de linha por chamada ML e sem teste em Supabase local (Docker não sobe nesta máquina).

**Arquivos**

- Criar: `supabase/functions/_shared/extensao/cotas-busca.ts`.
- Modificar: `supabase/functions/extensao/index.ts` (usar as funções novas).
- Testar: novo `supabase/functions/_shared/extensao/__tests__/cotas-busca.test.ts` (Redis falso em memória, como os testes atuais da edge).

**Interfaces**

```ts
// Chaves com janela de minuto UTC, TTL 120 s (mesmo padrão de chaveLimite).
function chaveEnriquecimento(orgId: string, userId: string, agora: Date): string; // ext:enr:{org}:{user}:{yyyymmddhhmm}
function chaveOrcamentoMl(agora: Date): string;                                   // ext:mlapp:{yyyymmddhhmm}
/** Reserva até `quantidade` catálogos na ordem pedida; devolve quantos couberam e quando retomar. */
function reservarEnriquecimento(orgId: string, userId: string, quantidade: number, agora: Date): Promise<{ permitidos: number; retomarEm: string | null }>;
/** 1 unidade antes de cada chamada ML real do enriquecimento (inclui listing_prices). */
function reservarChamadaMl(agora: Date): Promise<boolean>;
```

- [ ] **1. RED:** 20/min por usuário+org (débito também em cache); pedido de 25 concede 20 e devolve `retomarEm` = início do próximo minuto; usuários/orgs independentes; teto global compartilhado; INCR além do teto devolve o excedente (DECRBY) para não inflar a janela; **erro de Redis no orçamento global bloqueia a chamada ML** (fail-closed) e devolve espera — diferente do cache, que é fail-open.
- [ ] **2. Executar:** `rtk pnpm test -- supabase/functions/_shared/extensao/__tests__/cotas-busca.test.ts`; confirmar falha.
- [ ] **3. Implementar:** `INCRBY` da quantidade pedida + TTL; se passar do teto, `DECRBY` do excedente e conceder só o restante. Reutilizar o cliente `_shared/redis/client.ts`; acrescentar `redisIncrBy`/`redisDecrBy` se não existirem (com teste). Sem dados de tenant na chave global.
- [ ] **4. GREEN:** repetir testes + `rtk deno lint --config supabase/functions/deno.json`.
- [ ] **5. Commit:** `rtk git commit -m "feat(extensao): cotas de enriquecimento e orcamento ML no Redis"`.

**Preservação obrigatória:** as 30/min de margem continuam intactas (`chaveLimite`); `extensao_registrar_uso` continua só telemetria. Esta fatia passa a **não ter migration**.

### Task 9 — enriquecer somente catálogos e ofertas comprovados

**Arquivos**

- Criar: `supabase/functions/_shared/extensao/enriquecimento-busca.ts`, `supabase/functions/_shared/extensao/enriquecimento-busca-io.ts`.
- Modificar: `supabase/functions/extensao/index.ts`, `supabase/functions/extensao/roteamento.ts`.
- Testar: novos `supabase/functions/_shared/extensao/__tests__/enriquecimento-busca.test.ts`, `enriquecimento-busca-io.test.ts`; testes HTTP existentes da edge.

**Interfaces**

```ts
type PedidoEnriquecimento = {
  acao: 'enriquecer_catalogos_busca';
  catalogos: {
    catalogProductId: string;
    itens: { itemId: string; preco: number }[];
  }[];
};

interface OfertaEnriquecidaBusca {
  itemId: string;
  categoriaId: string | null;
  sellerId: number | null;
  tipo: 'gold_special' | 'gold_pro' | null;
  vendedor: {
    nome: string | null;
    medalha: 'silver' | 'gold' | 'platinum' | 'sem' | null;
    uf: string | null;
  } | null;
  comissaoNaSuaConta: Disponivel<ComissaoML>;
}
```

A resposta por catálogo informa `estado`, `consultadoEm`, `expiraEm`, criação, vendedores identificados, completude, ofertas exatas e `retomarEm` quando houver espera.

- [ ] **1. RED:** cache frio/quente, débito por catálogo nos dois casos, ficha parcial, `paging` ausente, dois itens do mesmo vendedor, vendedor sem transações, oferta exata ausente, 403/429/timeout e teto global concorrente. Catálogo duplicado no mesmo pedido debita uma vez; nova requisição debita novamente.
- [ ] **2. Executar:** `rtk pnpm test -- supabase/functions/_shared/extensao/__tests__/enriquecimento-busca.test.ts supabase/functions/_shared/extensao/__tests__/enriquecimento-busca-io.test.ts supabase/functions/extensao/__tests__/index.test.ts supabase/functions/extensao/__tests__/roteamento.test.ts`; confirmar falha.
- [ ] **3. Implementar:** validar limites antes do processamento; autenticação, módulo e identidade antes da reserva. Reservar catálogo **antes de consultar cache**. Consultar P/O; contar vendedores únicos, não ofertas. Buscar perfis somente dos vendedores dos itens exatos pedidos. Antes de cada chamada ML real, inclusive comissão, `reservarChamadaMl` (Task 8). **Comissão só para o par categoria/preço/tipo das ofertas exatas pedidas, dentro da mesma unidade do catálogo** (não debita à parte); com o orçamento global esgotado, a comissão fica "aguardando" e o restante do catálogo é entregue. Novo adaptador faz uma tentativa, sem retry oculto.
- [ ] **4. GREEN:** caches projetados e versionados por org/conexão/conta/catálogo; perfil pode reutilizar o cache público validado existente. Reutilizar `normalizarPerfilVendedor`, `validarPerfilVendedor`, `dataDoProduto` e `comissaoDaListingPrice`; complementar parsing parcial de medalha/UF no módulo novo, sem alterar o comportamento compartilhado de Pulse. Comissão usa categoria exata, preço do card e tipo confirmado, com chave financeira incluindo org e conta.
- [ ] **5. Commit:** `rtk git commit -m "feat(extensao): enriquecer catalogos da busca com cobertura"`.

**Regras do resultado**

1. `paging.total` conta ofertas, não vendedores; leitura parcial mostra **“≥ N vendedores identificados”**.
2. Perfil não carregado, medalha ausente e tipo desconhecido permanecem desconhecidos. Status explícito nulo de medalha pode ser “sem medalha”; status não reconhecido não.
3. Oferta exata ausente impede atribuir vendedor, categoria, tipo e comissão; os metadados comprovados do catálogo continuam utilizáveis.
4. Sem frete em lote, preço para ganhar ou vencedor inferido. Comissão nova exige `listing_prices`; esse custo adicional entra na medição e no teto global.
5. Cache de ofertas da busca atual, que guarda apenas item/categoria por 10 minutos, não serve para esse DTO. Compartilhar a nova projeção de 60 s com a busca financeira evita consultar a mesma ficha duas vezes.

### Task 10 — integrar fila progressiva, Mini-bloco completo e resumo

**Arquivos**

- Modificar: `extensao/src/busca-sw.ts`, `extensao/src/roteador.ts`, `extensao/src/conteudo/busca.ts`, `extensao/src/conteudo/mini-bloco-busca.ts`.
- Modificar: `extensao/src/compartilhado/busca-resumo.ts`, `extensao/src/painel/Busca.tsx`, `extensao/src/painel/painel.css`.
- Testar: `extensao/src/__tests__/busca-sw.test.ts`, `extensao/src/conteudo/__tests__/mini-bloco-busca.test.ts`, `extensao/src/compartilhado/__tests__/busca-resumo.test.ts`, `extensao/src/painel/__tests__/Busca.test.tsx`.

- [ ] **1. RED:** dez cards do mesmo catálogo geram uma entrada de fila; scroll e painel simultâneos não duplicam. Testar janela esgotada, perfis limitados, resposta antiga após pausa e retomada após reinício do SW. Confirmar semáforo nos limites 180/181/365/366 dias.
- [ ] **2. Executar:** `rtk pnpm --dir extensao test -- src/__tests__/busca-sw.test.ts src/conteudo/__tests__/mini-bloco-busca.test.ts src/compartilhado/__tests__/busca-resumo.test.ts src/painel/__tests__/Busca.test.tsx`; confirmar falha.
- [ ] **3. Implementar:** fila deduplicada por catálogo, com prioridade para anúncios próprios/vinculados e depois ordem observada. Um lote de enriquecimento em voo por aba; cota no servidor protege abas concorrentes. Persistir pendências e `retomarEm` no estado de sessão. Pulso do content script retoma a janela; cache expirado não provoca refresh infinito da busca parada.
- [ ] **4. GREEN:** Mini-bloco acrescenta vendedor/medalha/UF, tipo, **“Comissão na sua conta”**, vendedores e idade do catálogo. Resumo por medalha/UF usa vendedores únicos dos cards identificados; tipo usa anúncios com oferta exata; faixas 1–5/6–10/11–30/>30 usam catálogos únicos completos. Parciais e desconhecidos ficam separados, com denominadores.
- [ ] **5. Commit:** `rtk git commit -m "feat(extensao): completar mini blocos e resumo progressivo"`.

**Estados visíveis:** “Aguardando enriquecimento”, “Aguardando próxima janela”, “Oferta não localizada nesta leitura”, “Perfil não carregado” e “Leitura parcial”. Falha de rede para a rodada deixa ação “Tentar novamente”; não repete indefinidamente.

**Idade:** calcular somente dias e semáforo do catálogo; não reutilizar os cálculos de ritmo de `quantoVende`. Data futura/inválida fica indisponível. Cor sempre acompanhada de texto.

### Task 11 — medir o lote e publicar a fatia 2

**Arquivos**

- Modificar: `extensao/manifest.json`, `extensao/package.json` → **0.5.0**; `extensao/qa/busca-fixtures.ts`.
- Atualizar: `docs/TASKS.md`, `docs/project-status.md`, relatório da Task 7 e ADR-0189 com os números aprovados.

- [ ] **1. Ampliar prova:** fixtures com catálogo parcial, oferta ausente, vendedor repetido, UF/medalha desconhecidos, comissão indisponível e espera de cota. Executar testes da Task 10 e o pacote de verificação.
- [ ] **2. Validar visual e segurança:** repetir harness/Playwright e smoke real da Task 6; testar duas abas, painel fechado e troca de suporte em voo. Conferir que título, miniatura e lista observada não são enviados à telemetria.
- [ ] **3. Medir hospedado:** em ambiente de validação, medir lotes de 1/3/5 catálogos, cache frio/quente e fichas de 100 ofertas; pelo menos dez amostras por tamanho/estado. Correlacionar identificador técnico de execução com `cpu_time_used`; logs contêm apenas contagens, bytes, cache e duração, sem payload de concorrente. Exigir os critérios de CPU do cabeçalho; reduzir lote e registrar nova aprovação se necessário.
- [ ] **4. Revisar e integrar:** revisão final do diff da fatia pelo Grok 4.7 xhigh (pré-merge) → CI verde no SHA final → merge/push → `rtk supabase functions deploy extensao --project-ref txvncrgkoynoxwopfkbp` (fatia sem migration). Confirmar edge ACTIVE e clientes 0.3.2/0.4.0 compatíveis.
- [ ] **5. Publicar:** build, ZIP `publiai-extensao-0.5.0.zip`, teste do ZIP, revisão das declarações de privacidade e envio à Web Store. Registrar resultados reais de CPU, chamadas, cotas e cobertura.

**Gate:** a 0.5.0 só é distribuída após edge e medição aprovadas. Falha operacional desliga o enriquecimento no servidor; leitura local e margem existente continuam disponíveis.

---

## Fatia 3 — Simulação sem vínculo — versão 0.6.0

**Entrega publicável:** escolher SKU apenas para calcular ou informar custo do pacote e origem, sem salvar vínculo.

### Task 12 — confirmar simulação pela edge sem persistência de vínculo

**Arquivos**

- Criar: `supabase/functions/_shared/extensao/simulacao-sem-vinculo.ts`.
- Modificar: `supabase/functions/extensao/index.ts`, `supabase/functions/extensao/roteamento.ts`.
- Testar: novo `supabase/functions/_shared/extensao/__tests__/simulacao-sem-vinculo.test.ts`, testes HTTP e validação existentes.

**Contrato**

```ts
type FonteSimulacaoSemVinculo =
  | { tipo: 'custo_pacote'; custoPacote: number; origem: 'nacional' | 'importado' }
  | {
      tipo: 'sku';
      variacaoId: string;
      unidadesAnuncio: number | null;
      unidadesSku: number | null;
    };

interface PedidoSimulacaoSemVinculo {
  acao: 'simular_sem_vinculo';
  itemId: string;
  catalogProductId: string;
  preco: number;
  fonte: FonteSimulacaoSemVinculo;
}
```

- [ ] **1. RED:** origem ausente, custo inválido, SKU de outra org, composição desconhecida/não inteira, alíquota não confirmada, categoria sem prova e mudança de identidade. Exigir zero inserts/upserts/deletes em `extensao_vinculos`; confirmação financeira válida consome exatamente uma unidade da cota atual de 30/min.
- [ ] **2. Executar:** `rtk pnpm test -- supabase/functions/_shared/extensao/__tests__/simulacao-sem-vinculo.test.ts supabase/functions/extensao/__tests__/index.test.ts supabase/functions/extensao/__tests__/roteamento.test.ts`; confirmar falha.
- [ ] **3. Implementar:** categoria somente da oferta exata no cache válido do enriquecimento; sem prova, retornar `aguardando_enriquecimento`, sem débito financeiro. Fora de catálogo permanece indisponível. SKU é relido com `org_id`; custo, origem, unidades e dimensões não vêm confiados do navegador. Não chamar `resolverVinculo` para substituir a fonte escolhida.
- [ ] **4. GREEN:** reutilizar `calcularMinhaMargem`, `fatorDoPacote`, `custoDoPacote`, alíquotas e dependências financeiras existentes. Identidade comprovada de catálogo permite fator 1; demais casos exigem composição. Custo manual refere-se ao pacote inteiro; frete usa pacote padrão rotulado. SKU com fator 1 e dimensões confirmadas pode usar frete oficial; demais situações preservam os rótulos atuais.
- [ ] **5. Commit:** `rtk git commit -m "feat(extensao): confirmar simulacao sem vinculo na busca"`.

**Resposta:** tipo próprio de simulação, com fonte escolhida, composição, margem e parâmetros financeiros. Não representar SKU escolhido como `vinculo_manual`. A ação usa a cota financeira existente inclusive com cache; recálculo local não consome cota.

### Task 13 — oferecer simulação no painel com estado efêmero

**Arquivos**

- Criar: `extensao/src/painel/SimulacaoSemVinculo.tsx`, `extensao/src/painel/TiposMargem.tsx`.
- Modificar: `extensao/src/painel/Busca.tsx`, `extensao/src/painel/MinhaMargem.tsx`, `extensao/src/painel/painel.css`.
- Testar: novo `extensao/src/painel/__tests__/SimulacaoSemVinculo.test.tsx`, `extensao/src/painel/__tests__/Busca.test.tsx`, `extensao/src/painel/__tests__/MinhaMargem.test.tsx`.

- [ ] **1. RED:** clicar “Simular sem vínculo” não salva; origem começa vazia; SKU escolhido não altera contagem de vinculados; voltar à mesma linha preserva a conta dentro da busca. Sair da busca, fechar painel ou trocar sessão descarta o estado. Resposta de preço/fonte anterior não substitui a atual.
- [ ] **2. Executar:** `rtk pnpm --dir extensao test -- src/painel/__tests__/SimulacaoSemVinculo.test.tsx src/painel/__tests__/Busca.test.tsx src/painel/__tests__/MinhaMargem.test.tsx`; confirmar falha.
- [ ] **3. Implementar:** ação distinta de “Vincular”. Alternativas “Informar custo do pacote” e “Escolher SKU para esta simulação”; buscar SKU pelo `buscar_sku` atual. Usar controles próprios da extensão. Extrair apenas a apresentação Clássico/Premium para `TiposMargem.tsx`, preservando o comportamento da PDP.
- [ ] **4. GREEN:** estado somente em React, pertencente à instância da busca, sem `storage`, mapa global ou persistência no banco. Mostrar composição e “Comissão na sua conta”/“Frete na sua conta”. Recálculo local é imediato; confirmar após 1.500 ms de edição válida. Até confirmação, todo resultado usa “Estimativa”; falha preserva esse rótulo. Comparar sequência, item, preço, fonte e contexto antes de aceitar resposta.
- [ ] **5. Commit:** `rtk git commit -m "feat(extensao): oferecer simulacao sem vinculo no painel"`.

**Aceite:** simulação não publica margem nos Mini-blocos, não transforma o produto em vinculado e não grava automaticamente. “Vincular” continua sendo uma ação explícita separada.

### Task 14 — validar e publicar a fatia 3

**Arquivos**

- Modificar: `extensao/manifest.json`, `extensao/package.json` → **0.6.0**; `extensao/qa/busca-fixtures.ts`.
- Atualizar: `docs/TASKS.md`, `docs/project-status.md`; ADR-0189 somente se limites aprovados mudarem.

- [ ] **1. Ampliar prova:** custo manual, SKU com composição confirmada, unidades ausentes, frete estimado, margem negativa, confirmação falha e limite financeiro. Executar testes da Task 13 e pacote de verificação.
- [ ] **2. Validar visualmente:** repetir Playwright/harness em claro/escuro, 320/400/600 px e zoom 150%. Smoke com troca rápida de produto, preço, aba e identidade; demonstrar que simular não grava vínculo.
- [ ] **3. Revisar:** Grok 4.7 xhigh revisa o diff final da fatia (tasks já revisadas pelo Codex): arredondamento em centavos, composição, procedência financeira e ausência de persistência. Corrigir bloqueios e obter CI verde no SHA final.
- [ ] **4. Integrar e deployar:** merge/push da `main` → `rtk supabase functions deploy extensao --project-ref txvncrgkoynoxwopfkbp`; conferir ACTIVE e smoke das versões anteriores. Esta fatia não cria migration.
- [ ] **5. Publicar:** build de produção, ZIP `publiai-extensao-0.6.0.zip`, teste do ZIP, Web Store e registro final das evidências em `docs/TASKS.md`.

---

## Verificação e publicação comuns às três fatias

Executar a partir da worktree da fatia. Os comandos focados de cada Task são o ciclo RED/GREEN; os comandos abaixo são o gate final exigido.

```bash
rtk pnpm --dir extensao test
rtk pnpm test -- supabase/functions/_shared/extensao supabase/functions/extensao
rtk pnpm --dir extensao build
rtk deno lint --config supabase/functions/deno.json
rtk pnpm preflight:static
```

1. **Ambiente:** conferir existência das variáveis locais sem exibir valores. Se abrir página branca, inspecionar console antes de alterar código.
2. **Revisão:** comparar o diff com a emenda vigente; conferir compatibilidade de protocolo, permissões, ausência de segredos e regressões de PDP/catálogo.
3. **CI e merge:** push da branch, `frontend` e `backend-lint` verdes no SHA final, integração fast-forward. Mudança do SHA exige novos checks; nunca contornar check vermelho.
4. **Backend:** CI não publica Supabase. Aplicar migrations antes da edge que depende delas. Os módulos novos deste plano são exclusivos de `extensao`; se a implementação alterar helpers compartilhados adicionais, levantar imports transitivos e deployar todas as edges afetadas pela CLI.
5. **Pacote:** após o build de produção, dentro de `extensao/dist`, executar `rtk zip -qr ../publiai-extensao-0.4.0.zip .` na fatia 1; usar `0.5.0` e `0.6.0` nas seguintes. Validar com `rtk unzip -t` no ZIP correspondente. `manifest.json` deve estar na raiz; `qa/`, localhost e arquivos de ambiente ficam fora.

## Riscos que bloqueiam publicação

| Risco | Evidência exigida |
|---|---|
| CPU excedida por parsing/serialização | Medição hospedada da Task 11; reduzir lote por contagem, não apenas concorrência ou timeout |
| Medalha/UF ausentes ou payload diferente | Medição da Task 7 e estados desconhecidos preservados |
| Duplicação entre catálogo, `/up/` e anúncio | Fixtures com associações válidas e conflitantes; cobertura dos grupos excluídos |
| Resposta financeira aplicada ao contexto errado | Testes de geração, identidade, preço e fonte, incluindo pausa em voo |
| Carga adicional interfere no app | Consumo dos demais módulos medido, orçamento aprovado e retomada de cota comprovada |

**Próxima ação — até 2 minutos:** Diego revisar a tabela “Números a aprovar”; a aprovação definitiva da fatia 2 ocorre após as medições da Task 7.