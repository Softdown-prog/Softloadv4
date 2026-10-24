export async function fetchAppConfig() {
  try {
    const res = await fetch('/api/app-config', {
      headers: {
        'Accept': 'application/json',
      }
    });
    if (!res.ok) throw new Error('Failed to fetch app config');
    return await res.json();
  } catch (error) {
    console.error('Error fetching app config:', error);
    return null;
  }
}
