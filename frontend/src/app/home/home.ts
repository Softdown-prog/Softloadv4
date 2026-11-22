import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

const palettes = [
  { id: 'ocean', name: 'Azul' },
  { id: 'coral', name: 'Coral' },
  { id: 'forest', name: 'Verde' },
] as const;

@Component({
  selector: 'sl-home',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomePage {
  protected readonly palettes = palettes;
  protected readonly palette = signal<(typeof palettes)[number]['id']>('ocean');
}
