// src/utils/dispatchersManager.js
const STORAGE_KEY = 'cdm_bajas_dispatchers_v1';
const DEFAULT_DISPATCHERS = ['OPERADOR', 'ALBERTO', 'KEVIN', 'ISAAC', 'ADRIAN'];

export const getDispatchers = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_DISPATCHERS));
      return [...DEFAULT_DISPATCHERS];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return [...DEFAULT_DISPATCHERS];
  } catch (e) {
    console.warn('Error reading dispatchers:', e);
    return [...DEFAULT_DISPATCHERS];
  }
};

export const addDispatcher = (name) => {
  if (!name || !name.trim()) return getDispatchers();
  const cleanName = name.trim().toUpperCase();
  const current = getDispatchers();
  if (current.includes(cleanName)) return current;
  const updated = [...current, cleanName];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Error saving dispatcher:', e);
  }
  return updated;
};

export const removeDispatcher = (name) => {
  if (!name) return getDispatchers();
  const cleanName = name.trim().toUpperCase();
  const current = getDispatchers();
  const updated = current.filter(n => n !== cleanName);
  const finalList = updated.length > 0 ? updated : [...DEFAULT_DISPATCHERS];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(finalList));
  } catch (e) {
    console.warn('Error removing dispatcher:', e);
  }
  return finalList;
};
