/**
 * API Provider 选择与模型列表工具。
 * 从 window.CanvasState 读取共享状态（由 canvas.js 的 syncCanvasState() 写入）。
 *
 * 外部依赖（通过 window 访问）：
 *   - window.CanvasState  (canvas.js 状态同步)
 *   - window.CanvasUtils  (utils.js)
 *   - window.tr            (common.js)
 *   - window.escapeHtml    (common.js)
 */
(function () {
    'use strict';

    var C = window.CanvasState || {};
    var U = window.CanvasUtils || {};

    // ── 辅助 ─────────────────────────────────────────────────

    function S() { return window.CanvasState || C; } // 惰性读取，确保获取最新值

    function defaults() {
        var s = S();
        return [{
            id: 'comfly', name: 'Comfly', base_url: '', enabled: true,
            image_models: s.imageModels || ['gpt-image-2', 'nano-banana-pro'],
            chat_models: s.chatModels || ['gpt-4o-mini'],
            video_models: (s.videoModels && s.videoModels.length) ? s.videoModels : DEFAULT_VIDEO_MODELS,
            has_key: false, key_preview: ''
        }];
    }

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

    var MS_GEN_MODELS = {
        zimage:     { label: 'ZImage',     modelId: 'Tongyi-MAI/Z-Image-Turbo',            supportsImage: false, endpoint: '/generate'            },
        qwen_edit:  { label: 'Qwen Edit',  modelId: 'Qwen/Qwen-Image-Edit-2511',            supportsImage: true,  endpoint: '/api/angle/generate'  },
        klein_edit: { label: 'Klein',      modelId: 'black-forest-labs/FLUX.2-klein-9B',   supportsImage: true,  endpoint: '/api/ms/generate'     },
        custom:     { label: '自定义',     modelId: '',                                      acceptsImage: true,   endpoint: '/api/ms/generate'     }
    };

    // ── Provider 检测 ────────────────────────────────────────

    function isRunningHubProvider(provider) {
        var id = String((provider && provider.id) || '').trim().toLowerCase();
        var protocol = String((provider && provider.protocol) || '').trim().toLowerCase();
        var name = String((provider && provider.name) || '').trim().toLowerCase();
        return id === 'runninghub' || protocol === 'runninghub' || name === 'runninghub' || id === 'rh';
    }

    // ── 图片平台 ─────────────────────────────────────────────

    function imageApiProviders() {
        var s = S();
        var all = (s.apiProviders && s.apiProviders.length) ? s.apiProviders : defaults();
        return all.filter(function (p) {
            return p.id !== 'modelscope' && !isRunningHubProvider(p) && p.enabled !== false && (p.image_models || []).length;
        });
    }

    function providerById(id) {
        var s = S();
        var all = (s.apiProviders && s.apiProviders.length) ? s.apiProviders : defaults();
        return all.find(function (p) { return p.id === id; }) || imageApiProviders()[0] || defaults()[0];
    }

    function resolveProviderId(id) {
        return (providerById(id) || {}).id || 'comfly';
    }

    function resolveImageProviderId(id) {
        var providers = imageApiProviders();
        var found = providers.find(function (p) { return p.id === id; });
        return (found && found.id) || (providers[0] && providers[0].id) || '';
    }

    function providerOptions(selectedId) {
        var selected = resolveImageProviderId(selectedId);
        var providers = imageApiProviders();
        if (!providers.length) {
            var label = window.tr ? window.tr('canvas.noApiProviders') : '暂无 API 平台';
            return '<option value="" disabled selected>' + (label || '暂无 API 平台') + '</option>';
        }
        return providers.map(function (provider) {
            var escapedId = window.escapeHtml ? window.escapeHtml(provider.id) : provider.id;
            var escapedName = window.escapeHtml ? window.escapeHtml(provider.name || provider.id) : (provider.name || provider.id);
            return '<option value="' + escapedId + '" ' + (provider.id === selected ? 'selected' : '') + '>' + escapedName + '</option>';
        }).join('');
    }

    function providerImageModels(providerId) {
        var s = S();
        var provider = (s.apiProviders || []).find(function (p) { return p.id === providerId; });
        return U.uniqueModels ? U.uniqueModels(provider && provider.image_models || []) : (provider && provider.image_models || []);
    }

    function allImageModels(providerId) {
        return U.uniqueModels ? U.uniqueModels(providerImageModels(providerId || (S().managedProviderId || 'comfly'))) : [];
    }

    function resolveImageModel(value) {
        var s = S();
        var models = s.models || {};
        if (value === 'gpt') return models.gpt;
        if (value === 'nano') return models.nano;
        return value || allImageModels(s.managedProviderId)[0] || (models.gpt || 'gpt-image-2');
    }

    function imageModelOptions(selectedModel, providerId) {
        if (!imageApiProviders().length) {
            var label = window.tr ? window.tr('canvas.noApiProvidersHint') : '暂无 API 平台，请到 API 设置添加';
            return '<option value="" disabled selected>' + (label || '暂无 API 平台，请到 API 设置添加') + '</option>';
        }
        var models = allImageModels(providerId);
        if (!models.length) {
            var label = window.tr ? window.tr('canvas.noImageModelsHint') : '暂无生图模型，请到 API 设置添加';
            return '<option value="" disabled selected>' + (label || '暂无生图模型，请到 API 设置添加') + '</option>';
        }
        var selectedValue = resolveImageModel(selectedModel);
        var options = models.map(function (m) {
            var escaped = window.escapeHtml ? window.escapeHtml(m) : m;
            return '<option value="' + escaped + '" ' + (m === selectedValue ? 'selected' : '') + '>' + escaped + '</option>';
        }).join('');
        var hasSelected = models.indexOf(selectedValue) !== -1;
        return (hasSelected || !selectedValue ? '' : '<option value="' + (window.escapeHtml ? window.escapeHtml(selectedValue) : selectedValue) + '" selected>' + (window.escapeHtml ? window.escapeHtml(selectedValue) : selectedValue) + '</option>') + options;
    }

    // ── 视频平台 ─────────────────────────────────────────────

    function videoApiProviders() {
        var s = S();
        var all = (s.apiProviders && s.apiProviders.length) ? s.apiProviders : defaults();
        var providers = all.filter(function (p) {
            return p.id !== 'modelscope' && !isRunningHubProvider(p) && p.enabled !== false;
        });
        return providers.length ? providers : defaults();
    }

    function resolveVideoProviderId(id) {
        var providers = videoApiProviders();
        var found = providers.find(function (p) { return p.id === id; });
        return (found && found.id) || (providers[0] && providers[0].id) || 'comfly';
    }

    function videoProviderOptions(selectedId) {
        var selected = resolveVideoProviderId(selectedId);
        return videoApiProviders().map(function (provider) {
            var escapedId = window.escapeHtml ? window.escapeHtml(provider.id) : provider.id;
            var escapedName = window.escapeHtml ? window.escapeHtml(provider.name || provider.id) : (provider.name || provider.id);
            return '<option value="' + escapedId + '" ' + (provider.id === selected ? 'selected' : '') + '>' + escapedName + '</option>';
        }).join('');
    }

    function providerVideoModels(providerId) {
        var s = S();
        var provider = (s.apiProviders || []).find(function (p) { return p.id === providerId; });
        return U.uniqueModels ? U.uniqueModels(provider && provider.video_models || []) : (provider && provider.video_models || []);
    }

    function videoModelOptions(selectedModel, providerId) {
        var models = providerVideoModels(providerId);
        if (!models.length) {
            var label = window.tr ? window.tr('canvas.noModelsHint') : '暂无模型，请到 API 设置添加';
            return '<option value="" disabled selected>' + (label || '暂无模型') + '</option>';
        }
        var selected = selectedModel || models[0];
        var combined = U.uniqueModels ? U.uniqueModels([selected].concat(models)) : models;
        return combined.filter(Boolean).map(function (model) {
            var escaped = window.escapeHtml ? window.escapeHtml(model) : model;
            return '<option value="' + escaped + '" ' + (model === selected ? 'selected' : '') + '>' + escaped + '</option>';
        }).join('');
    }

    // ── 对话平台 ─────────────────────────────────────────────

    function chatApiProviders() {
        var s = S();
        var all = (s.apiProviders && s.apiProviders.length) ? s.apiProviders : defaults();
        var providers = all.filter(function (p) {
            return p.enabled !== false && (p.chat_models || []).length;
        });
        return providers.length ? providers : defaults();
    }

    function resolveChatProviderId(id) {
        var providers = chatApiProviders();
        var found = providers.find(function (p) { return p.id === id; });
        return (found && found.id) || (providers[0] && providers[0].id) || 'comfly';
    }

    function chatProviderOptions(selectedId) {
        var selected = resolveChatProviderId(selectedId);
        return chatApiProviders().map(function (provider) {
            var escapedId = window.escapeHtml ? window.escapeHtml(provider.id) : provider.id;
            var escapedName = window.escapeHtml ? window.escapeHtml(provider.name || provider.id) : (provider.name || provider.id);
            return '<option value="' + escapedId + '" ' + (provider.id === selected ? 'selected' : '') + '>' + escapedName + '</option>';
        }).join('');
    }

    function providerChatModels(providerId) {
        var s = S();
        var provider = (s.apiProviders || []).find(function (p) { return p.id === providerId; });
        return U.uniqueModels ? U.uniqueModels(provider && provider.chat_models || []) : (provider && provider.chat_models || []);
    }

    function allChatModels() {
        var s = S();
        var providers = chatApiProviders();
        var providerModels = [];
        providers.forEach(function (p) { providerModels = providerModels.concat(p.chat_models || []); });
        if (s.hasManagedChatModels) {
            return U.uniqueModels ? U.uniqueModels(s.localChatModels || []) : (s.localChatModels || []);
        }
        var combined = providerModels.concat(s.chatModels || []).concat(s.localChatModels || []);
        return U.uniqueModels ? U.uniqueModels(combined) : combined;
    }

    function resolveChatModel(value, providerId) {
        var providerModels = providerId ? providerChatModels(providerId) : [];
        return value || providerModels[0] || allChatModels()[0] || 'gpt-4o-mini';
    }

    function chatModelOptions(selectedModel, providerId) {
        var models = providerId ? providerChatModels(providerId) : allChatModels();
        var selectedValue = resolveChatModel(selectedModel, providerId);
        if (!models.length) {
            var label = window.tr ? window.tr('canvas.noModelsHint') : '暂无模型';
            return '<option value="" disabled selected>' + (label || '暂无模型，请到 API 设置添加') + '</option>';
        }
        var options = models.map(function (m) {
            var escaped = window.escapeHtml ? window.escapeHtml(m) : m;
            return '<option value="' + escaped + '" ' + (m === selectedValue ? 'selected' : '') + '>' + escaped + '</option>';
        }).join('');
        var hasSelected = models.indexOf(selectedValue) !== -1;
        return (hasSelected || !selectedValue ? '' : '<option value="' + (window.escapeHtml ? window.escapeHtml(selectedValue) : selectedValue) + '" selected>' + (window.escapeHtml ? window.escapeHtml(selectedValue) : selectedValue) + '</option>') + options;
    }

    function msChatModelOptions(selected) {
        var s = S();
        var msProvider = (s.apiProviders || []).find(function (p) { return p.id === 'modelscope'; });
        var list = U.uniqueModels ? U.uniqueModels((msProvider && msProvider.chat_models) || []) : ((msProvider && msProvider.chat_models) || []);
        if (!list.length) {
            var label = window.tr ? window.tr('canvas.noModelsHint') : '暂无模型，请到 API 设置添加';
            return '<option value="" disabled selected>' + (label || '暂无模型') + '</option>';
        }
        var sel = selected && list.indexOf(selected) !== -1 ? selected : list[0];
        return list.map(function (m) {
            var short = m.split('/').pop().split(':')[0];
            var escaped = window.escapeHtml ? window.escapeHtml(m) : m;
            return '<option value="' + escaped + '" ' + (m === sel ? 'selected' : '') + '>' + (window.escapeHtml ? window.escapeHtml(short) : short) + '</option>';
        }).join('');
    }

    // ── ModelScope ───────────────────────────────────────────

    function modelscopeImageModels(selected) {
        if (!selected) selected = '';
        var s = S();
        var provider = (s.apiProviders && s.apiProviders.length ? s.apiProviders : []).find(function (p) { return p.id === 'modelscope'; });
        var list = [];
        if (selected) list.push(selected);
        var pModels = (provider && provider.image_models) || [];
        list = list.concat(pModels.length ? pModels : []).concat(['Tongyi-MAI/Z-Image-Turbo', 'black-forest-labs/FLUX.2-klein-9B']);
        return U.uniqueModels ? U.uniqueModels(list) : list;
    }

    function modelscopeImageModelOptions(selectedModel) {
        var selectedValue = selectedModel || modelscopeImageModels()[0] || 'Tongyi-MAI/Z-Image-Turbo';
        return modelscopeImageModels(selectedValue).map(function (model) {
            var escaped = window.escapeHtml ? window.escapeHtml(model) : model;
            return '<option value="' + escaped + '" ' + (model === selectedValue ? 'selected' : '') + '>' + escaped + '</option>';
        }).join('');
    }

    function currentMsModelId(modelKey, node) {
        if (modelKey === 'custom') return (node && node.msCustomModel) || modelscopeImageModels()[0] || 'Tongyi-MAI/Z-Image-Turbo';
        return ((MS_GEN_MODELS[modelKey] || MS_GEN_MODELS.zimage)).modelId;
    }

    function modelscopeLorasForModel(modelId) {
        var s = S();
        var provider = (s.apiProviders && s.apiProviders.length ? s.apiProviders : []).find(function (p) { return p.id === 'modelscope'; });
        var list = Array.isArray(provider && provider.ms_loras) ? provider.ms_loras : [];
        return list.filter(function (lora) {
            return lora && lora.enabled !== false &&
                String(lora.id || '').trim() &&
                String(lora.target_model || lora.model || '').trim() === String(modelId || '').trim();
        });
    }

    function modelscopeLoraOptions(loras, selectedId) {
        return loras.map(function (lora) {
            var id = String(lora.id || '').trim();
            var label = String(lora.name || id).trim();
            var escapedId = window.escapeHtml ? window.escapeHtml(id) : id;
            var escapedLabel = window.escapeHtml ? window.escapeHtml(label) : label;
            return '<option value="' + escapedId + '" ' + (id === selectedId ? 'selected' : '') + '>' + escapedLabel + '</option>';
        }).join('');
    }

    // ── 向后兼容：挂到 window ──────────────────────────────

    var exports = {
        isRunningHubProvider: isRunningHubProvider,
        imageApiProviders: imageApiProviders,
        providerById: providerById,
        resolveProviderId: resolveProviderId,
        resolveImageProviderId: resolveImageProviderId,
        providerOptions: providerOptions,
        providerImageModels: providerImageModels,
        allImageModels: allImageModels,
        resolveImageModel: resolveImageModel,
        imageModelOptions: imageModelOptions,
        videoApiProviders: videoApiProviders,
        resolveVideoProviderId: resolveVideoProviderId,
        videoProviderOptions: videoProviderOptions,
        providerVideoModels: providerVideoModels,
        videoModelOptions: videoModelOptions,
        chatApiProviders: chatApiProviders,
        resolveChatProviderId: resolveChatProviderId,
        chatProviderOptions: chatProviderOptions,
        providerChatModels: providerChatModels,
        allChatModels: allChatModels,
        resolveChatModel: resolveChatModel,
        chatModelOptions: chatModelOptions,
        msChatModelOptions: msChatModelOptions,
        modelscopeImageModels: modelscopeImageModels,
        modelscopeImageModelOptions: modelscopeImageModelOptions,
        currentMsModelId: currentMsModelId,
        modelscopeLorasForModel: modelscopeLorasForModel,
        modelscopeLoraOptions: modelscopeLoraOptions,
        // 也需要暴露给外部
        MS_GEN_MODELS: MS_GEN_MODELS
    };

    window.CanvasProviders = exports;

    Object.keys(exports).forEach(function (key) {
        if (typeof window[key] === 'undefined') {
            window[key] = exports[key];
        }
    });

})();
