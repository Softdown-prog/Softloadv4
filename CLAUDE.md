# Softload Engine V3 — princípio de engenharia

A Softload não é um MVP nem um experimento de vibe coding. O objetivo
principal deste projeto é **qualidade estrutural, previsibilidade e
evolução por muitos anos**.

Toda decisão de arquitetura deve priorizar, nesta ordem de importância:

1. eliminar trabalho manual futuro;
2. aumentar a qualidade dos templates gerados;
3. permitir expansão incremental sem retrabalho;
4. manter componentes especializados e reutilizáveis;
5. favorecer código determinístico sempre que possível — IA só entra
   onde não há alternativa determinística viável.

## Tempo não é critério de decisão

O tempo de desenvolvimento **não** é critério de decisão. Se uma
arquitetura leva mais tempo para ser construída, mas reduz manutenção e
melhora a qualidade do produto final, ela é a opção preferida.

O tempo de compilação também não é o objetivo principal. Se forem
necessárias mais etapas de validação, comparação ou auditoria para
produzir um template significativamente melhor, isso é aceitável.

**Sempre que houver dúvida entre uma solução rápida e uma solução
escalável, escolha a escalável.**

## Por que isso importa (o motivo de negócio)

Softload não vende um gerador barato de templates. O modelo de negócio
depende de **recorrência** — o usuário precisa gerar um template de alta
qualidade logo nas primeiras experiências para perceber valor e
continuar pagando mensalmente. A qualidade do template é mais importante
do que economizar segundos de processamento ou semanas de
desenvolvimento da arquitetura.

O risco é real e explícito: se a qualidade esperada não for atingida, o
projeto pode ser encerrado. Isso não é uma preferência estética — é o
critério que decide se o produto continua existindo.

## Como isso se traduz em código, concretamente

- Contrato formal (dossiê por nicho) em vez de heurística/regex sobre
  `impl.json` — ver `src/core/compilerEngine/dossieLoader.js` e
  `dossieValidator.js`.
- Verificação mecânica pós-compilação (`domIds`) em vez de confiar que a
  extração deu certo — ver `dossieIntegrityChecker.js`.
- Workers determinísticos (`src/core/compilerEngine/workers/`) validando
  CSS/JS/HTML antes de qualquer peça (humana ou gerada por IA) entrar no
  dossiê — nunca aceitar output de IA sem passar pelos mesmos
  verificadores que peças autorais passariam.
- Quando uma peça precisa ser gerada por IA (`pecaOrchestrator.js`), a
  sequência de decisão é código determinístico; a IA só gera conteúdo
  dentro de um schema restrito — nunca decide os passos sozinha.
- Migração de nicho é processo de 9 estágios (decisão → arquitetura →
  engenharia → montagem → testes → refinamento → acabamento →
  fiscalização → entrega), não patch pontual.
