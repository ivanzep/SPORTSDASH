export const sportConfig = {
  nfl: { label: 'NFL', icon: '🏈' },
  mlb: { label: 'MLB', icon: '⚾' },
  f1: { label: 'F1', icon: '🏎️' }
};
export function selectedEvents(key) {
  try { return JSON.parse(localStorage.getItem('sportsdash-selected-' + key) || '[]'); }
  catch { return []; }
}
export function saveEvents(key, ids) {
  localStorage.setItem('sportsdash-selected-' + key, JSON.stringify(ids));
}
