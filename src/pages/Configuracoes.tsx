import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export default function Configuracoes() {
  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Configurações</h1>

      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Mercado Livre</h2>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Conectado</Badge>
              <span className="text-sm">como vendedor_mock</span>
            </div>
            <Button variant="outline" size="sm" disabled>
              Desconectar
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Estratégia de preço</h2>
          <RadioGroup defaultValue="condicional" className="flex flex-col gap-2">
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="proprio" id="r1" />
              <div>
                <div className="font-medium">Próprio sempre</div>
                <div className="text-xs text-muted-foreground">Manter o preço da planilha em todos os casos</div>
              </div>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="competitivo" id="r2" />
              <div>
                <div className="font-medium">Competitivo sempre</div>
                <div className="text-xs text-muted-foreground">Alinhar com mediana do mercado em todos os casos</div>
              </div>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <RadioGroupItem value="condicional" id="r3" />
              <div>
                <div className="font-medium">Condicional (recomendado)</div>
                <div className="text-xs text-muted-foreground">
                  PRÓPRIO quando sem concorrência; COMPETITIVO quando há concorrência (ADR-0008)
                </div>
              </div>
            </label>
          </RadioGroup>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Categorias padrão</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span>Linhas de Costura</span>
              <code className="text-xs">MLB1132</code>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span>Botões</span>
              <code className="text-xs">MLB1430</code>
            </div>
            <div className="flex justify-between">
              <span>Fitas</span>
              <code className="text-xs">MLB1429</code>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Definidas via ADR-0009 (lookup determinístico)</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
