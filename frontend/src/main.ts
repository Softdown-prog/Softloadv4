import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideZonelessChangeDetection } from '@angular/core';
import { AppComponent, routes } from './app/app';

bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection(), provideRouter(routes, withInMemoryScrolling({scrollPositionRestoration: 'enabled'}))]
}).catch(error => console.error('Falha ao iniciar a interface Angular:', error));
