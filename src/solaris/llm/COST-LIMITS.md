# Limites de saída Solaris — issue #65

Triagem Flash e chat streaming: até 2048 tokens por chamada. Arquitetura Pro e
tool-calling: 8192 por padrão. `SOLARIS_MAX_OUTPUT_TOKENS` aceita inteiros de
256 a 16384; valores inválidos voltam a 8192. Flash continua limitado a 2048.
Isso limita saída, não constitui teto financeiro por usuário ou por tarefa.

Os preços/quantidades dos planos não mudam. O ledger existente deve continuar
reservando antes de chamadas e liquidando o uso medido, inclusive Flash. O
modo legado ainda debita depois da resposta. Flags de produção não foram
inspecionadas ou alteradas; nenhuma chamada paga ou operação na VPS foi feita.

O teste `modelRouterLimits.test.js` cobre configuração ausente/inválida,
extremos, triagem, streaming e Pro com cliente simulado. O teste existente do
roteador cobre tool-calling, uso e falhas. Tokens máximos não são medição de
economia realizada; comparar uso real antes/depois requer homologação.
