/** Contrato compartilhado da configuração autenticada do portal. */
export interface AppUser {
  nome?: string;
  is_active?: boolean;
  plano?: string;
  [field: string]: unknown;
}
export interface AppConfig {
  user?: AppUser | null;
  [field: string]: unknown;
}
export async function fetchAppConfig(): Promise<AppConfig | null> {
  try {
    const res = await fetch('/api/app-config', {
      headers: {
        'Accept': 'application/json',
      }
    });
    if (!res.ok) throw new Error('Failed to fetch app config');
    return (await res.json()) as AppConfig;
  } catch (error) {
    console.error('Error fetching app config:', error);
    return null;
  }
}
