// ADR-0078 F1: resolve a escolha "somente estoque" por família. `global` é a opção da
// operação; `overrides` são os familia_ids que INVERTEM o global (o operador marcou/desmarcou
// aquela família em particular). Puro e idempotente — usado no enqueue de update.
export function resolverSomenteEstoque(familiaId: string, global: boolean, overrides: string[] = []): boolean {
  return overrides.includes(familiaId) ? !global : global;
}
