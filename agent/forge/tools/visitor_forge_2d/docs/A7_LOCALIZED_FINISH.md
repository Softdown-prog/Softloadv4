# Acabamento guiado pela região

O passe `finishRegions` do Scene Composer V4 agora aceita `sampling: "mask"`.
Ele reutiliza os oito pincéis existentes e concentra suas marcas na superfície
indicada, evitando gastar o orçamento de pinceladas em áreas vazias do canvas.
É útil em ferragens, placas, cordas e detalhes pequenos, sem aumentar `stamps`
até que alguma marca caia por acaso na peça.

## Integração

Em uma receita `CH_2D_SCENE_RECIPE_V4`, adicione:

```json
{
  "finishRegions": [{
    "style": "scratches",
    "sampling": "mask",
    "mask": {"primitive": "rect", "box": [79, 49, 114, 73]},
    "stamps": 24,
    "opacity": 0.22,
    "angleDeg": 0
  }]
}
```

Execute o exemplo completo pelo pipeline existente:

```bash
python -m visitor_forge_2d run-workers \
  --recipe tools/visitor_forge_2d/examples/localized_finish_mask_demo.json \
  --output out/localized_finish
```

O acabamento ocorre após os passes globais e antes do crítico visual. Não há
nova dependência, novo renderizador ou alteração nos jogos. Máscaras continuam
em coordenadas do canvas final; não acompanham automaticamente transformações
de componentes. Para comparar, troque somente `sampling` por `"canvas"`.

## Comportamento e compatibilidade

- Ausência de `sampling` mantém a distribuição antiga (`canvas`). Receitas e
  estilos existentes continuam aceitos; a nova distribuição é optativa.
- `mask` seleciona centros entre pixels da interseção da máscara com o alfa do
  desenho. Valores abaixo de 16/255 não são centros, evitando halos residuais
  de antialiasing. As marcas ainda são recortadas pela máscara completa.
- `edge_wear` seleciona centros no contorno interno dessa interseção.
- `plank_seams` distribui as linhas pela projeção da caixa da região sobre a
  normal das linhas, preservando o padrão de tábuas. Não sorteia centros como
  os demais pincéis; máscaras descontínuas podem interromper suas linhas.
- Regiões vazias são ignoradas. Seed e ordem das regiões fixas reproduzem o
  resultado; o passe não modifica a receita nem a imagem de entrada.
- Todos os modos preservam exatamente o alfa original. Isso corrige o passe
  antigo, que podia acrescentar opacidade e pintar pixels fora da silhueta.
  Receitas que dependiam desse efeito colateral terão saída diferente: expansão
  da silhueta deve ser feita na geometria, não no acabamento de superfície.
- `stamps: 0` ou `opacity: 0` desativa qualquer estilo, incluindo `plank_seams`.
  Os limites anteriores de 32 regiões e 120 marcas por região permanecem.

O índice de centros é construído uma vez por região, com inteiros compactos
(até quatro bytes por pixel elegível), sem tentativas aleatórias ilimitadas.
A mudança controla onde pintar; não escolhe automaticamente materiais, máscaras
ou qualidade artística, nem promove resultados para runtime.

## Verificação

`tests/test_localized_finish.py` cobre os oito estilos, determinismo, alfa
semitransparente, canvas com margens maiores, máscaras vazias e com vazados,
passe desativado, compatibilidade do padrão e integração com o compositor V4.
