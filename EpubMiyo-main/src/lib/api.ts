export async function fetchWithTimeout(resource: RequestInfo, options: RequestInit & { timeout?: number } = {}) {
  const { timeout = 120000 } = options; // 120 seconds default for large EPUBs
  
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);

    if (!response.ok) {
      // Try to parse structured error from backend
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        throw {
          code: 'SERVER_ERROR',
          message: `Server responded with status ${response.status}`,
          cause: 'The server encountered an error and could not return a structured response.',
          fix: 'Please try again later or check the server logs.'
        };
      }

      if (errorData && errorData.error) {
        throw errorData.error;
      } else {
        throw {
          code: 'UNKNOWN_API_ERROR',
          message: 'An unknown API error occurred.',
          cause: JSON.stringify(errorData),
          fix: 'Please report this issue.'
        };
      }
    }

    return response;
  } catch (error: any) {
    clearTimeout(id);
    
    // Handle AbortError (Timeout)
    if (error.name === 'AbortError') {
      throw {
        code: 'TIMEOUT',
        message: 'Request timed out.',
        cause: 'The server took too long to respond. This can happen with very large EPUB files (11MB+) or a slow network connection.',
        fix: 'Check your internet connection and try again. For large files, please be patient as parsing takes time.'
      };
    }
    
    // Handle Network Errors (Failed to fetch)
    if (error.message === 'Failed to fetch') {
      throw {
        code: 'NETWORK_ERROR',
        message: 'Network connection failed.',
        cause: 'The browser could not reach the server. The server might be down or your connection dropped.',
        fix: 'Check your internet connection and ensure the backend server is running.'
      };
    }

    // Re-throw structured errors
    throw error;
  }
}
