type Dict = Record<string, string>;

const dictionaries: Record<string, Dict> = {};
let currentLang = 'zh-CN';

export function t(key: string, fallback?: string): string {
  return dictionaries[currentLang]?.[key] ?? dictionaries['zh-CN']?.[key] ?? fallback ?? key;
}

export function setLang(lang: string): void {
  currentLang = lang;
  applyLang();
}

export function getLang(): string {
  return currentLang;
}

export function register(lang: string, dict: Dict): void {
  dictionaries[lang] = { ...(dictionaries[lang] || {}), ...dict };
}

export function applyLang(): void {
  document.documentElement.setAttribute('lang', currentLang);
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = t(key);
    }
  }
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-placeholder]')) {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      el.placeholder = t(key);
    }
  }
}

export function initI18n(defaultLang: string = 'zh-CN'): void {
  currentLang = defaultLang || 'zh-CN';
  applyLang();
}
