// API request wrapper: unified fetch logic for all backend endpoints

export async function apiGet<T = any>(url: string): Promise<T> {
  const response = await fetch(url);
  return response.json() as Promise<T>;
}

export async function apiPost<T = any>(url: string, body: any): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return response.json() as Promise<T>;
}

export async function apiPostForm<T = any>(url: string, formData: FormData): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    body: formData
  });
  return response.json() as Promise<T>;
}

export async function apiTranslate(text: string): Promise<{ success: boolean; translation?: string; error?: string }> {
  return apiPost('/api/translate', { text });
}