# A7 Pixel Polish

O `A7_FORGE_2D_PIXEL_POLISH_V1` é um passe determinístico de acabamento para
pixel art nativa. Ele existe para melhorar a qualidade dos traços do Forge sem
transformar o acabamento em correções específicas de um personagem.

## Perfil conservador

`pixelPolishProfile: "conservative"` é o padrão atual para personagens pixel.
O passe:

- remove apenas pixels opacos totalmente isolados na vizinhança de 8 pixels;
- preenche apenas pinholes transparentes de 1 pixel completamente cercados;
- preserva diagonais conectadas, pontas, cajados, cristais, chapéus e detalhes
  que mantenham contato com a silhueta;
- nunca redimensiona, desfoca, interpola ou aplica antialiasing;
- executa uma única passada simultânea, portanto o resultado é determinístico.

Use `"off"` para comparar o frame bruto com o acabamento.

```json
{
  "contract": "A7_FORGE_2D_PIXEL_CHARACTER_V1",
  "id": "character_01",
  "canvas": [32, 48],
  "pixelPolishProfile": "conservative"
}
```

## Auditoria

O manifesto do personagem registra `pixelPolish.profile`,
`changedPixels`, `framesChanged` e o relatório de cada pose/direção. Isso
permite medir se uma futura alteração no desenhista está limpando defeitos reais
ou alterando demais a arte.

O objetivo do passe é ser infraestrutura geral. Arquétipos não recebem regras
específicas no polidor.
