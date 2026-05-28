/**
 * RunningHub 引擎集成模块。
 * 从 window.CanvasState 读取共享状态，通过 window.CanvasApi 调用画布内部函数。
 *
 * 外部依赖（通过 window 访问）：
 *   - window.CanvasState    (canvas.js syncCanvasState)
 *   - window.CanvasUtils    (utils.js)
 *   - window.CanvasApi      (canvas.js 桥接函数)
 *   - window.tr              (common.js)
 *   - window.escapeHtml      (common.js)
 *   - window.escapeAttr      (common.js)
 */
(function () {
    'use strict';

    var S = function () { return window.CanvasState || {}; };
    function A() { return window.CanvasApi || {}; }
    var U = window.CanvasUtils || {};

    // ── 常量 ─────────────────────────────────────────────────

    var RH_KNOWN_FIELD_OPTIONS = {
        aspectRatio: ['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3','21:9','9:21'],
        aspect_ratio: ['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3','21:9','9:21'],
        ratio: ['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3'],
        resolution: ['1k','2k','4k','8k'],
        size: ['512','768','1024','1280','1536','2048'],
        mode: ['text2img','img2img'],
        quality: ['low','medium','high','best'],
        instanceType: ['default','plus','pro'],
        instance_type: ['default','plus','pro'],
        precision: ['fp16','fp32','bf16'],
        scheduler: ['normal','karras','exponential','sgm_uniform','simple','ddim_uniform'],
        sampler: ['euler','euler_ancestral','heun','dpm_2','dpm_2_ancestral','lms','dpmpp_2m','dpmpp_sde','ddim','uni_pc']
    };

    // ── 参数键值 ─────────────────────────────────────────────

    function rhParamKey(nodeId, fieldName) {
        return (nodeId || '') + '::' + (fieldName || '');
    }

    function rhFieldKind(field) {
        var type = String((field && field.fieldType) || '').trim().toUpperCase();
        if (type === 'IMAGE') return 'image';
        if (type === 'VIDEO') return 'video';
        if (type === 'AUDIO') return 'audio';
        return 'setting';
    }

    function rhFieldRole(field) {
        var kind = rhFieldKind(field);
        if (['image','video','audio'].indexOf(kind) !== -1) return kind;
        var key = String((field && (field.input || '')) + ' ' + (field && (field.name || '')) + ' ' + (field && (field.fieldName || '')) + ' ' + (field && (field.label || ''))).toLowerCase();
        if (field && field.type === 'textarea') return 'prompt';
        if (/prompt|text|提示词|正向|负向/.test(key)) return 'prompt';
        if (field && field.type === 'boolean') return 'boolean';
        if (field && (field.type === 'number' || field.type === 'slider')) return 'number';
        return 'text';
    }

    function rhExtractFieldOptions(field) {
        if (!field) return null;
        if (Array.isArray(field.values) && field.values.length) return field.values;
        if (Array.isArray(field.options) && field.options.length) return field.options;
        var key = String((field.fieldName || '') + ' ' + (field.name || '') + ' ' + (field.label || '')).toLowerCase();
        var merged = [];
        for (var k in RH_KNOWN_FIELD_OPTIONS) {
            if (Object.prototype.hasOwnProperty.call(RH_KNOWN_FIELD_OPTIONS, k) && key.indexOf(k.toLowerCase()) !== -1) {
                merged = merged.concat(RH_KNOWN_FIELD_OPTIONS[k]);
            }
        }
        if (merged.length) return U.uniqueValues ? U.uniqueValues(merged) : merged;
        return null;
    }

    function rhDefaultValue(field) {
        if (!field) return '';
        if (field['default'] !== undefined && field['default'] !== null) return field['default'];
        if (field.type === 'boolean') return false;
        if (field.type === 'number' || field.type === 'slider') return 0;
        return '';
    }

    function rhRandomEnabled(field) {
        return field && (field.type === 'number' || field.type === 'slider') && field.random_enabled === true;
    }

    function rhRandomActive(node, key) {
        if (!node) return true;
        node.rhRandomActive = node.rhRandomActive || {};
        return node.rhRandomActive[key] !== false;
    }

    function rhRequiredLabel(field) {
        return (field && field.label) || (field && field.fieldName) || '#' + ((field && field.nodeId) || '');
    }

    // ── 字段查询 ─────────────────────────────────────────────

    function rhWorkflowNodeInfoList(data) {
        if (!data || typeof data !== 'object') return [];
        var isArrayLike = Array.isArray(data);
        if (isArrayLike && data.every(function (item) { return item && item.nodeId && item.fieldName; })) return data;
        var entries = isArrayLike ? [] : Object.entries(data);
        return entries.map(function (_a) {
            var nodeId = _a[0], node = _a[1];
            if (!node || !node.inputs || typeof node.inputs !== 'object') return [];
            return Object.keys(node.inputs).map(function (fieldName) {
                return { nodeId: String(nodeId), fieldName: fieldName, input: node.inputs[fieldName] };
            });
        }).flat().filter(function (f) { return f && f.nodeId && f.fieldName; });
    }

    function rhInferWorkflowFieldType(fieldName, fieldValue) {
        var name = String(fieldName || '').toLowerCase();
        if (name.indexOf('prompt') !== -1 || name.indexOf('text') !== -1) return 'textarea';
        if (name.indexOf('seed') !== -1 || name.indexOf('noise') !== -1) return 'number';
        var val = String(fieldValue || '');
        if (/^https?:\/\//i.test(val)) return 'text';
        if (val && !isNaN(Number(val)) && val.trim() !== '') return 'number';
        return 'text';
    }

    function rhIsWorkflowLinkValue(value) {
        return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && !isNaN(Number(value[0]));
    }

    // ── Provider 访问 ────────────────────────────────────────

    function runningHubProvider() {
        var s = S();
        return (s.apiProviders || []).find(function (p) { return (p.id || '').toLowerCase() === 'runninghub'; }) || null;
    }

    function runningHubEntries(kind) {
        var provider = runningHubProvider();
        if (!provider) return [];
        if (kind === 'app') return Array.isArray(provider.rh_webapps) ? provider.rh_webapps : [];
        if (kind === 'workflow') return Array.isArray(provider.rh_workflows) ? provider.rh_workflows : [];
        return [];
    }

    function runningHubEntryId(entry, kind) {
        if (!entry) return '';
        return String(entry.workflowId || entry.webappId || entry.id || '').trim();
    }

    function runningHubEntryLabel(entry, kind) {
        if (!entry) return '';
        return String(entry.title || entry.name || runningHubEntryId(entry, kind) || '').trim();
    }

    function runningHubEntryKey(kind, id) {
        return (kind || '') + ':' + (id || '');
    }

    function parseRunningHubEntryKey(value) {
        var text = String(value || '').trim();
        var match = text.match(/^(app|workflow):(.+)$/);
        if (match) return { kind: match[1], id: match[2] };
        return null;
    }

    function runningHubAllEntries() {
        var apps = runningHubEntries('app').map(function (entry) { return { kind: 'app', id: runningHubEntryId(entry, 'app'), entry: entry }; });
        var workflows = runningHubEntries('workflow').map(function (entry) { return { kind: 'workflow', id: runningHubEntryId(entry, 'workflow'), entry: entry }; });
        return apps.concat(workflows).filter(function (item) { return item.id; });
    }

    // ── 条目管理 ─────────────────────────────────────────────

    function rhSelectedEntryRef(node) {
        if (!node) return null;
        var parsed = parseRunningHubEntryKey(node.rhConfigKey || '');
        var all = runningHubAllEntries();
        if (parsed) {
            var hit = all.find(function (item) { return item.kind === parsed.kind && item.id === parsed.id; });
            if (hit) return hit;
        }
        var workflowId = validRunningHubWorkflowId(node.workflowId || '');
        if (workflowId) {
            var wfHit = all.find(function (item) { return item.kind === 'workflow' && item.id === workflowId; });
            if (wfHit) return wfHit;
        }
        var webappId = String(node.webappId || '').trim();
        if (webappId) {
            var appHit = all.find(function (item) { return item.kind === 'app' && item.id === webappId; });
            if (appHit) return appHit;
        }
        return null;
    }

    function applyRhEntrySelection(node, ref) {
        if (!node || !ref) return;
        node.rhConfigKey = runningHubEntryKey(ref.kind, ref.id);
        node.rhMode = ref.kind;
        if (ref.kind === 'workflow') node.workflowId = ref.id;
        else node.webappId = ref.id;
    }

    function rhEntryFields(entry) {
        return Array.isArray((entry || {}).fields) ? entry.fields : [];
    }

    function rhWorkflowJsonFromSources() {
        for (var i = 0; i < arguments.length; i++) {
            var source = arguments[i];
            if (source && typeof source === 'object' && Object.keys(source).length) return source;
        }
        return {};
    }

    function rhCurrentEntry(node) {
        var ref = rhSelectedEntryRef(node);
        return (ref && ref.entry) || null;
    }

    function rhCurrentKind(node) {
        var ref = rhSelectedEntryRef(node);
        return (ref && ref.kind) || (node && node.rhMode === 'workflow' ? 'workflow' : 'app');
    }

    function ensureRhNodeSelection(node) {
        if (!node || node.type !== 'rh') return null;
        node.rhPayment = node.rhPayment || 'free';
        var all = runningHubAllEntries();
        var ref = rhSelectedEntryRef(node);
        if (!ref && all.length) ref = all[0];
        if (ref) {
            applyRhEntrySelection(node, ref);
            return ref.entry;
        }
        return null;
    }

    function rhEntryOptions(selected) {
        var apps = runningHubEntries('app');
        var workflows = runningHubEntries('workflow');
        if (!apps.length && !workflows.length) return '<option value="">请先在 API 设置里添加 RH 配置</option>';
        var escHtml = window.escapeHtml || function (s) { return s; };
        var escAttr = window.escapeAttr || function (s) { return s; };
        function group(kind, entries, label) {
            if (!entries.length) return '';
            return '<optgroup label="' + label + '">' +
                entries.map(function (entry) {
                    var id = runningHubEntryId(entry, kind);
                    var key = runningHubEntryKey(kind, id);
                    return '<option value="' + escAttr(key) + '" ' + (String(selected || '') === key ? 'selected' : '') + '>' + escHtml(runningHubEntryLabel(entry, kind)) + '</option>';
                }).join('') +
                '</optgroup>';
        }
        return group('app', apps, 'AI 应用') + group('workflow', workflows, '工作流');
    }

    function rhPaymentOptions(node) {
        var provider = runningHubProvider();
        var selected = node && node.rhPayment === 'wallet' ? 'wallet' : 'free';
        return '<option value="free" ' + (selected === 'free' ? 'selected' : '') + '>RH币 Key' + (provider && provider.has_key ? '' : '（未配置）') + '</option>' +
            '<option value="wallet" ' + (selected === 'wallet' ? 'selected' : '') + '>账户余额 Key' + (provider && provider.has_wallet_key ? '' : '（未配置）') + '</option>';
    }

    function rhUseWallet(node) {
        return node && node.rhPayment === 'wallet';
    }

    // ── 有效字段 ─────────────────────────────────────────────

    function validRunningHubWorkflowId(workflowId) {
        return String(workflowId || '').trim();
    }

    function currentRunningHubWorkflow(node) {
        if (!node) return null;
        var s = S();
        var workflowId = validRunningHubWorkflowId(node.workflowId || '');
        return (s.runningHubWorkflowCache || {})[workflowId] || null;
    }

    function currentRunningHubAppConfig(node) {
        var webappId = String((node && node.webappId) || '').trim();
        if (!webappId) return null;
        return runningHubEntries('app').find(function (app) { return runningHubEntryId(app, 'app') === webappId; }) || null;
    }

    function currentRunningHubWorkflowEntry(node) {
        var workflowId = validRunningHubWorkflowId((node && node.workflowId) || '');
        if (!workflowId) return null;
        return runningHubEntries('workflow').find(function (wf) { return runningHubEntryId(wf, 'workflow') === workflowId; }) || null;
    }

    function currentRunningHubWorkflowConfig(node) {
        if (rhCurrentKind(node) !== 'workflow') return null;
        var workflowId = validRunningHubWorkflowId((node && node.workflowId) || '');
        var entry = currentRunningHubWorkflowEntry(node);
        var s = S();
        if (entry) {
            var cached = workflowId ? (s.runningHubWorkflowCache || {})[workflowId] : null;
            return Object.assign({}, entry, cached || {}, {
                workflowId: runningHubEntryId(entry, 'workflow') || workflowId,
                title: entry.title || (cached && cached.title) || workflowId,
                fields: rhEntryFields(entry).length ? rhEntryFields(entry) : ((cached && cached.fields) || []),
                optionalImageMode: entry.optionalImageMode || (cached && cached.optionalImageMode) || 'prune-workflow',
                workflowJson: rhWorkflowJsonFromSources(cached && cached.workflowJson, entry.workflowJson, entry.raw && entry.raw.workflowJson, entry.raw && entry.raw.prompt)
            });
        }
        return workflowId ? (s.runningHubWorkflowCache || {})[workflowId] : null;
    }

    function rhActiveFields(node) {
        var sortFields = function (fields) {
            var sorted = (fields || []).slice().sort(function (a, b) {
                var ak = rhFieldKind(a), bk = rhFieldKind(b);
                if (ak === 'image' && bk === 'image') {
                    var ao = Number(a.imageOrder) || 9999;
                    var bo = Number(b.imageOrder) || 9999;
                    if (ao !== bo) return ao - bo;
                }
                if (ak === 'image' && bk !== 'image') return -1;
                if (ak !== 'image' && bk === 'image') return 1;
                return String(a.nodeId || '').localeCompare(String(b.nodeId || ''), undefined, { numeric: true }) || String(a.fieldName || '').localeCompare(String(b.fieldName || ''));
            });
            return sorted;
        };
        var s = S();
        if (rhCurrentKind(node) === 'workflow') {
            var workflowId = validRunningHubWorkflowId((node && node.workflowId) || '');
            var savedEntry = currentRunningHubWorkflowEntry(node);
            if (Array.isArray(savedEntry && savedEntry.fields) && savedEntry.fields.length) return sortFields(savedEntry.fields.filter(function (f) { return f.enabled === true; }));
            var saved = workflowId ? (s.runningHubWorkflowCache || {})[workflowId] : null;
            if (Array.isArray(saved && saved.fields)) return sortFields(saved.fields.filter(function (f) { return f.enabled === true; }));
            return sortFields((node && node.rhWorkflowInfo && node.rhWorkflowInfo.nodeInfoList) || []);
        }
        var savedApp = currentRunningHubAppConfig(node);
        if (Array.isArray(savedApp && savedApp.fields) && savedApp.fields.length) return sortFields(savedApp.fields.filter(function (f) { return f.enabled === true; }));
        return sortFields((node && node.rhAppInfo && node.rhAppInfo.nodeInfoList) || []);
    }

    // ── 媒体源 ───────────────────────────────────────────────

    function rhMediaSources(node) {
        var sources = A().orderedSources ? A().orderedSources(node, A().generatorSources ? A().generatorSources(node) : []) : [];
        var refs = [];
        sources.forEach(function (src) {
            if (src.refs) refs = refs.concat(src.refs.filter(function (r) { return r && r.url; }));
        });
        var imageRefsOnlyFn = window.imageRefsOnly || function (r) { return r; };
        var videoRefsOnlyFn = window.videoRefsOnly || function (r) { return r; };
        var audioRefsOnlyFn = window.audioRefsOnly || function (r) { return r; };
        return {
            sources: sources,
            refs: refs,
            image: imageRefsOnlyFn(refs),
            video: videoRefsOnlyFn(refs),
            audio: audioRefsOnlyFn(refs),
            prompt: sources.map(function (src) { return src.prompt; }).filter(Boolean).join('\n\n')
        };
    }

    // ── 字段值 ───────────────────────────────────────────────

    function rhFieldIndexes(fields) {
        var counters = { image: 0, video: 0, audio: 0 };
        var map = {};
        var ordered = (fields || []).slice().sort(function (a, b) {
            var ak = rhFieldKind(a), bk = rhFieldKind(b);
            if (ak === 'image' && bk === 'image') {
                return (Number(a.imageOrder) || 9999) - (Number(b.imageOrder) || 9999);
            }
            return 0;
        });
        ordered.forEach(function (field) {
            var kind = rhFieldKind(field);
            if (['image', 'video', 'audio'].indexOf(kind) !== -1) {
                map[rhParamKey(field.nodeId, field.fieldName)] = counters[kind]++;
            }
        });
        return map;
    }

    function rhFieldValue(node, field, media) {
        if (!node) return '';
        node.rhParams = node.rhParams || {};
        var key = rhParamKey(field.nodeId, field.fieldName);
        var kind = rhFieldKind(field);
        var param = node.rhParams[key];
        if (['image', 'video', 'audio'].indexOf(kind) !== -1) {
            var idx = (rhFieldIndexes(rhActiveFields(node))[key] || 0);
            var mediaSrc = media || rhMediaSources(node);
            var up = (mediaSrc[kind] && mediaSrc[kind][idx] && mediaSrc[kind][idx].url) || '';
            if (rhCurrentKind(node) === 'workflow' && kind === 'image' && field.required !== true && !up && param && param.sourceFromUpstream !== false) return '';
            if (param && param.sourceFromUpstream === false) return param.value !== undefined ? param.value : rhDefaultValue(field);
            return up || (param && param.value) || rhDefaultValue(field);
        }
        if (rhRandomEnabled(field) && rhRandomActive(node, key)) {
            node.rhRandomValues = node.rhRandomValues || {};
            if (node.rhRandomValues[key] === undefined) {
                node.rhRandomValues[key] = comfyRandomValueFn({
                    input: field.fieldName,
                    name: field.label || field.fieldName,
                    min: field.min,
                    max: field.max,
                    step: field.step,
                    type: 'number'
                });
            }
            return node.rhRandomValues[key];
        }
        if (rhFieldRole(field) === 'prompt') {
            var upstreamPrompt = (media || rhMediaSources(node)).prompt || '';
            return (param && param.value !== undefined ? param.value : (upstreamPrompt || rhDefaultValue(field)));
        }
        return (param && param.value !== undefined ? param.value : rhDefaultValue(field));
    }

    // re-use comfyRandomValue logic for RH
    function comfyRandomValueFn(field) {
        var step = Number(field && field.step);
        var isFloat = step > 0 && step < 1;
        var min = isFinite(Number(field && field.min)) ? Number(field.min) : null;
        var max = isFinite(Number(field && field.max)) ? Number(field.max) : null;
        var name = String((field && field.input || '') + ' ' + (field && field.name || '')).toLowerCase();
        var looksSeed = name.indexOf('seed') !== -1 || name.indexOf('noise') !== -1;
        if (min === null) min = looksSeed ? 1 : 0;
        if (max === null || max <= min) max = looksSeed ? 1000000000000000 : 999999;
        var value = min + Math.random() * (max - min);
        if (isFloat) {
            var precision = Math.min(8, Math.max(1, (String(field && field.step).split('.')[1] || '').length || 2));
            return Number(value.toFixed(precision));
        }
        return Math.floor(value);
    }

    function rhPruneWorkflowForMissingFields(workflowJson, missingFields) {
        if (!workflowJson || typeof workflowJson !== 'object' || !(missingFields && missingFields.length)) return null;
        var workflow = JSON.parse(JSON.stringify(workflowJson));
        var removeIds = {};
        missingFields.forEach(function (field) {
            var node = workflow[String(field.nodeId)];
            if (node && node.inputs && Object.prototype.hasOwnProperty.call(node.inputs, field.fieldName)) {
                delete node.inputs[field.fieldName];
            }
            if (node && rhWorkflowNodeInfoList((_a = {}, _a[field.nodeId] = node, _a)).length <= 0) {
                removeIds[String(field.nodeId)] = true;
            }
        });
        Object.keys(removeIds).forEach(function (id) { delete workflow[id]; });
        Object.values(workflow).forEach(function (node) {
            if (!node || !node.inputs || typeof node.inputs !== 'object') return;
            Object.entries(node.inputs).forEach(function (_a) {
                var name = _a[0], value = _a[1];
                if (rhIsWorkflowLinkValue(value) && removeIds[String(value[0])]) delete node.inputs[name];
            });
        });
        return workflow;
        var _a;
    }

    // ── 渲染 ─────────────────────────────────────────────────

    function rhMediaPreviewHtml(ref, kind) {
        var escAttr = window.escapeAttr || function (s) { return s; };
        var safe = escAttr((ref && ref.url) || '');
        if (kind === 'video') return '<video src="' + safe + '" muted preload="metadata" playsinline disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"></video>';
        if (kind === 'audio') return '<i data-lucide="file-audio" class="w-6 h-6 text-slate-400"></i>';
        if (safe && !(A().isMissingAssetUrl && A().isMissingAssetUrl(safe))) return '<img src="' + safe + '">';
        return '<i data-lucide="image" class="w-6 h-6 text-slate-400"></i>';
    }

    function renderRhBody(node) {
        var escHtml = window.escapeHtml || function (s) { return s; };
        var escAttr = window.escapeAttr || function (s) { return s; };
        var tr = window.tr || function (s) { return s; };
        var wrap = document.createElement('div');
        wrap.className = 'rh-body';
        node.rhParams = node.rhParams || {};
        var entry = ensureRhNodeSelection(node);
        var selectedRef = rhSelectedEntryRef(node);
        var media = rhMediaSources(node);
        var fields = rhActiveFields(node);
        var mode = (selectedRef && selectedRef.kind) || rhCurrentKind(node);
        var selectedId = (selectedRef && selectedRef.id) || (mode === 'workflow' ? (node.workflowId || '') : (node.webappId || ''));
        var selectedKey = selectedRef ? runningHubEntryKey(selectedRef.kind, selectedRef.id) : '';
        var entryNote = (entry && entry.note) || (entry && entry.description) || '';
        wrap.innerHTML = '<div class="rh-top">' +
            '<label class="field rh-webapp-field"><div class="setting-title">RunningHub 配置</div><select class="select-lite rh-entry-select">' + rhEntryOptions(selectedKey) + '</select></label>' +
            '<label class="field rh-payment-field"><div class="setting-title">Key</div><select class="select-lite rh-payment-select">' + rhPaymentOptions(node) + '</select></label>' +
            '<label class="field rh-machine-field"><div class="setting-title">显存</div><select class="select-lite rh-machine-select"><option value="" ' + (!node.instanceType ? 'selected' : '') + '>24G</option><option value="plus" ' + (node.instanceType === 'plus' ? 'selected' : '') + '>48G</option></select></label>' +
            '</div>' +
            '<div class="rh-prompt-list"></div>' +
            '<div class="rh-media-section"><div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">' + tr('canvas.rhInputs') + '</div><div class="input-list rh-input-list"></div></div>' +
            '<div class="rh-param-head"><span>' + (mode === 'workflow' ? tr('canvas.rhWorkflowParams') : tr('canvas.rhParams')) + '</span><span>' + fields.length + '</span></div>' +
            '<div class="rh-param-list"></div>' +
            '<div class="gen-run-row"><button class="gen-btn rh-run ' + (node.running ? 'running' : '') + '" ' + (node.running ? 'disabled' : '') + '><i data-lucide="workflow" class="w-4 h-4"></i>' + (node.running ? tr('canvas.rhRunning') : tr('canvas.rhRun')) + '</button>' +
            (A().cascadeBtnHtml ? A().cascadeBtnHtml(node) : '') + '</div>' +
            (A().retryBarHtml ? A().retryBarHtml(node) : '');

        var entrySelect = wrap.querySelector('.rh-entry-select');
        if (entrySelect) entrySelect.onchange = function (e) {
            var parsed = parseRunningHubEntryKey(e.target.value);
            var ref = parsed ? runningHubAllEntries().find(function (item) { return item.kind === parsed.kind && item.id === parsed.id; }) : null;
            if (ref) applyRhEntrySelection(node, ref);
            node.rhParams = {};
            node.rhRandomValues = {};
            if (A().render) A().render();
            if (A().scheduleSave) A().scheduleSave();
        };
        var paymentSelect = wrap.querySelector('.rh-payment-select');
        if (paymentSelect) paymentSelect.onchange = function () {
            node.rhPayment = paymentSelect.value === 'wallet' ? 'wallet' : 'free';
            if (A().scheduleSave) A().scheduleSave();
        };
        var machineSelect = wrap.querySelector('.rh-machine-select');
        if (machineSelect) machineSelect.onchange = function () {
            node.instanceType = machineSelect.value === 'plus' ? 'plus' : '';
            if (A().scheduleSave) A().scheduleSave();
        };
        renderRhPromptFields(wrap.querySelector('.rh-prompt-list'), node, fields);
        renderRhInputs(wrap.querySelector('.rh-input-list'), node, media);
        renderRhParams(wrap.querySelector('.rh-param-list'), node, fields, media);
        var runBtn = wrap.querySelector('.rh-run');
        if (runBtn) runBtn.onclick = function (e) { e.stopPropagation(); if (A().runCanvasGenerate) A().runCanvasGenerate(node.id); };
        if (A().bindCascadeButtons) A().bindCascadeButtons(wrap, node.id);
        if (window.lucide) window.lucide.createIcons();
        return wrap;
    }

    function renderRhInputs(list, node, media) {
        if (!list) return;
        var escHtml = window.escapeHtml || function (s) { return s; };
        var tr = window.tr || function (s) { return s; };
        var refs = media.refs || [];
        if (!refs.length) {
            list.innerHTML = '<div class="text-[11px] text-gray-300 py-2">' + tr('canvas.groupEmpty') + '</div>';
            return;
        }
        list.innerHTML = '';
        refs.forEach(function (ref, i) {
            var kind = window.mediaKindForRef ? window.mediaKindForRef(ref) : 'image';
            var item = document.createElement('div');
            item.className = 'input-item rh-input-item';
            item.innerHTML = '<span class="input-index">' + (i + 1) + '</span>' + rhMediaPreviewHtml(ref, kind) + '<span class="input-label">' + escHtml(A().nodeTitleForMedia ? A().nodeTitleForMedia({ mediaKind: kind }) : kind) + '</span>';
            list.appendChild(item);
        });
    }

    function renderRhPromptFields(container, node, fields) {
        if (!container) return;
        var escHtml = window.escapeHtml || function (s) { return s; };
        var escAttr = window.escapeAttr || function (s) { return s; };
        var prompts = (fields || []).filter(function (field) { return rhFieldRole(field) === 'prompt'; });
        if (!prompts.length) { container.innerHTML = ''; return; }
        container.innerHTML = prompts.map(function (field) {
            var key = rhParamKey(field.nodeId, field.fieldName);
            var label = field.label || field.fieldName || 'Prompt';
            var value = rhFieldValue(node, field, rhMediaSources(node));
            return '<label class="field rh-prompt-field"><div class="setting-title">' + escHtml(label) + '</div><textarea class="setting-input rh-param-input" data-rh-param="' + escAttr(key) + '" data-rh-role="prompt">' + escHtml(value) + '</textarea></label>';
        }).join('');
        bindRhParamControls(container, node);
    }

    function renderRhParams(container, node, fields, media) {
        if (!container) return;
        var tr = window.tr || function (s) { return s; };
        var params = (fields || []).filter(function (field) {
            var role = rhFieldRole(field);
            return ['image', 'video', 'audio', 'prompt'].indexOf(role) === -1;
        });
        if (!params.length) {
            container.innerHTML = '<div class="rh-empty">' + tr('canvas.rhNoParams') + '</div>';
            return;
        }
        container.innerHTML = params.map(function (field, i) {
            var key = rhParamKey(field.nodeId, field.fieldName);
            var kind = rhFieldRole(field);
            var options = rhExtractFieldOptions(field);
            var value = rhFieldValue(node, field, media);
            var label = field.label || field.fieldName || 'Field ' + (i + 1);
            var valueText = String(value !== undefined ? value : '');
            var wide = kind === 'text' && (String(label).length > 18 || valueText.length > 28);
            return renderRhSettingField(node, field, key, kind, label, value, options, wide);
        }).join('');
        bindRhParamControls(container, node);
    }

    function renderRhSettingField(node, field, key, kind, label, value, options, wide) {
        var escHtml = window.escapeHtml || function (s) { return s; };
        var escAttr = window.escapeAttr || function (s) { return s; };
        var safeLabel = escHtml(label);
        if (kind === 'boolean') {
            var active = String(value).toLowerCase() === 'true';
            return '<div class="gen-settings-row rh-param-row' + (wide ? ' wide' : '') + '"><button type="button" class="setting-check ' + (active ? 'active' : '') + '" data-rh-param="' + escAttr(key) + '" data-rh-type="boolean"><span class="check-dot"></span>' + safeLabel + '</button></div>';
        }
        if (options && options.length) {
            return '<div class="gen-settings-row rh-param-row' + (wide ? ' wide' : '') + '"><label class="field"><div class="setting-title">' + safeLabel + '</div><select class="select-lite rh-param-input" data-rh-param="' + escAttr(key) + '" data-rh-type="select" style="width:100%">' + options.map(function (opt) { return '<option value="' + escAttr(opt) + '" ' + (String(value) === String(opt) ? 'selected' : '') + '>' + escHtml(opt) + '</option>'; }).join('') + '</select></label></div>';
        }
        if (rhRandomEnabled(field)) {
            var randomActive = rhRandomActive(node, key);
            return '<div class="gen-settings-row rh-param-row' + (wide ? ' wide' : '') + '"><div class="comfy-random-field"><label class="field"><div class="setting-title">' + safeLabel + '</div><input class="setting-input rh-param-input" type="number" data-rh-param="' + escAttr(key) + '" data-rh-type="number" value="' + escAttr(value) + '" ' + (randomActive ? 'disabled' : '') + '></label><button class="tool-btn comfy-random-btn ' + (randomActive ? 'active' : '') + '" type="button" data-rh-random="' + escAttr(key) + '" title="' + (randomActive ? '随机已开启，点击关闭' : '随机已关闭，点击开启') + '"><i data-lucide="dice-5" class="w-4 h-4"></i></button></div></div>';
        }
        var inputType = kind === 'number' ? 'number' : 'text';
        return '<div class="gen-settings-row rh-param-row' + (wide ? ' wide' : '') + '"><label class="field"><div class="setting-title">' + safeLabel + '</div><input class="setting-input rh-param-input" type="' + inputType + '" data-rh-param="' + escAttr(key) + '" data-rh-type="' + escAttr(kind) + '" value="' + escAttr(value) + '"></label></div>';
    }

    function bindRhParamControls(container, node) {
        container.querySelectorAll('button[data-rh-param]').forEach(function (btn) {
            btn.onmousedown = function (e) { e.stopPropagation(); };
            btn.onclick = function (e) {
                e.stopPropagation();
                var key = btn.dataset.rhParam;
                node.rhParams = node.rhParams || {};
                var field = rhActiveFields(node).find(function (f) { return rhParamKey(f.nodeId, f.fieldName) === key; });
                var cur = node.rhParams[key] || {};
                var on = String(rhFieldValue(node, field)).toLowerCase() === 'true';
                node.rhParams[key] = Object.assign({}, cur, { value: String(!on) });
                if (A().render) A().render();
                if (A().scheduleSave) A().scheduleSave();
            };
        });
        container.querySelectorAll('input[data-rh-param], select[data-rh-param], textarea[data-rh-param]').forEach(function (control) {
            control.onmousedown = function (e) { e.stopPropagation(); };
            control.onclick = function (e) { e.stopPropagation(); };
            control.oninput = control.onchange = function (e) {
                var key = control.dataset.rhParam;
                node.rhParams = node.rhParams || {};
                var cur = node.rhParams[key] || {};
                node.rhParams[key] = Object.assign({}, cur, { value: e.target.value });
                if (A().scheduleSave) A().scheduleSave();
            };
        });
        container.querySelectorAll('[data-rh-random]').forEach(function (btn) {
            btn.onmousedown = function (e) { e.stopPropagation(); };
            btn.onclick = function (e) {
                e.stopPropagation();
                toggleRhRandom(node.id, btn.dataset.rhRandom);
            };
        });
    }

    // ── 动作函数 ─────────────────────────────────────────────

    function toggleRhRandom(nodeId, key) {
        var s = S();
        var nodes = s.nodes || [];
        var node = nodes.find(function (n) { return n.id === nodeId; });
        if (!node) return;
        var field = rhActiveFields(node).find(function (f) { return rhParamKey(f.nodeId, f.fieldName) === key; });
        if (!rhRandomEnabled(field)) return;
        node.rhRandomActive = node.rhRandomActive || {};
        node.rhRandomActive[key] = !rhRandomActive(node, key);
        if (A().refreshNodes) A().refreshNodes([node.id]);
        if (A().scheduleSave) A().scheduleSave();
    }

    async function ensureRunningHubWorkflow(workflowId) {
        workflowId = validRunningHubWorkflowId(workflowId);
        if (!workflowId) return null;
        var s = S();
        var cache = s.runningHubWorkflowCache || {};
        if (cache[workflowId]) return cache[workflowId];
        var res = await fetch('/api/runninghub/workflows/' + encodeURIComponent(workflowId));
        if (!res.ok) { delete cache[workflowId]; return null; }
        var data = await res.json();
        cache[workflowId] = data.workflow || null;
        return cache[workflowId];
    }

    async function ensureRunningHubWorkflowConfigForNode(node) {
        if (rhCurrentKind(node) !== 'workflow') return null;
        var workflowId = validRunningHubWorkflowId((node && node.workflowId) || '');
        if (!workflowId) return null;
        var s = S();
        var cache = s.runningHubWorkflowCache || {};
        if (!cache[workflowId]) {
            try { await ensureRunningHubWorkflow(workflowId); } catch (_) {}
        }
        return currentRunningHubWorkflowConfig(node);
    }

    async function rhFetchAppInfo(nodeId, showAlert) {
        if (showAlert === undefined) showAlert = true;
        var s = S();
        var nodes = s.nodes || [];
        var node = nodes.find(function (n) { return n.id === nodeId; });
        if (!node) return;
        if (!String(node.webappId || '').trim()) {
            if (showAlert) alert((window.tr || function (s) { return s; })('canvas.rhNeedWebappId'));
            return false;
        }
        node.rhFetching = true;
        if (A().refreshNodes) A().refreshNodes([node.id]);
        try {
            var res = await fetch('/api/runninghub/app-info?webappId=' + encodeURIComponent(node.webappId.trim()));
            var data = await res.json();
            if (!res.ok || data.success === false) throw new Error(data.detail || data.error || 'RunningHub 请求失败');
            node.rhAppInfo = data.data || {};
            node.rhParams = node.rhParams || {};
            (node.rhAppInfo.nodeInfoList || []).forEach(function (field) {
                var key = rhParamKey(field.nodeId, field.fieldName);
                if (!node.rhParams[key]) node.rhParams[key] = { value: rhDefaultValue(field) };
            });
            node.runStatus = '';
            node.runError = '';
            if (A().scheduleSave) A().scheduleSave();
            return true;
        } catch (err) {
            if (showAlert) alert(err.message || 'RunningHub 请求失败');
            return false;
        } finally {
            node.rhFetching = false;
            if (A().refreshNodes) A().refreshNodes([node.id]);
        }
    }

    async function rhFetchWorkflowInfo(nodeId, showAlert) {
        if (showAlert === undefined) showAlert = true;
        var s = S();
        var nodes = s.nodes || [];
        var node = nodes.find(function (n) { return n.id === nodeId; });
        if (!node) return false;
        if (!String(node.workflowId || '').trim()) {
            if (showAlert) alert((window.tr || function (s) { return s; })('canvas.rhNeedWorkflowId'));
            return false;
        }
        node.rhFetching = true;
        if (A().refreshNodes) A().refreshNodes([node.id]);
        try {
            var saved = await ensureRunningHubWorkflow(node.workflowId.trim());
            var res = await fetch('/api/runninghub/workflow-info?workflowId=' + encodeURIComponent(node.workflowId.trim()));
            var data = await res.json();
            if (!res.ok || data.success === false) throw new Error(data.detail || data.error || 'RunningHub 请求失败');
            var info = data.data || {};
            var savedFields = Array.isArray(saved && saved.fields) ? saved.fields : [];
            var mergedFields = savedFields.length ? savedFields : (Array.isArray(info.nodeInfoList) ? info.nodeInfoList : []);
            node.rhWorkflowInfo = { workflowId: node.workflowId.trim(), nodeInfoList: mergedFields, raw: info.raw || null };
            node.rhParams = node.rhParams || {};
            (node.rhWorkflowInfo.nodeInfoList || []).forEach(function (field) {
                var key = rhParamKey(field.nodeId, field.fieldName);
                if (!node.rhParams[key]) node.rhParams[key] = { value: rhDefaultValue(field) };
            });
            node.runStatus = '';
            node.runError = '';
            if (A().scheduleSave) A().scheduleSave();
            return true;
        } catch (err) {
            if (showAlert) alert(err.message || 'RunningHub 请求失败');
            return false;
        } finally {
            node.rhFetching = false;
            if (A().refreshNodes) A().refreshNodes([node.id]);
        }
    }

    async function rhImportWorkflowJson(nodeId, file) {
        var s = S();
        var nodes = s.nodes || [];
        var node = nodes.find(function (n) { return n.id === nodeId; });
        if (!node || !file) return;
        try {
            var text = await file.text();
            var json = JSON.parse(text);
            var nodeInfoList = rhWorkflowNodeInfoList(json);
            if (!nodeInfoList.length) throw new Error((window.tr || function (s) { return s; })('canvas.rhWorkflowJsonInvalid'));
            node.rhMode = 'workflow';
            node.rhWorkflowInfo = { fileName: file.name || 'api.json', nodeInfoList: nodeInfoList };
            node.rhParams = node.rhParams || {};
            nodeInfoList.forEach(function (field) {
                var key = rhParamKey(field.nodeId, field.fieldName);
                if (!node.rhParams[key]) node.rhParams[key] = { value: rhDefaultValue(field) };
            });
            node.runStatus = '';
            node.runError = '';
            if (A().render) A().render();
            if (A().scheduleSave) A().scheduleSave();
        } catch (err) {
            alert(err.message || (window.tr || function (s) { return s; })('canvas.rhWorkflowJsonInvalid'));
        }
    }

    async function rhUploadValueIfNeeded(value, node) {
        var text = String(value || '').trim();
        if (!text) return '';
        if (!/^https?:\/\//i.test(text) && text.indexOf('/output/') !== 0 && text.indexOf('/assets/') !== 0) return text;
        var res = await fetch('/api/runninghub/upload-asset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: text, useWallet: rhUseWallet(node) })
        });
        var data = await res.json();
        if (!res.ok || data.success === false) throw new Error(data.detail || data.error || 'RunningHub 上传失败');
        return (data.data && data.data.fileName) || text;
    }

    async function rhBuildNodeInfoList(node, media) {
        var fields = rhActiveFields(node);
        var result = [];
        var indexes = rhFieldIndexes(fields);
        for (var i = 0; i < fields.length; i++) {
            var field = fields[i];
            var kind = rhFieldKind(field);
            var key = rhParamKey(field.nodeId, field.fieldName);
            if (rhCurrentKind(node) === 'workflow' && field.sourceFromUpstream === false && ['image','video','audio'].indexOf(kind) === -1) continue;
            if (rhCurrentKind(node) === 'workflow' && kind === 'image') {
                var idx = indexes[key] || 0;
                var hasInput = Boolean(media.image && media.image[idx] && media.image[idx].url);
                if (field.required !== true && !hasInput) continue;
            }
            var value = rhFieldValue(node, field, media);
            if (['image','video','audio'].indexOf(kind) !== -1) value = await rhUploadValueIfNeeded(value, node);
            if (typeof value === 'string' && /[\r\n]/.test(value)) value = value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean)[0] || '';
            result.push({ nodeId: field.nodeId, fieldName: field.fieldName, fieldValue: value });
        }
        return result;
    }

    async function rhBuildWorkflowRequestExtras(node, media, nodeInfoList) {
        var config = await ensureRunningHubWorkflowConfigForNode(node);
        if (!config || (config.optionalImageMode || 'prune-workflow') !== 'prune-workflow') return {};
        var fields = rhActiveFields(node);
        var indexes = rhFieldIndexes(fields);
        var missingOptional = [];
        for (var i = 0; i < fields.length; i++) {
            var field = fields[i];
            if (rhFieldKind(field) !== 'image') continue;
            var key = rhParamKey(field.nodeId, field.fieldName);
            var idx = indexes[key] || 0;
            var hasInput = Boolean(media.image && media.image[idx] && media.image[idx].url);
            if (field.required === true && !hasInput) {
                throw new Error('RunningHub 工作流缺少必选图片：' + rhRequiredLabel(field));
            }
            if (field.required !== true && !hasInput) {
                missingOptional.push(field);
            }
        }
        if (!missingOptional.length) return {};
        missingOptional.forEach(function (field) {
            var key = rhParamKey(field.nodeId, field.fieldName);
            var idx = nodeInfoList.findIndex(function (item) { return rhParamKey(item.nodeId, item.fieldName) === key; });
            if (idx >= 0) nodeInfoList.splice(idx, 1);
        });
        var workflow = rhPruneWorkflowForMissingFields(config.workflowJson || {}, missingOptional);
        return workflow ? { workflow: workflow } : {};
    }

    async function runRhNode(nodeId, opts) {
        opts = opts || {};
        var s = S();
        var nodes = s.nodes || [];
        var node = nodes.find(function (n) { return n.id === nodeId; });
        if (!node || (node.running && !opts.cascade)) return;
        var cascadeTargetId = A().cascadeTargetIdFromOptions ? A().cascadeTargetIdFromOptions(opts) : '';
        ensureRhNodeSelection(node);
        var mode = rhCurrentKind(node);
        node.rhRandomValues = {};
        if (mode === 'workflow' && !String(node.workflowId || '').trim()) { alert((window.tr || function (s) { return s; })('canvas.rhNeedWorkflowId')); return; }
        if (mode === 'app' && !String(node.webappId || '').trim()) { alert((window.tr || function (s) { return s; })('canvas.rhNeedWebappId')); return; }
        var selectedEntry = rhCurrentEntry(node);
        if (!selectedEntry) { alert(mode === 'workflow' ? '请先在 API 设置里添加 RH 工作流' : '请先在 API 设置里添加 RH 应用'); return; }
        if (mode === 'workflow') await ensureRunningHubWorkflowConfigForNode(node);
        if (!rhActiveFields(node).length) { alert(mode === 'workflow' ? '请先在 API 设置里编辑并保存这个 RH 工作流参数' : '请先在 API 设置里编辑并保存这个 RH 应用参数'); return; }
        var media = rhMediaSources(node);
        var out = A().outputForNode ? A().outputForNode(node, 500) : null;
        var pendingId = (window.CanvasUtils && window.CanvasUtils.uid) ? window.CanvasUtils.uid('p') : ('p_' + Math.random().toString(36).slice(2));
        var run = A().runSnapshot ? A().runSnapshot(node, media.prompt || 'RunningHub', media.refs) : {};
        run.taskLabel = 'RunningHub';
        if (out) out._pending = (out._pending || []).concat(A().makePendingForRun ? [A().makePendingForRun(pendingId, run, node, { refs: media.refs, cascadeTargetId: cascadeTargetId })] : []);
        if (!opts.cascade) node.running = true;
        if (A().refreshRunNodes) A().refreshRunNodes(node, out);
        try {
            var nodeInfoList = await rhBuildNodeInfoList(node, media);
            var workflowExtras = mode === 'workflow' ? await rhBuildWorkflowRequestExtras(node, media, nodeInfoList) : {};
            var endpoint = mode === 'workflow' ? '/api/runninghub/workflow-submit' : '/api/runninghub/submit';
            var body = mode === 'workflow'
                ? Object.assign({ workflowId: node.workflowId.trim(), nodeInfoList: nodeInfoList, useWallet: rhUseWallet(node) }, workflowExtras)
                : { webappId: node.webappId.trim(), nodeInfoList: nodeInfoList, instanceType: node.instanceType || '', useWallet: rhUseWallet(node) };
            var submit = await (A().cascadeFetch || fetch)(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }, { cascadeTargetId: cascadeTargetId }).then(async function (r) {
                var d = await r.json();
                if (!r.ok || d.success === false) throw new Error(d.detail || d.error || 'RH 提交失败');
                return d.data || d;
            });
            var taskId = submit.taskId;
            if (!taskId) throw new Error((window.tr || function (s) { return s; })('canvas.rhNoTaskId'));
            run.request = { task_id: taskId, webappId: node.webappId, workflowId: node.workflowId, backend: 'runninghub', mode: mode };
            var result = null;
            for (var i = 0; i < 720; i++) {
                if (cascadeTargetId && A().ensureCascadeActive) A().ensureCascadeActive(cascadeTargetId);
                await (A().sleep || function (ms) { return new Promise(function (r) { return setTimeout(r, ms); }); })(2500);
                var queryData = await (A().cascadeFetch || fetch)('/api/runninghub/query?taskId=' + encodeURIComponent(taskId), {}, { cascadeTargetId: cascadeTargetId }).then(async function (r) {
                    var json = await r.json();
                    if (!r.ok || json.success === false) throw new Error(json.detail || json.error || 'RH 查询失败');
                    return json.data || json;
                });
                if (queryData.status === 'SUCCESS') { result = queryData; break; }
                if (queryData.status === 'FAILED') throw new Error(queryData.failReason || 'RH 任务失败');
            }
            if (!result) throw new Error((window.tr || function (s) { return s; })('canvas.rhTimeout'));
            var outputs = result.urls || [];
            if (!outputs.length) throw new Error((window.tr || function (s) { return s; })('canvas.rhOutputsEmpty'));
            var meta = A().collectRunMeta ? A().collectRunMeta(out, pendingId) : {};
            if (out) out._pending = (out._pending || []).filter(function (p) { return p.id !== pendingId; });
            if (A().appendOutputImages) A().appendOutputImages(out, outputs, media.refs[0], [meta]);
            if (A().mergeGeneratedOutputs) A().mergeGeneratedOutputs(node, outputs, Boolean(opts.cascade));
            if (A().addGenerationLog) A().addGenerationLog({ run: run, outputs: outputs, runMs: meta.runMs || 0 });
            node.runStatus = 'done';
            node.runError = '';
            if (A().refreshRunNodes) A().refreshRunNodes(node, out);
            if (A().scheduleSave) A().scheduleSave();
        } catch (err) {
            var meta2 = A().collectRunMeta ? A().collectRunMeta(out, pendingId) : {};
            if (A().addGenerationLog) A().addGenerationLog({ run: run, outputs: [], runMs: meta2.runMs || 0, error: err.message || String(err) });
            if (out) out._pending = (out._pending || []).filter(function (p) { return p.id !== pendingId; });
            if (A().isCascadeAbortError && A().isCascadeAbortError(err)) {
                if (opts.cascade) throw err;
                return;
            }
            node.runStatus = 'failed';
            node.runError = err.message || String(err);
            if (A().refreshRunNodes) A().refreshRunNodes(node, out);
            if (opts.cascade) throw err;
            alert(err.message || (window.tr || function (s) { return s; })('canvas.rhFailed'));
        } finally {
            node.running = false;
            if (A().refreshRunNodes) A().refreshRunNodes(node, out);
        }
    }

    // ── 向后兼容：挂到 window ──────────────────────────────

    var exports = {
        // 常量
        RH_KNOWN_FIELD_OPTIONS: RH_KNOWN_FIELD_OPTIONS,
        // 参数
        rhParamKey: rhParamKey,
        rhFieldKind: rhFieldKind,
        rhFieldRole: rhFieldRole,
        rhExtractFieldOptions: rhExtractFieldOptions,
        rhDefaultValue: rhDefaultValue,
        rhRandomEnabled: rhRandomEnabled,
        rhRandomActive: rhRandomActive,
        rhRequiredLabel: rhRequiredLabel,
        // 字段
        rhWorkflowNodeInfoList: rhWorkflowNodeInfoList,
        rhInferWorkflowFieldType: rhInferWorkflowFieldType,
        rhIsWorkflowLinkValue: rhIsWorkflowLinkValue,
        // Provider
        runningHubProvider: runningHubProvider,
        runningHubEntries: runningHubEntries,
        runningHubEntryId: runningHubEntryId,
        runningHubEntryLabel: runningHubEntryLabel,
        runningHubEntryKey: runningHubEntryKey,
        parseRunningHubEntryKey: parseRunningHubEntryKey,
        runningHubAllEntries: runningHubAllEntries,
        // 条目
        rhSelectedEntryRef: rhSelectedEntryRef,
        applyRhEntrySelection: applyRhEntrySelection,
        rhEntryFields: rhEntryFields,
        rhWorkflowJsonFromSources: rhWorkflowJsonFromSources,
        rhCurrentEntry: rhCurrentEntry,
        rhCurrentKind: rhCurrentKind,
        ensureRhNodeSelection: ensureRhNodeSelection,
        rhEntryOptions: rhEntryOptions,
        rhPaymentOptions: rhPaymentOptions,
        rhUseWallet: rhUseWallet,
        // 有效字段
        validRunningHubWorkflowId: validRunningHubWorkflowId,
        currentRunningHubWorkflow: currentRunningHubWorkflow,
        currentRunningHubAppConfig: currentRunningHubAppConfig,
        currentRunningHubWorkflowEntry: currentRunningHubWorkflowEntry,
        currentRunningHubWorkflowConfig: currentRunningHubWorkflowConfig,
        rhActiveFields: rhActiveFields,
        // 媒体
        rhMediaSources: rhMediaSources,
        rhFieldIndexes: rhFieldIndexes,
        rhFieldValue: rhFieldValue,
        rhPruneWorkflowForMissingFields: rhPruneWorkflowForMissingFields,
        // 渲染
        rhMediaPreviewHtml: rhMediaPreviewHtml,
        renderRhBody: renderRhBody,
        renderRhInputs: renderRhInputs,
        renderRhPromptFields: renderRhPromptFields,
        renderRhParams: renderRhParams,
        renderRhSettingField: renderRhSettingField,
        bindRhParamControls: bindRhParamControls,
        // 动作
        toggleRhRandom: toggleRhRandom,
        ensureRunningHubWorkflow: ensureRunningHubWorkflow,
        ensureRunningHubWorkflowConfigForNode: ensureRunningHubWorkflowConfigForNode,
        rhFetchAppInfo: rhFetchAppInfo,
        rhFetchWorkflowInfo: rhFetchWorkflowInfo,
        rhImportWorkflowJson: rhImportWorkflowJson,
        rhUploadValueIfNeeded: rhUploadValueIfNeeded,
        rhBuildNodeInfoList: rhBuildNodeInfoList,
        rhBuildWorkflowRequestExtras: rhBuildWorkflowRequestExtras,
        runRhNode: runRhNode
    };

    window.EngineRunningHub = exports;

    Object.keys(exports).forEach(function (key) {
        if (typeof window[key] === 'undefined') {
            window[key] = exports[key];
        }
    });

})();
