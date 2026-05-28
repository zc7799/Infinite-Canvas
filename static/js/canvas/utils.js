/**
 * Canvas 纯工具函数 —— 不依赖 DOM、不修改全局状态、不产生副作用。
 * 暴露为 window.CanvasUtils 命名空间 + 常用函数直接挂 window，
 * 保证存量 IIFE 代码（canvas.js / smart-canvas.js）平滑过渡。
 *
 * 外部依赖（通过 window 访问）：
 *   - window.escapeHtml  (来自 common.js)
 *   - window.escapeAttr   (来自 common.js)
 *   - window.StudioI18n   (来自 i18n-core.js)
 */
(function () {
    'use strict';

    // ── ID / 字符串工具 ──────────────────────────────────────────

    function uid(prefix) {
        return (prefix || 'n') + '_' + Math.random().toString(16).slice(2) + '_' + Date.now();
    }

    function uniqueModels(list) {
        var seen = new Set();
        return list.map(function (item) { return String(item || '').trim(); }).filter(function (item) {
            if (!item || seen.has(item)) return false;
            seen.add(item);
            return true;
        });
    }

    function uniqueValues(values) {
        var seen = new Set();
        return values.filter(function (value) {
            var key = String(value || '').trim();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function normalizeProviderId(value) {
        return String(value || '').trim().toLowerCase()
            .replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 40);
    }

    // ── 图片尺寸 / 比例工具 ─────────────────────────────────────

    function parseRatioValue(value) {
        var raw = String(value || '').trim();
        if (!raw) return null;
        if (raw.includes(':')) {
            var parts = raw.split(':').map(Number);
            if (parts[0] > 0 && parts[1] > 0) return parts[0] / parts[1];
        }
        var n = Number(raw);
        return n > 0 ? n : null;
    }

    function parseSizeValue(value) {
        var match = String(value || '').trim().match(/^(\d+)\s*[xX*]\s*(\d+)$/);
        return match ? { width: match[1], height: match[2] } : null;
    }

    function parseSizePair(value) {
        var match = String(value || '').match(/(\d+)\s*x\s*(\d+)/i);
        return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
    }

    function gcdInt(a, b) {
        a = Math.abs(Math.round(Number(a) || 0));
        b = Math.abs(Math.round(Number(b) || 0));
        while (b) { var t = b; b = a % b; a = t; }
        return a || 1;
    }

    function ratioPartsFromDimensions(width, height) {
        var w = Math.max(1, Math.round(Number(width) || 1));
        var h = Math.max(1, Math.round(Number(height) || 1));
        var target = w / h;
        var best = { width: 1, height: 1, score: Infinity };
        var maxPart = 21;
        for (var rw = 1; rw <= maxPart; rw++) {
            for (var rh = 1; rh <= maxPart; rh++) {
                var ratio = rw / rh;
                var relativeError = Math.abs(ratio - target) / target;
                var complexityPenalty = Math.max(rw, rh) * 0.0008;
                var score = relativeError + complexityPenalty;
                if (score < best.score) best = { width: rw, height: rh, score };
            }
        }
        var g = gcdInt(best.width, best.height);
        return { width: best.width / g, height: best.height / g };
    }

    // ── 质量 / 错误消息 ──────────────────────────────────────────

    function normalizedImageQuality(value) {
        var quality = String(value || 'auto').trim().toLowerCase();
        return ['low', 'medium', 'high'].indexOf(quality) !== -1 ? quality : '';
    }

    function apiErrorMessage(data, fallback) {
        fallback = fallback || '请求失败';
        if (!data) return fallback;
        if (typeof data === 'string') return data || fallback;
        var detail = data.detail || data.error || data.message;
        if (typeof detail === 'string') return detail || fallback;
        if (Array.isArray(detail)) {
            var messages = detail.map(function (item) {
                if (typeof item === 'string') return item;
                var loc = Array.isArray(item && item.loc) ? item.loc.filter(function (x) { return x !== 'body'; }).join('.') : '';
                var msg = item.msg || item.message || JSON.stringify(item);
                return loc ? loc + ': ' + msg : msg;
            }).filter(Boolean);
            return messages.join('\n') || fallback;
        }
        if (detail && typeof detail === 'object') {
            return detail.message || detail.msg || JSON.stringify(detail);
        }
        try { return JSON.stringify(data); } catch (_) { return fallback; }
    }

    // ── 媒体类型检测 ─────────────────────────────────────────────

    function isVideoUrl(url) {
        if (typeof url !== 'string') return false;
        var clean = url.split('?')[0].toLowerCase();
        return /\.(mp4|webm|mov|m4v)$/.test(clean);
    }

    function isAudioUrl(url) {
        return /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(String(url || ''));
    }

    function isTextUrl(url) {
        return /\.(txt|json|csv|srt|vtt|md)(\?|$)/i.test(String(url || ''));
    }

    function isRemoteVideoReferenceUrl(url) {
        return /^https?:\/\//i.test(String(url || '')) || /^asset:\/\//i.test(String(url || ''));
    }

    function mediaKindForUpload(file) {
        var type = String((file && file.type) || '').toLowerCase();
        var name = String((file && file.name) || '').toLowerCase();
        if (type.indexOf('video/') === 0 || /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/.test(name)) return 'video';
        if (type.indexOf('audio/') === 0 || /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name)) return 'audio';
        return 'image';
    }

    function isSupportedUploadFile(file) {
        var type = String((file && file.type) || '').toLowerCase();
        var name = String((file && file.name) || '').toLowerCase();
        return type.indexOf('image/') === 0 || type.indexOf('video/') === 0 || type.indexOf('audio/') === 0
            || /\.(png|jpe?g|webp|gif|bmp|avif|mp4|webm|mov|m4v|avi|mkv|mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name);
    }

    function mediaKindForRef(ref) {
        var kind = String((ref && ref.kind) || (ref && ref.mediaKind) || '').toLowerCase();
        if (['video', 'audio', 'image', 'text', 'file'].indexOf(kind) !== -1) return kind;
        var url = String((ref && ref.url) || ref || '');
        if (isVideoUrl(url)) return 'video';
        if (isAudioUrl(url)) return 'audio';
        if (isTextUrl(url)) return 'text';
        return 'image';
    }

    function imageRefsOnly(refs) {
        return (refs || []).filter(function (ref) { return ref && ref.url && mediaKindForRef(ref) === 'image'; });
    }

    function videoRefsOnly(refs) {
        return (refs || []).filter(function (ref) { return ref && ref.url && mediaKindForRef(ref) === 'video'; });
    }

    function audioRefsOnly(refs) {
        return (refs || []).filter(function (ref) { return ref && ref.url && mediaKindForRef(ref) === 'audio'; });
    }

    // ── 时间 / 图标 ──────────────────────────────────────────────

    function formatCanvasTime(value) {
        if (!value) return '--';
        var raw = Number(value);
        var time = raw < 10000000000 ? raw * 1000 : raw;
        var date = new Date(time);
        if (isNaN(date.getTime())) return '--';
        var lang = window.StudioI18n && window.StudioI18n.lang && window.StudioI18n.lang() === 'en' ? 'en-US' : 'zh-CN';
        return date.toLocaleString(lang, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    function renderCanvasIcon(icon, size) {
        if (!size) size = 14;
        if (!icon || icon === '🧩') return '<i data-lucide="layers" style="width:' + size + 'px;height:' + size + 'px"></i>';
        if (/[^\x00-\x7F]/.test(icon)) return window.escapeHtml ? window.escapeHtml(icon) : icon;
        var escaped = window.escapeHtml ? window.escapeHtml(icon) : icon;
        return '<i data-lucide="' + escaped + '" style="width:' + size + 'px;height:' + size + 'px"></i>';
    }

    // ── 默认数据 ──────────────────────────────────────────────────

    var DEFAULT_VIDEO_MODELS = [
        'veo2', 'veo2-fast', 'veo2-pro',
        'veo3', 'veo3-fast', 'veo3-pro',
        'veo3.1', 'veo3.1-fast', 'veo3.1-quality', 'veo3.1-lite',
        'sora-2', 'sora-2-pro',
        'wan2.6-t2v', 'wan2.6-i2v',
        'wan2.5-t2v-preview', 'wan2.5-i2v-preview',
        'wan2.2-t2v-plus', 'wan2.2-i2v-plus', 'wan2.2-i2v-flash',
        'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128',
        'doubao-seedance-1-5-pro-251215', 'doubao-seedance-1-0-pro-250528',
        'doubao-seedance-1-0-lite-t2v-250428', 'doubao-seedance-1-0-lite-i2v-250428'
    ];

    function defaultApiProviders() {
        return [{
            id: 'comfly', name: 'Comfly', base_url: '', enabled: true,
            image_models: ['gpt-image-2', 'nano-banana-pro'],
            chat_models: ['gpt-4o-mini'],
            video_models: DEFAULT_VIDEO_MODELS,
            has_key: false, key_preview: ''
        }];
    }

    // ── 向后兼容：挂到 window 供存量 IIFE 代码使用 ──────────────

    var exports = {
        uid: uid,
        uniqueModels: uniqueModels,
        uniqueValues: uniqueValues,
        normalizeProviderId: normalizeProviderId,
        parseRatioValue: parseRatioValue,
        parseSizeValue: parseSizeValue,
        parseSizePair: parseSizePair,
        gcdInt: gcdInt,
        ratioPartsFromDimensions: ratioPartsFromDimensions,
        normalizedImageQuality: normalizedImageQuality,
        apiErrorMessage: apiErrorMessage,
        isVideoUrl: isVideoUrl,
        isAudioUrl: isAudioUrl,
        isTextUrl: isTextUrl,
        isRemoteVideoReferenceUrl: isRemoteVideoReferenceUrl,
        mediaKindForUpload: mediaKindForUpload,
        isSupportedUploadFile: isSupportedUploadFile,
        mediaKindForRef: mediaKindForRef,
        imageRefsOnly: imageRefsOnly,
        videoRefsOnly: videoRefsOnly,
        audioRefsOnly: audioRefsOnly,
        formatCanvasTime: formatCanvasTime,
        renderCanvasIcon: renderCanvasIcon,
        defaultApiProviders: defaultApiProviders
    };

    window.CanvasUtils = exports;

    // 常用函数也直接挂到 window，让存量代码无需改动
    Object.keys(exports).forEach(function (key) {
        if (typeof window[key] === 'undefined') {
            window[key] = exports[key];
        }
    });

})();
