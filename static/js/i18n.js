(function(){
    // ── i18n Core Engine ──
    const KEY = 'studio_lang';
    const DEFAULT_LANG = 'zh';
    const dict = { zh: {}, en: {} };

    function lang(){
        return localStorage.getItem(KEY) || DEFAULT_LANG;
    }

    function normalizeEntry(key, entry){
        if(entry && typeof entry === 'object' && !Array.isArray(entry) && ('zh' in entry || 'en' in entry)){
            return {
                zh: entry.zh == null ? (entry.en == null ? key : String(entry.en)) : String(entry.zh),
                en: entry.en == null ? (entry.zh == null ? key : String(entry.zh)) : String(entry.en),
            };
        }
        const value = entry == null ? key : String(entry);
        return { zh: value, en: value };
    }

    function register(bundle){
        if(!bundle || typeof bundle !== 'object') return;
        if(bundle.zh || bundle.en){
            Object.assign(dict.zh, bundle.zh || {});
            Object.assign(dict.en, bundle.en || {});
            return;
        }
        Object.entries(bundle).forEach(([key, entry]) => {
            const normalized = normalizeEntry(key, entry);
            dict.zh[key] = normalized.zh;
            dict.en[key] = normalized.en;
        });
    }

    function t(key){
        const current = lang();
        return dict[current]?.[key] || dict[DEFAULT_LANG]?.[key] || key;
    }

    function apply(root=document){
        root.querySelectorAll('[data-i18n]').forEach(el => {
            el.textContent = t(el.dataset.i18n);
        });
        root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
        });
        root.querySelectorAll('[data-i18n-title]').forEach(el => {
            el.setAttribute('title', t(el.dataset.i18nTitle));
        });
        root.documentElement?.setAttribute('lang', lang() === 'en' ? 'en' : 'zh-CN');
        window.dispatchEvent(new CustomEvent('studio-lang-change', { detail:{ lang:lang() } }));
    }

    function set(next){
        localStorage.setItem(KEY, next === 'en' ? 'en' : 'zh');
        apply();
    }

    function toggle(){
        set(lang() === 'en' ? 'zh' : 'en');
    }

    function entries(){
        return JSON.parse(JSON.stringify(dict));
    }

    window.StudioI18n = { t, apply, set, toggle, lang, register, entries };
    document.addEventListener('DOMContentLoaded', () => apply());

    // ── Language Bundle Loader ──
    const VERSION = '2026.05.25.3';
    const scripts = [
        '/static/js/i18n/common.js',
        '/static/js/i18n/studio.js',
        '/static/js/i18n/api-settings.js',
        '/static/js/i18n/canvas.js',
        '/static/js/i18n/smart-canvas.js',
        '/static/js/i18n/comfyui-settings.js',
    ];
    const tags = scripts.map(src => '<script src="' + src + '?v=' + VERSION + '"></script>').join('');
    if(document.readyState === 'loading' && document.currentScript){
        document.write(tags);
        return;
    }
    scripts.reduce((promise, src) => promise.then(() => new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src + '?v=' + VERSION;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    })), Promise.resolve()).catch(err => console.error('Failed to load i18n modules', err));
})();
