# Workers do Visitor Forge 2D

`run-workers` executa cinco tarefas pequenas sobre **uma receita existente**:

1. **Receita** — confere ID seguro, canvas, pivô e o contrato da câmera quando há cenário orgânico.
2. **Render** — chama o renderizador original de shape, árvore ou canteiro; não redesenha o asset.
3. **Alpha/pivô** — abre o PNG real, verifica RGBA, dimensões, pixels visíveis, limites de altura e metadados.
4. **Câmera** — exige a prancha isométrica `CH_CAMERA_V1` para cenário orgânico. Shape simples não recebe câmera inventada.
5. **Proveniência** — registra SHA-256 da receita e do PNG em `worker_report.json`.

Exemplo local:

```bash
PYTHONPATH=tools/visitor_forge_2d/src python -m visitor_forge_2d run-workers \
  --recipe tools/visitor_forge_2d/examples/pine_small_v1.json \
  --output out/visitor_forge_2d/workers
```

A saída fica em `out/visitor_forge_2d/workers/pine_small_v1/`, separada por ID,
com PNG, review 1x/2x, prancha de câmera (quando aplicável), metadados e
`worker_report.json`. A conclusão é `review_ready`: métricas e CI não aprovam
arte nem promovem um PNG para `assets/`.
O nome da pasta é o `id` declarado no JSON, que pode diferir do nome do arquivo
da receita; o artifact do CI captura a raiz `workers/` para cobrir ambos.

## Pedidos travados pelo hash da receita

`run-workers` continua aceitando diretamente um caminho de receita e registra o
SHA-256 usado como proveniência. Quando um pedido precisa garantir **antes do
render** que o worker está consumindo exatamente os bytes revisados, use o
contrato `CH_2D_WORKER_REQUEST_V1` e o runner `worker_request`.

Cada item do pedido contém somente `path` e `sha256`. O runner calcula o SHA-256
do arquivo antes de chamar `run-workers` e aborta se houver divergência. Depois
do render ele também compara o `recipeSha256` produzido pelo próprio worker com
o hash esperado, fechando a ligação pedido -> receita -> worker -> proveniência.

Exemplo:

```bash
PYTHONPATH=tools/visitor_forge_2d/src python -m visitor_forge_2d.worker_request \
  --request tools/visitor_forge_2d/worker_requests/trash_bin_green_swing_v1.json \
  --repo-root . \
  --output out/visitor_forge_2d/worker_requests
```

O relatório agregado fica em
`out/visitor_forge_2d/worker_requests/<request-id>/worker_request_report.json` e
lista os hashes confirmados, PNGs, reviews e relatórios individuais. Pedidos
versionados ficam em `tools/visitor_forge_2d/worker_requests/`. O job
`hash-locked-requests` do workflow canônico `Visitor Forge 2D Workers` executa
esses pedidos no GitHub Actions.

O workflow `Visitor Forge 2D Workers` mantém também a matriz das receitas de
regressão e os autores de arte/props. Para ampliar a matriz, inclua uma receita
versionada em `examples/` e seu nome na matriz; mantenha o gate visual em 1x
e na grade antes de qualquer integração no jogo.
O workflow antigo de pinheiros permanece disponível manualmente, sem duplicar
as renderizações em cada push.

São workers determinísticos da ferramenta, sem serviços de IA, credenciais ou
gerações de imagem externas. A decisão artística continua com a revisão humana.

Para **criar** a receita a partir de uma intenção, use `author-art` antes de
`run-workers`. O autor escolhe uma receita de referência, aplica controles
artísticos versionados e roda estes workers em seguida. Famílias suportadas,
limites de interpretação e revisão: [ART_AUTHOR.md](ART_AUTHOR.md).
