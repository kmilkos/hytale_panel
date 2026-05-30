import { showError } from './errorModal';

const hostname = window.location.hostname || '127.0.0.1';
const host = window.location.host || '127.0.0.1:5600';
const cleanHostname = hostname === 'localhost' ? '127.0.0.1' : hostname;
const cleanHost = host.startsWith('localhost') ? host.replace('localhost', '127.0.0.1') : host;

export const API_BASE_URL = window.location.port === '5173'
  ? `http://${cleanHostname}:5600/api`
  : '/api';

export const WS_BASE_URL = window.location.port === '5173'
  ? `ws://${cleanHostname}:5600/ws`
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${cleanHost}/ws`;

export function getToken() {
  return localStorage.getItem('token');
}

export function setToken(token) {
  localStorage.setItem('token', token);
}

export function clearToken() {
  localStorage.removeItem('token');
}

export function getUser() {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      exp: payload.exp
    };
  } catch (err) {
    return null;
  }
}

export async function apiRequest(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Accept': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Handle JSON payload serialization
  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const url = `${API_BASE_URL}${endpoint}`;

  let res;
  try {
    res = await fetch(url, { ...options, headers, body });
  } catch (networkErr) {
    // Show network error modal with details
    showError('Cannot connect to the server. Please ensure the backend is running.', { details: networkErr.message });
    throw new Error(`Cannot connect to the server. Make sure the backend is running on port 5600. (${networkErr.message})`);
  }

  if (res.status === 401) {
    clearToken();
    if (!window.location.hash.includes('/login') && !window.location.pathname.includes('/login')) {
      window.location.href = '#/login';
    }
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const message = errData?.error?.message || errData?.message || `Server error ${res.status}: ${res.statusText}`;
    // Show server error modal with details if available
    const details = errData?.error?.details || JSON.stringify(errData);
    showError(message, { details });
    throw new Error(message);
  }

  // Check content type before parsing
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return await res.json();
  }
  return null;
}
