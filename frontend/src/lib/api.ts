import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || '/';

export const api = axios.create({
  baseURL,
  headers: {
    'Accept': 'application/json',
  },
});

// DB set header helper
export function setDbSet(name: string | null) {
  if (name) {
    api.defaults.headers.common['X-DB-SET'] = name;
    try { localStorage.setItem('dbSet', name); } catch {}
  } else {
    delete api.defaults.headers.common['X-DB-SET'];
    try { localStorage.removeItem('dbSet'); } catch {}
  }
}

// Initialize from storage
try {
  const saved = localStorage.getItem('dbSet');
  if (saved) {
    api.defaults.headers.common['X-DB-SET'] = saved;
  }
} catch {}

export default api;
