// API request wrapper: unified fetch logic for all backend endpoints

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function apiGet<T = any>(url: string): Promise<T> {
  const response = await fetch(url);
  return parseResponse<T>(response);
}

export async function apiPost<T = any>(url: string, body: any): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

export async function apiPostForm<T = any>(url: string, formData: FormData): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    body: formData
  });
  return parseResponse<T>(response);
}

export async function apiTranslate(text: string): Promise<{ success: boolean; translation?: string; error?: string; cached?: boolean; is_from_dict?: boolean; input_type?: string }> {
  return apiPost('/api/translate', { text });
}