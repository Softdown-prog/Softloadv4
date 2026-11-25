import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

const featuredModels = [
  { id: 'portfolio-violeta', name: 'Ateliê Digital', category: 'Portfólio', image: 'portfolio', width: 1080, height: 700,
    description: 'Uma vitrine para apresentar seus projetos e seu trabalho criativo.' },
  { id: 'tecnologia-cobalto', name: 'Circuito Digital', category: 'Tecnologia', image: 'tecnologia', width: 960, height: 620,
    description: 'Um portal com espaço para notícias, análises e postagens em destaque.' },
  { id: 'receitas-sabores', name: 'Mesa & Afeto', category: 'Culinária', image: 'receitas', width: 960, height: 620,
    description: 'Um blog para reunir receitas, categorias e histórias à mesa.' },
] as const;

@Component({
  selector: 'sl-home',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomePage {
  protected readonly featuredModels = featuredModels;
}
