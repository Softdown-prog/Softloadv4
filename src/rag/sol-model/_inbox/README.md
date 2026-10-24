# Inbox — rascunho de conhecimento pendente de conversão

Jogue aqui um `.txt` ou `.md` com texto livre — sem formatação nenhuma
exigida — descrevendo algo sobre manutenção/operação da Softload. Não há
mais conversão automática (o worker via GitHub Actions foi removido por
instabilidade); a conversão pro formato `{id}.json` de
`src/rag/sol-model/` (ver `index.json`) é manual.

Depois de convertido à mão, mova o arquivo original pra `_processado/` —
nunca apague.

Nada aqui dentro (exceto `_processado/`) é lido em runtime pelo Sol —
esta pasta é só a fila de entrada, não a base de conhecimento em si (essa
fica em `src/rag/sol-model/*.json`, ver `index.json`).
