// src/utils/requestersManager.js
const STORAGE_KEY = 'cdm_bajas_requesters_v1';
const DEFAULT_REQUESTERS = ['DANIA', 'TERESA', 'ALEJANDRA'];

export const getRequesters = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_REQUESTERS));
      return [...DEFAULT_REQUESTERS];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return [...DEFAULT_REQUESTERS];
  } catch (e) {
    console.warn('Error reading requesters:', e);
    return [...DEFAULT_REQUESTERS];
  }
};

export const addRequester = (name) => {
  if (!name || !name.trim()) return getRequesters();
  const cleanName = name.trim().toUpperCase();
  const current = getRequesters();
  if (current.includes(cleanName)) return current;
  const updated = [...current, cleanName];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Error saving requester:', e);
  }
  return updated;
};

export const removeRequester = (name) => {
  if (!name) return getRequesters();
  const cleanName = name.trim().toUpperCase();
  const current = getRequesters();
  const updated = current.filter(n => n !== cleanName);
  const finalList = updated.length > 0 ? updated : [...DEFAULT_REQUESTERS];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(finalList));
  } catch (e) {
    console.warn('Error removing requester:', e);
  }
  return finalList;
};
