# Acabamento procedural 2D de renders aprovados

Use este passe apenas depois que a geometria, câmera, footprint e clearance do asset já estiverem aprovados no pipeline 3D.

O contrato `CH_2D_RENDER_FINISH_V1` existe para pequenos retoques de apresentação em PNG RGBA de alta resolução: separação de cor, microcontraste e nitidez local. Ele não pode ser usado para corrigir erro estrutural do Blender.

Exemplo para a Barca Viking V8:

```bash
python tools/visitor_forge_2d/finish_render.py \
  --input out/ch_blender_agent/attraction.park_viking_ship.quality.v8_1k/proxy_south.png \
  --recipe tools/visitor_forge_2d/examples/viking_ship_v8_finish.json \
  --output out/ch_blender_agent/attraction.park_viking_ship.quality.v8_1k/proxy_south_2d_finish.png \
  --review out/ch_blender_agent/attraction.park_viking_ship.quality.v8_1k/proxy_south_2d_review.png
```

Regras:

- preservar exatamente o canal alpha do master;
- preservar canvas e silhueta;
- não mover, redimensionar ou redesenhar a geometria do brinquedo;
- não alterar câmera, footprint, altura de pivô, `boatDrop` ou clearance;
- não pintar fundo;
- guardar a receita no Git;
- manter o master 3D original ao lado do candidato 3D+2D para comparação;
- revisar em escala de gameplay antes de promover ao runtime.

Para assets grandes, o passe deve receber o master de alta resolução. Na Barca Viking V8 o gate mínimo é 1280 px.
