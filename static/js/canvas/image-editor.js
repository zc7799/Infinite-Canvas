/**
 * 图片编辑器模块 —— 从 canvas.js 提取。
 * 通过 window.CanvasState 读取共享状态，通过 window.CanvasApi 调用画布内部函数。
 *
 * 外部依赖（通过 window 访问）：
 *   - window.CanvasState    (canvas.js syncCanvasState)
 *   - window.CanvasApi      (canvas.js 桥接函数)
 *   - window.uid             (utils.js)
 *   - window.tr              (common.js)
 *   - window.refreshIcons     (canvas.js)
 */
(function () {
    'use strict';

    var S = function () { return window.CanvasState || {}; };
    function A() { return window.CanvasApi || {}; }

    // ── 状态变量 ─────────────────────────────────────────────────

    var cropState = null;
    var cropDrag = null;
    var imageEditMode = 'crop';
    var imageEditModeTouched = false;
    var editDrawState = null;
    var editDrawUndoStack = [];
    var editDrawRedoStack = [];
    var brushTool = 'free';
    var brushLabelCounter = 1;
    var gridCustomMode = false;
    var gridCustomLines = []; // [{type:'h'|'v', pos:0-1}] 相对图片尺寸的分数位置
    var gridCustomOrientation = 'h'; // 当前点击放置方向
    var gridCustomHistory = []; // 撤销栈：每次放线前快照
    var gridCustomDrag = null; // {index, pointerId}
    var imageEditZoom = 1.0;
    var imageEditBaseW = 0; // zoom=1 时图片显示宽度
    var imageEditBaseH = 0;

    // ── 常量 ─────────────────────────────────────────────────────

    var EDIT_DRAW_HISTORY_MAX = 40;
    var MASK_BRUSH_ALPHA = 115;
    var MASK_BRUSH_COLOR = 'rgba(255,255,255,' + (MASK_BRUSH_ALPHA / 255) + ')';

    // ── 函数 ─────────────────────────────────────────────────────

    function cropBounds(){
        const img = document.getElementById('cropImage');
        return {w:img.clientWidth || 1, h:img.clientHeight || 1};
    }
    function editDrawCanvas(){
        return document.getElementById('editDrawCanvas');
    }
    function resizeEditDrawCanvas(){
        const img = document.getElementById('cropImage');
        const canvasEl = editDrawCanvas();
        const w = Math.max(1, img.naturalWidth || img.clientWidth || 1);
        const h = Math.max(1, img.naturalHeight || img.clientHeight || 1);
        if(canvasEl.width !== w || canvasEl.height !== h){
            canvasEl.width = w;
            canvasEl.height = h;
        }
        canvasEl.style.width = `${img.clientWidth || 1}px`;
        canvasEl.style.height = `${img.clientHeight || 1}px`;
        if(imageEditMode === 'grid') refreshGridSplitPreview();
    }
    function setImageEditMode(mode, userTouched){
        if(userTouched === void 0) userTouched = false;
        if(userTouched) imageEditModeTouched = true;
        const prevImageEditMode = imageEditMode;
        imageEditMode = ['crop','outpaint','mask','brush','grid'].includes(mode) ? mode : 'crop';
        const cropCanvasEl = document.getElementById('cropCanvas');
        cropCanvasEl.classList.toggle('mask-mode', imageEditMode === 'mask');
        cropCanvasEl.classList.toggle('brush-mode', imageEditMode === 'brush');
        cropCanvasEl.classList.toggle('grid-mode', imageEditMode === 'grid');
        cropCanvasEl.classList.toggle('outpaint-mode', imageEditMode === 'outpaint');
        _syncGridCustomCursor();
        document.querySelectorAll('[data-image-edit-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.imageEditMode === imageEditMode));
        document.getElementById('imageMaskTools').classList.toggle('active', imageEditMode === 'mask');
        document.getElementById('imageBrushTools').classList.toggle('active', imageEditMode === 'brush');
        document.getElementById('imageGridTools').classList.toggle('active', imageEditMode === 'grid');
        syncGridGapValue();
        const title = document.getElementById('imageEditTitle');
        const sub = document.getElementById('imageEditSub');
        const apply = document.getElementById('imageEditApplyBtn');
        const icon = imageEditMode === 'crop' ? 'crop' : imageEditMode === 'outpaint' ? 'expand' : imageEditMode === 'mask' ? 'brush' : imageEditMode === 'brush' ? 'paintbrush' : 'grid-3x3';
        const labelKey = imageEditMode === 'crop' ? 'canvas.applyCrop' : imageEditMode === 'outpaint' ? 'canvas.applyOutpaint' : imageEditMode === 'mask' ? 'canvas.applyMask' : imageEditMode === 'brush' ? 'canvas.applyBrush' : 'canvas.applyGrid';
        const titleKey = imageEditMode === 'crop' ? 'canvas.cropImage' : imageEditMode === 'outpaint' ? 'canvas.outpaintImage' : imageEditMode === 'mask' ? 'canvas.maskEdit' : imageEditMode === 'brush' ? 'canvas.brushEdit' : 'canvas.modeGrid';
        const subKey = imageEditMode === 'crop' ? 'canvas.cropHint' : imageEditMode === 'outpaint' ? 'canvas.outpaintHint' : imageEditMode === 'mask' ? 'canvas.maskHint2' : imageEditMode === 'brush' ? 'canvas.brushHint' : 'canvas.gridHint';
        title.textContent = tr(titleKey);
        sub.textContent = tr(subKey);
        apply.innerHTML = '<i data-lucide="' + icon + '" class="w-4 h-4"></i><span>' + tr(labelKey) + '</span>';
        resizeEditDrawCanvas();
        if(imageEditMode === 'grid') refreshGridSplitPreview();
        else if(imageEditMode === 'outpaint') resetOutpaintBox();
        else if(imageEditMode === 'crop') clearEditDrawing(true);
        else if(prevImageEditMode === 'grid') clearEditDrawing(true); // 离开 grid 时主动清掉画布上残留的分割线预览
        syncEditDrawingHistoryButtons();
        syncBrushToolButtons();
        refreshIcons();
    }
    function editDrawSnapshot(){
        const canvasEl = editDrawCanvas();
        return {
            imageData: canvasEl.getContext('2d').getImageData(0, 0, canvasEl.width, canvasEl.height),
            labelCounter: brushLabelCounter,
        };
    }
    function restoreEditDrawSnapshot(snapshot){
        if(!snapshot) return;
        const canvasEl = editDrawCanvas();
        const imageData = snapshot.imageData || snapshot;
        canvasEl.getContext('2d').putImageData(imageData, 0, 0);
        if(snapshot.labelCounter) brushLabelCounter = snapshot.labelCounter;
    }
    function pushEditDrawHistory(){
        editDrawUndoStack.push(editDrawSnapshot());
        if(editDrawUndoStack.length > EDIT_DRAW_HISTORY_MAX) editDrawUndoStack.shift();
        editDrawRedoStack = [];
        syncEditDrawingHistoryButtons();
    }
    function syncEditDrawingHistoryButtons(){
        ['maskUndoBtn','brushUndoBtn'].forEach(id => {
            const btn = document.getElementById(id);
            if(btn){ btn.disabled = !editDrawUndoStack.length; btn.style.opacity = editDrawUndoStack.length ? '1' : '.42'; }
        });
        ['maskRedoBtn','brushRedoBtn'].forEach(id => {
            const btn = document.getElementById(id);
            if(btn){ btn.disabled = !editDrawRedoStack.length; btn.style.opacity = editDrawRedoStack.length ? '1' : '.42'; }
        });
    }
    function undoEditDrawing(){
        if(!editDrawUndoStack.length) return;
        editDrawRedoStack.push(editDrawSnapshot());
        restoreEditDrawSnapshot(editDrawUndoStack.pop());
        syncEditDrawingHistoryButtons();
    }
    function redoEditDrawing(){
        if(!editDrawRedoStack.length) return;
        editDrawUndoStack.push(editDrawSnapshot());
        restoreEditDrawSnapshot(editDrawRedoStack.pop());
        syncEditDrawingHistoryButtons();
    }
    function clearEditDrawing(silent){
        if(silent === void 0) silent = false;
        const canvasEl = editDrawCanvas();
        if(!silent && editCanvasHasPixels()) pushEditDrawHistory();
        canvasEl.getContext('2d').clearRect(0, 0, canvasEl.width, canvasEl.height);
        brushLabelCounter = 1;
        syncEditDrawingHistoryButtons();
    }
    function resetEditDrawingHistory(){
        editDrawUndoStack = [];
        editDrawRedoStack = [];
        brushLabelCounter = 1;
        syncEditDrawingHistoryButtons();
    }
    function setBrushTool(tool){
        brushTool = ['free','rect','ellipse','label'].includes(tool) ? tool : 'free';
        syncBrushToolButtons();
    }
    function syncBrushToolButtons(){
        document.querySelectorAll('[data-brush-tool]').forEach(btn => {
            const active = btn.dataset.brushTool === brushTool;
            btn.classList.toggle('primary', active);
            btn.classList.toggle('secondary', !active);
        });
    }
    function editDrawPoint(event){
        const canvasEl = editDrawCanvas();
        const rect = canvasEl.getBoundingClientRect();
        return {
            x:(event.clientX - rect.left) * canvasEl.width / Math.max(1, rect.width),
            y:(event.clientY - rect.top) * canvasEl.height / Math.max(1, rect.height),
        };
    }
    function gridCustomLineHit(point){
        if(!gridCustomLines.length) return -1;
        const canvasEl = editDrawCanvas();
        const threshold = Math.max(8, Math.min(canvasEl.width, canvasEl.height) / 80);
        let best = -1;
        let bestDist = Infinity;
        gridCustomLines.forEach((line, index) => {
            const dist = line.type === 'h'
                ? Math.abs(point.y - line.pos * canvasEl.height)
                : Math.abs(point.x - line.pos * canvasEl.width);
            if(dist < bestDist && dist <= threshold){
                best = index;
                bestDist = dist;
            }
        });
        return best;
    }
    function setGridCustomLinePos(index, point){
        const canvasEl = editDrawCanvas();
        const line = gridCustomLines[index];
        if(!line) return;
        line.pos = line.type === 'h'
            ? Math.max(0.001, Math.min(0.999, point.y / Math.max(1, canvasEl.height)))
            : Math.max(0.001, Math.min(0.999, point.x / Math.max(1, canvasEl.width)));
    }
    function editBrushSize(){
        const id = imageEditMode === 'mask' ? 'maskBrushSize' : 'paintBrushSize';
        return Number(document.getElementById(id)?.value || 20);
    }
    function brushColor(){
        return document.getElementById('paintBrushColor')?.value || '#ff2d55';
    }
    function setupDrawStyle(ctx){
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = editBrushSize();
        ctx.strokeStyle = imageEditMode === 'mask' ? MASK_BRUSH_COLOR : brushColor();
        ctx.fillStyle = imageEditMode === 'mask' ? MASK_BRUSH_COLOR : brushColor();
        ctx.globalCompositeOperation = 'source-over';
    }
    function normalizeMaskPreviewCanvas(canvasEl){
        if(canvasEl === void 0) canvasEl = editDrawCanvas();
        if(imageEditMode !== 'mask' || !canvasEl?.width || !canvasEl?.height) return;
        const ctx = canvasEl.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
        const data = imageData.data;
        let changed = false;
        for(let i = 0; i < data.length; i += 4){
            if(data[i + 3] <= 0) continue;
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            if(data[i + 3] > MASK_BRUSH_ALPHA) data[i + 3] = MASK_BRUSH_ALPHA;
            changed = true;
        }
        if(changed) ctx.putImageData(imageData, 0, 0);
    }
    function circledNumber(n){
        if(n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
        return String(n);
    }
    function drawBrushShape(ctx, start, end, preview){
        if(preview === void 0) preview = false;
        setupDrawStyle(ctx);
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        if(brushTool === 'rect'){
            ctx.strokeRect(x, y, w, h);
        } else if(brushTool === 'ellipse'){
            ctx.beginPath();
            ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    function drawNumberLabel(point){
        const canvasEl = editDrawCanvas();
        const ctx = canvasEl.getContext('2d');
        const size = Math.max(18, editBrushSize() * 2.2);
        const text = circledNumber(brushLabelCounter++);
        setupDrawStyle(ctx);
        ctx.save();
        ctx.font = `900 ${size}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(3, size / 8);
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.strokeText(text, point.x, point.y);
        ctx.fillStyle = brushColor();
        ctx.fillText(text, point.x, point.y);
        ctx.restore();
    }
    function beginEditDraw(event){
        if(imageEditMode === 'crop') return;
        if(imageEditMode === 'grid'){
            if(!gridCustomMode) return;
            // 自定义模式：拖动已有线，或点击空白处放置新线
            event.preventDefault();
            event.stopPropagation();
            const canvasEl = editDrawCanvas();
            canvasEl.setPointerCapture?.(event.pointerId);
            const point = editDrawPoint(event);
            const hitIndex = gridCustomLineHit(point);
            gridCustomHistory.push([...gridCustomLines.map(line => ({...line}))]);
            if(hitIndex >= 0){
                gridCustomDrag = {index: hitIndex, pointerId: event.pointerId};
                setGridCustomLinePos(hitIndex, point);
                refreshGridSplitPreview();
                _syncGridCustomUndoBtn();
                return;
            }
            const rect = canvasEl.getBoundingClientRect();
            const fracX = Math.max(0.001, Math.min(0.999, (event.clientX - rect.left) / rect.width));
            const fracY = Math.max(0.001, Math.min(0.999, (event.clientY - rect.top) / rect.height));
            gridCustomLines.push({type: gridCustomOrientation, pos: gridCustomOrientation === 'h' ? fracY : fracX});
            gridCustomDrag = {index: gridCustomLines.length - 1, pointerId: event.pointerId};
            _syncGridCustomUndoBtn();
            refreshGridSplitPreview();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const canvasEl = editDrawCanvas();
        canvasEl.setPointerCapture?.(event.pointerId);
        const ctx = canvasEl.getContext('2d');
        const p = editDrawPoint(event);
        pushEditDrawHistory();
        if(imageEditMode === 'brush' && brushTool === 'label'){
            drawNumberLabel(p);
            editDrawState = null;
            canvasEl.releasePointerCapture?.(event.pointerId);
            syncEditDrawingHistoryButtons();
            return;
        }
        editDrawState = {x:p.x, y:p.y, sx:p.x, sy:p.y, pointerId:event.pointerId, snapshot:(imageEditMode === 'brush' && brushTool !== 'free') ? editDrawSnapshot() : null};
        setupDrawStyle(ctx);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + 0.01, p.y + 0.01);
        if(imageEditMode === 'mask' || brushTool === 'free') ctx.stroke();
        normalizeMaskPreviewCanvas(canvasEl);
    }
    function moveEditDraw(event){
        if(imageEditMode === 'grid' && gridCustomMode && gridCustomDrag){
            event.preventDefault();
            event.stopPropagation();
            setGridCustomLinePos(gridCustomDrag.index, editDrawPoint(event));
            refreshGridSplitPreview();
            return;
        }
        if(!editDrawState || imageEditMode === 'crop' || imageEditMode === 'grid') return;
        event.preventDefault();
        event.stopPropagation();
        const ctx = editDrawCanvas().getContext('2d');
        const p = editDrawPoint(event);
        if(imageEditMode === 'brush' && brushTool !== 'free'){
            restoreEditDrawSnapshot(editDrawState.snapshot);
            drawBrushShape(ctx, {x:editDrawState.sx, y:editDrawState.sy}, p, true);
            return;
        }
        setupDrawStyle(ctx);
        ctx.beginPath();
        ctx.moveTo(editDrawState.x, editDrawState.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        editDrawState.x = p.x;
        editDrawState.y = p.y;
        normalizeMaskPreviewCanvas();
    }
    function endEditDraw(event){
        if(editDrawState && event?.pointerId != null) editDrawCanvas().releasePointerCapture?.(event.pointerId);
        if(gridCustomDrag && event?.pointerId != null) editDrawCanvas().releasePointerCapture?.(event.pointerId);
        editDrawState = null;
        gridCustomDrag = null;
        syncEditDrawingHistoryButtons();
    }
    function editCanvasHasPixels(){
        const canvasEl = editDrawCanvas();
        const data = canvasEl.getContext('2d').getImageData(0, 0, canvasEl.width, canvasEl.height).data;
        for(let i = 3; i < data.length; i += 4) if(data[i] > 0) return true;
        return false;
    }
    function syncGridGapValue(){
        const input = document.getElementById('gridGapSize');
        const value = Math.max(0, Math.min(240, Number(input?.value || 0)));
        if(input) input.value = value;
        const label = document.getElementById('gridGapValue');
        if(label) label.textContent = String(value);
        return value;
    }
    function gridSplitSettings(){
        const hLines = Math.max(0, Math.min(20, Number(document.getElementById('gridHorizontalLines')?.value || 0)));
        const vLines = Math.max(0, Math.min(20, Number(document.getElementById('gridVerticalLines')?.value || 0)));
        const gap = syncGridGapValue();
        return {rows:hLines + 1, cols:vLines + 1, gap};
    }
    function gridSplitRects(width, height){
        if(gridCustomMode) return gridSplitRectsCustom(width, height);
        const {rows, cols, gap} = gridSplitSettings();
        const halfGap = gap / 2;
        const rects = [];
        for(let row = 0; row < rows; row++){
            const topLine = row * height / rows;
            const bottomLine = (row + 1) * height / rows;
            const y1 = Math.round(row === 0 ? 0 : topLine + halfGap);
            const y2 = Math.round(row === rows - 1 ? height : bottomLine - halfGap);
            for(let col = 0; col < cols; col++){
                const leftLine = col * width / cols;
                const rightLine = (col + 1) * width / cols;
                const x1 = Math.round(col === 0 ? 0 : leftLine + halfGap);
                const x2 = Math.round(col === cols - 1 ? width : rightLine - halfGap);
                if(x2 > x1 && y2 > y1) rects.push({row, col, x:x1, y:y1, w:x2 - x1, h:y2 - y1});
            }
        }
        return rects;
    }
    function gridSplitRectsCustom(width, height){
        const gap = Math.max(0, Math.min(240, Number(document.getElementById('gridGapSize')?.value || 0)));
        const halfGap = gap / 2;
        // 按方向归类，转换为像素位置（去重并排序）
        const rawH = [...new Set(gridCustomLines.filter(l => l.type === 'h').map(l => l.pos * height))].sort((a, b) => a - b);
        const rawV = [...new Set(gridCustomLines.filter(l => l.type === 'v').map(l => l.pos * width))].sort((a, b) => a - b);
        const hCuts = [0, ...rawH, height]; // 切割边界（含图片两端）
        const vCuts = [0, ...rawV, width];
        const rects = [];
        for(let row = 0; row < hCuts.length - 1; row++){
            for(let col = 0; col < vCuts.length - 1; col++){
                const y1 = Math.round(row === 0 ? hCuts[row] : hCuts[row] + halfGap);
                const y2 = Math.round(row === hCuts.length - 2 ? hCuts[row + 1] : hCuts[row + 1] - halfGap);
                const x1 = Math.round(col === 0 ? vCuts[col] : vCuts[col] + halfGap);
                const x2 = Math.round(col === vCuts.length - 2 ? vCuts[col + 1] : vCuts[col + 1] - halfGap);
                if(x2 > x1 && y2 > y1) rects.push({row, col, x:x1, y:y1, w:x2 - x1, h:y2 - y1});
            }
        }
        return rects;
    }
    function gridLayoutFromRects(rects){
        const rows = Math.max(1, ...rects.map(r => Number(r.row || 0) + 1));
        const cols = Math.max(1, ...rects.map(r => Number(r.col || 0) + 1));
        return {type:'grid-split', groupId:window.uid('grid'), rows, cols};
    }
    function applyGridPreset(rows, cols){
        gridCustomMode = false;
        gridCustomLines = [];
        gridCustomHistory = [];
        gridCustomDrag = null;
        const h = document.getElementById('gridHorizontalLines');
        const v = document.getElementById('gridVerticalLines');
        if(h){ h.disabled = false; h.value = String(Math.max(0, Number(rows || 1) - 1)); }
        if(v){ v.disabled = false; v.value = String(Math.max(0, Number(cols || 1) - 1)); }
        const toggle = document.getElementById('gridCustomToggle');
        const custom = document.getElementById('gridCustomControls');
        const regular = document.getElementById('gridRegularControls');
        if(toggle){
            toggle.classList.remove('primary');
            toggle.classList.add('secondary');
        }
        if(custom) custom.style.display = 'none';
        if(regular) regular.style.display = 'contents';
        _syncGridCustomCursor();
        _syncGridCustomUndoBtn();
        refreshGridSplitPreview();
    }
    // ——— 自定义宫格辅助函数 ———
    function toggleGridCustomMode(){
        gridCustomMode = !gridCustomMode;
        if(gridCustomMode){ gridCustomLines = []; gridCustomHistory = []; } // 进入自定义时清空旧线及历史
        gridCustomDrag = null;
        const toggle = document.getElementById('gridCustomToggle');
        const regular = document.getElementById('gridRegularControls');
        const custom = document.getElementById('gridCustomControls');
        toggle.classList.toggle('primary', gridCustomMode);
        toggle.classList.toggle('secondary', !gridCustomMode);
        // 禁用/启用常规输入
        ['gridHorizontalLines','gridVerticalLines'].forEach(id => {
            const el = document.getElementById(id);
            if(el) el.disabled = gridCustomMode;
        });
        if(custom) custom.style.display = gridCustomMode ? 'flex' : 'none';
        _syncGridCustomCursor();
        _syncGridCustomUndoBtn();
        refreshGridSplitPreview();
    }
    function setGridCustomOrientation(orient){
        gridCustomOrientation = orient;
        document.getElementById('gridOrientH').classList.toggle('primary', orient === 'h');
        document.getElementById('gridOrientH').classList.toggle('secondary', orient !== 'h');
        document.getElementById('gridOrientV').classList.toggle('primary', orient === 'v');
        document.getElementById('gridOrientV').classList.toggle('secondary', orient !== 'v');
        _syncGridCustomCursor();
    }
    function clearGridCustomLines(){
        gridCustomHistory = [];
        gridCustomLines = [];
        gridCustomDrag = null;
        _syncGridCustomUndoBtn();
        refreshGridSplitPreview();
    }
    function undoGridCustomLine(){
        if(!gridCustomHistory.length) return;
        gridCustomLines = gridCustomHistory.pop();
        gridCustomDrag = null;
        _syncGridCustomUndoBtn();
        refreshGridSplitPreview();
    }
    function _syncGridCustomUndoBtn(){
        const btn = document.getElementById('gridUndoBtn');
        if(!btn) return;
        btn.disabled = gridCustomHistory.length === 0;
        btn.style.opacity = gridCustomHistory.length === 0 ? '0.4' : '1';
    }
    // ——— 图片缩放 ———
    function applyImageEditZoom(){
        if(!imageEditBaseW) return;
        const img = document.getElementById('cropImage');
        const oldW = img.clientWidth;
        img.style.maxWidth = 'none';
        img.style.maxHeight = 'none';
        img.style.width = Math.round(imageEditBaseW * imageEditZoom) + 'px';
        img.style.height = Math.round(imageEditBaseH * imageEditZoom) + 'px';
        resizeEditDrawCanvas();
        // 按比例同步裁剪框位置
        if(cropState && oldW > 0){
            const scale = img.clientWidth / oldW;
            cropState.x = Math.round(cropState.x * scale);
            cropState.y = Math.round(cropState.y * scale);
            cropState.w = Math.round(cropState.w * scale);
            cropState.h = Math.round(cropState.h * scale);
            clampCrop();
            renderCropBox();
        }
        if(imageEditMode === 'grid') refreshGridSplitPreview();
        syncImageEditOverflow();
        _updateZoomLabel();
    }
    function syncImageEditOverflow(){
        const stage = document.getElementById('imageEditStage');
        const crop = document.getElementById('cropCanvas');
        if(!stage || !crop) return;
        const rect = crop.getBoundingClientRect();
        const pad = 36;
        const overflowX = rect.width + pad > stage.clientWidth;
        const overflowY = rect.height + pad > stage.clientHeight;
        stage.classList.toggle('overflowing', overflowX || overflowY);
        stage.classList.toggle('overflow-x', overflowX);
        stage.classList.toggle('overflow-y', overflowY);
    }
    function resetImageEditZoom(){
        const stage = document.getElementById('imageEditStage');
        imageEditZoom = 1.0;
        applyImageEditZoom();
        if(stage){ stage.scrollLeft = 0; stage.scrollTop = 0; }
    }
    function _updateZoomLabel(){
        const el = document.getElementById('imageEditZoomLabel');
        if(el) el.textContent = Math.round(imageEditZoom * 100) + '%';
    }
    function _syncGridCustomCursor(){
        const cropCanvasEl = document.getElementById('cropCanvas');
        cropCanvasEl.classList.toggle('grid-custom-h', imageEditMode === 'grid' && gridCustomMode && gridCustomOrientation === 'h');
        cropCanvasEl.classList.toggle('grid-custom-v', imageEditMode === 'grid' && gridCustomMode && gridCustomOrientation === 'v');
    }
    function refreshGridSplitPreview(){
        const canvasEl = editDrawCanvas();
        const ctx = canvasEl.getContext('2d');
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        if(imageEditMode !== 'grid') return;
        const countEl = document.getElementById('gridSplitCount');
        const lineWidth = Math.max(2, Math.round(Math.min(canvasEl.width, canvasEl.height) / 320));
        const drawGuideLine = function(x1, y1, x2, y2) {
            ctx.save();
            ctx.lineWidth = lineWidth + 2;
            ctx.strokeStyle = 'rgba(2,6,23,0.72)';
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            ctx.lineWidth = lineWidth;
            ctx.strokeStyle = 'rgba(255,255,255,0.92)';
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            ctx.restore();
        };
        if(gridCustomMode){
            // 自定义模式：按已放置线渲染（包含空心范围预览）
            const gap = Math.max(0, Math.min(240, Number(document.getElementById('gridGapSize')?.value || 0)));
            const hLines = gridCustomLines.filter(function(l){ return l.type === 'h'; });
            const vLines = gridCustomLines.filter(function(l){ return l.type === 'v'; });
            if(countEl) countEl.textContent = tr('canvas.gridWillOutput').replace('{n}', (hLines.length + 1) * (vLines.length + 1));
            ctx.save();
            hLines.forEach(function(l){
                const y = l.pos * canvasEl.height;
                if(gap > 0){
                    drawGuideLine(0, y - gap / 2, canvasEl.width, y - gap / 2);
                    drawGuideLine(0, y + gap / 2, canvasEl.width, y + gap / 2);
                } else {
                    drawGuideLine(0, y, canvasEl.width, y);
                }
            });
            vLines.forEach(function(l){
                const x = l.pos * canvasEl.width;
                if(gap > 0){
                    drawGuideLine(x - gap / 2, 0, x - gap / 2, canvasEl.height);
                    drawGuideLine(x + gap / 2, 0, x + gap / 2, canvasEl.height);
                } else {
                    drawGuideLine(x, 0, x, canvasEl.height);
                }
            });
            ctx.restore();
            return;
        }
        // 常规模式
        const settings = gridSplitSettings();
        const rows = settings.rows;
        const cols = settings.cols;
        const gap = settings.gap;
        if(countEl) countEl.textContent = tr('canvas.gridWillOutput').replace('{n}', rows * cols);
        ctx.save();
        const scaleX = canvasEl.width;
        const scaleY = canvasEl.height;
        for(let i = 1; i < cols; i++){
            const x = i * scaleX / cols;
            if(gap > 0){
                drawGuideLine(x - gap / 2, 0, x - gap / 2, scaleY);
                drawGuideLine(x + gap / 2, 0, x + gap / 2, scaleY);
            } else {
                drawGuideLine(x, 0, x, scaleY);
            }
        }
        for(let i = 1; i < rows; i++){
            const y = i * scaleY / rows;
            if(gap > 0){
                drawGuideLine(0, y - gap / 2, scaleX, y - gap / 2);
                drawGuideLine(0, y + gap / 2, scaleX, y + gap / 2);
            } else {
                drawGuideLine(0, y, scaleX, y);
            }
        }
        ctx.restore();
    }
    function imageEditorOutputPoint(node, offsetY){
        if(offsetY === void 0) offsetY = 0;
        return {x:(node.x || 0) + Number(node.w || 260) + 36, y:(node.y || 0) + offsetY};
    }
    function imageEditorOutputNode(sourceNode){
        var out = S().connections.filter(function(c){ return c.from === sourceNode.id; })
            .map(function(c){ return S().nodes.find(function(n){ return n.id === c.to; }); })
            .find(function(n){ return n && n.type === 'output'; });
        if(!out){
            const p = imageEditorOutputPoint(sourceNode, 0);
            out = {id:window.uid('out'), type:'output', x:p.x, y:p.y, images:[]};
            S().nodes.push(out);
        }
        return out;
    }
    function addGeneratedImageNode(file, sourceNode, suffix, offsetY, extra){
        if(offsetY === void 0) offsetY = 0;
        if(extra === void 0) extra = {};
        const p = imageEditorOutputPoint(sourceNode, offsetY);
        const next = {id:window.uid('img'), type:'image', x:p.x, y:p.y, url:file.url, name:file.name || suffix, ...extra};
        S().nodes.push(next);
        S().selected.clear();
        S().selected.add(next.id);
        return next;
    }
    function renderCropBox(){
        if(!cropState) return;
        const cropCanvasEl = document.getElementById('cropCanvas');
        const img = document.getElementById('cropImage');
        const draw = editDrawCanvas();
        let boxX = cropState.x;
        let boxY = cropState.y;
        if(imageEditMode === 'outpaint' && cropCanvasEl && img){
            cropCanvasEl.style.width = Math.round(cropState.w) + 'px';
            cropCanvasEl.style.height = Math.round(cropState.h) + 'px';
            img.style.left = Math.round(cropState.x) + 'px';
            img.style.top = Math.round(cropState.y) + 'px';
            boxX = 0;
            boxY = 0;
            if(draw){
                draw.style.left = img.style.left;
                draw.style.top = img.style.top;
            }
            updateOutpaintResolutionLabel();
        } else if(cropCanvasEl && img){
            cropCanvasEl.style.width = '';
            cropCanvasEl.style.height = '';
            img.style.left = '';
            img.style.top = '';
            if(draw){
                draw.style.left = '';
                draw.style.top = '';
            }
        }
        const box = document.getElementById('cropBox');
        box.style.left = boxX + 'px';
        box.style.top = boxY + 'px';
        box.style.width = cropState.w + 'px';
        box.style.height = cropState.h + 'px';
        const outpaintFrame = document.getElementById('outpaintFrame');
        if(outpaintFrame){
            outpaintFrame.style.left = imageEditMode === 'outpaint' ? '0px' : boxX + 'px';
            outpaintFrame.style.top = imageEditMode === 'outpaint' ? '0px' : boxY + 'px';
            outpaintFrame.style.width = cropState.w + 'px';
            outpaintFrame.style.height = cropState.h + 'px';
        }
    }
    function outpaintNaturalSize(){
        const img = document.getElementById('cropImage');
        if(!img || !cropState) return {w:1, h:1};
        const scaleX = Math.max(1, Number(img.naturalWidth || 1)) / Math.max(1, Number(img.clientWidth || 1));
        const scaleY = Math.max(1, Number(img.naturalHeight || 1)) / Math.max(1, Number(img.clientHeight || 1));
        return {
            w:Math.max(1, Math.round((cropState.w || 1) * scaleX)),
            h:Math.max(1, Math.round((cropState.h || 1) * scaleY))
        };
    }
    function updateOutpaintResolutionLabel(){
        const label = document.getElementById('outpaintResolution');
        const cropCanvasEl = document.getElementById('cropCanvas');
        if(!label || !cropState) return;
        const size = outpaintNaturalSize();
        cropCanvasEl?.classList.toggle('outpaint-warning', A().exceedsFourKStandard(size.w, size.h));
        label.textContent = Math.round(size.w) + ' x ' + Math.round(size.h);
    }
    function clampOutpaint(){
        if(!cropState) return;
        const bounds = cropBounds();
        const w = bounds.w;
        const h = bounds.h;
        cropState.w = Math.max(w, cropState.w);
        cropState.h = Math.max(h, cropState.h);
        cropState.x = Math.min(cropState.w - w, Math.max(0, cropState.x));
        cropState.y = Math.min(cropState.h - h, Math.max(0, cropState.y));
    }
    function resetOutpaintBox(){
        if(!cropState) return;
        const bounds = cropBounds();
        const w = bounds.w;
        const h = bounds.h;
        cropState.x = 0;
        cropState.y = 0;
        cropState.w = w;
        cropState.h = h;
        renderCropBox();
    }
    function resetCropBox(){
        if(!cropState) return;
        if(imageEditMode === 'outpaint') return resetOutpaintBox();
        const bounds = cropBounds();
        const w = bounds.w;
        const h = bounds.h;
        cropState.x = Math.round(w * 0.08);
        cropState.y = Math.round(h * 0.08);
        cropState.w = Math.round(w * 0.84);
        cropState.h = Math.round(h * 0.84);
        renderCropBox();
    }
    function openImageEditor(nodeId){
        const node = S().nodes.find(function(n){ return n.id === nodeId; });
        if(!node?.url) return;
        if(A().mediaKindForNode(node) !== 'image') return;
        cropState = {nodeId, x:0, y:0, w:0, h:0};
        // 重置自定义宫格状态
        gridCustomMode = false;
        gridCustomLines = [];
        gridCustomHistory = [];
        gridCustomDrag = null;
        gridCustomOrientation = 'h';
        imageEditZoom = 1.0;
        imageEditBaseW = 0;
        imageEditBaseH = 0;
        imageEditModeTouched = false;
        const toggle = document.getElementById('gridCustomToggle');
        if(toggle){ toggle.classList.add('secondary'); toggle.classList.remove('primary'); }
        const custom = document.getElementById('gridCustomControls');
        if(custom) custom.style.display = 'none';
        ['gridHorizontalLines','gridVerticalLines'].forEach(function(id){ const el = document.getElementById(id); if(el) el.disabled = false; });
        const orientH = document.getElementById('gridOrientH');
        const orientV = document.getElementById('gridOrientV');
        if(orientH){ orientH.classList.add('primary'); orientH.classList.remove('secondary'); }
        if(orientV){ orientV.classList.add('secondary'); orientV.classList.remove('primary'); }
        _syncGridCustomUndoBtn();
        _updateZoomLabel();
        const modal = document.getElementById('imageEditModal');
        const img = document.getElementById('cropImage');
        img.style.width = '';
        img.style.height = '';
        img.style.maxWidth = '';
        img.style.maxHeight = '';
        modal.classList.add('open');
        img.onload = function(){
            // 记录 zoom=1 时的基础显示尺寸
            imageEditBaseW = img.clientWidth;
            imageEditBaseH = img.clientHeight;
            _updateZoomLabel();
            resizeEditDrawCanvas();
            resetEditDrawingHistory();
            clearEditDrawing(true);
            resetCropBox();
            if(!imageEditModeTouched) setImageEditMode('crop');
            syncImageEditOverflow();
            refreshIcons();
        };
        img.crossOrigin = 'anonymous';
        img.src = node.url;
        setImageEditMode('crop');
        refreshIcons();
    }
    function closeImageEditor(){
        document.getElementById('imageEditModal').classList.remove('open');
        const img = document.getElementById('cropImage');
        img.onload = null;
        img.removeAttribute('src');
        img.style.width = '';
        img.style.height = '';
        img.style.maxWidth = '';
        img.style.maxHeight = '';
        clearEditDrawing(true);
        cropState = null;
        cropDrag = null;
        editDrawState = null;
        resetEditDrawingHistory();
        gridCustomDrag = null;
        imageEditZoom = 1.0;
        imageEditBaseW = 0;
        imageEditBaseH = 0;
        imageEditModeTouched = false;
        document.getElementById('imageEditStage')?.classList.remove('overflowing', 'overflow-x', 'overflow-y');
        const cropCanvasEl = document.getElementById('cropCanvas');
        cropCanvasEl.classList.remove('grid-custom-h', 'grid-custom-v', 'outpaint-mode', 'outpaint-warning', 'dragging-image');
        cropCanvasEl.style.width = '';
        cropCanvasEl.style.height = '';
    }
    function clampCrop(){
        if(!cropState) return;
        if(imageEditMode === 'outpaint') return clampOutpaint();
        const bounds = cropBounds();
        const w = bounds.w;
        const h = bounds.h;
        cropState.w = Math.max(24, Math.min(cropState.w, w));
        cropState.h = Math.max(24, Math.min(cropState.h, h));
        cropState.x = Math.max(0, Math.min(cropState.x, w - cropState.w));
        cropState.y = Math.max(0, Math.min(cropState.y, h - cropState.h));
    }
    function beginCropDrag(event, mode){
        if(!cropState) return;
        event.preventDefault();
        event.stopPropagation();
        if(imageEditMode === 'outpaint' && mode === 'move') return;
        cropDrag = {mode, sx:event.clientX, sy:event.clientY, start:{...cropState}};
    }
    function resizeOutpaintFromDrag(dx, dy){
        const start = cropDrag?.start;
        if(!start) return;
        let growX = 0, growY = 0;
        if(cropDrag.mode === 'outpaint-left') growX = -dx;
        else if(cropDrag.mode === 'outpaint-right') growX = dx;
        else if(cropDrag.mode === 'outpaint-top') growY = -dy;
        else if(cropDrag.mode === 'outpaint-bottom') growY = dy;
        else if(cropDrag.mode === 'outpaint-corner'){ growX = dx; growY = dy; }
        const bounds = cropBounds();
        const w = bounds.w;
        const h = bounds.h;
        const nextW = Math.max(w, start.w + growX * 2);
        const nextH = Math.max(h, start.h + growY * 2);
        cropState.w = nextW;
        cropState.h = nextH;
        cropState.x = start.x + Math.round((nextW - start.w) / 2);
        cropState.y = start.y + Math.round((nextH - start.h) / 2);
        clampOutpaint();
    }
    async function uploadCroppedBlob(blob, name){
        const form = new FormData();
        form.append('files', blob, name);
        const data = await fetch('/api/ai/upload', {method:'POST', body:form}).then(function(r){ return r.json(); });
        return data.files?.[0];
    }
    async function uploadImageBlobs(blobs){
        const form = new FormData();
        blobs.forEach(function(item){ form.append('files', item.blob, item.name); });
        const data = await fetch('/api/ai/upload', {method:'POST', body:form}).then(function(r){ return r.json(); });
        return data.files || [];
    }
    async function applyImageCrop(){
        if(!cropState) return;
        const node = S().nodes.find(function(n){ return n.id === cropState.nodeId; });
        const img = document.getElementById('cropImage');
        if(!node || !img.naturalWidth || !img.naturalHeight) return;
        const scaleX = img.naturalWidth / (img.clientWidth || 1);
        const scaleY = img.naturalHeight / (img.clientHeight || 1);
        const sx = Math.max(0, Math.round(cropState.x * scaleX));
        const sy = Math.max(0, Math.round(cropState.y * scaleY));
        const sw = Math.max(1, Math.round(cropState.w * scaleX));
        const sh = Math.max(1, Math.round(cropState.h * scaleY));
        const canvasEl = document.createElement('canvas');
        canvasEl.width = sw;
        canvasEl.height = sh;
        canvasEl.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        const blob = await new Promise(function(resolve){ canvasEl.toBlob(resolve, 'image/png'); });
        if(!blob) return;
        const base = (node.name || 'image').replace(/\.[^.]+$/, '');
        const file = await uploadCroppedBlob(blob, base + '_crop.png');
        if(file){
            node.url = file.url;
            node.name = file.name;
            closeImageEditor();
            A().render();
            A().scheduleSave();
        }
    }
    async function applyImageOutpaint(){
        if(!cropState) return;
        const node = S().nodes.find(function(n){ return n.id === cropState.nodeId; });
        const img = document.getElementById('cropImage');
        if(!node || !img.naturalWidth || !img.naturalHeight) return;
        clampOutpaint();
        const scaleX = img.naturalWidth / (img.clientWidth || 1);
        const scaleY = img.naturalHeight / (img.clientHeight || 1);
        const outW = Math.max(img.naturalWidth, Math.round(cropState.w * scaleX));
        const outH = Math.max(img.naturalHeight, Math.round(cropState.h * scaleY));
        const dx = Math.round(cropState.x * scaleX);
        const dy = Math.round(cropState.y * scaleY);
        const canvasEl = document.createElement('canvas');
        canvasEl.width = outW;
        canvasEl.height = outH;
        const ctx = canvasEl.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(img, dx, dy, img.naturalWidth, img.naturalHeight);
        const blob = await new Promise(function(resolve){ canvasEl.toBlob(resolve, 'image/png'); });
        if(!blob) return;
        const base = (node.name || 'image').replace(/\.[^.]+$/, '');
        const file = await uploadCroppedBlob(blob, base + '_outpaint.png');
        if(file){
            node.url = file.url;
            node.name = file.name;
            node.mediaKind = 'image';
            node.natural_w = outW;
            node.natural_h = outH;
            closeImageEditor();
            A().render();
            A().scheduleSave();
        }
    }
    async function applyImageMask(){
        if(!cropState) return;
        const node = S().nodes.find(function(n){ return n.id === cropState.nodeId; });
        if(!node || !editCanvasHasPixels()) return;
        const mask = maskCanvasFromDrawCanvas(editDrawCanvas());
        const blob = await new Promise(function(resolve){ mask.toBlob(resolve, 'image/png'); });
        if(!blob) return;
        const base = (node.name || 'image').replace(/\.[^.]+$/, '');
        const file = await uploadCroppedBlob(blob, base + '_mask.png');
        if(file){
            addGeneratedImageNode(file, node, 'mask', 28, {role:'mask'});
            closeImageEditor();
            A().render();
            A().scheduleSave();
        }
    }
    function maskCanvasFromDrawCanvas(src){
        const mask = document.createElement('canvas');
        mask.width = src.width;
        mask.height = src.height;
        const srcCtx = src.getContext('2d');
        const srcData = srcCtx.getImageData(0, 0, src.width, src.height);
        const ctx = mask.getContext('2d');
        const out = ctx.createImageData(mask.width, mask.height);
        for(let i = 0; i < srcData.data.length; i += 4){
            const painted = srcData.data[i + 3] > 8;
            const v = painted ? 255 : 0;
            out.data[i] = v;
            out.data[i + 1] = v;
            out.data[i + 2] = v;
            out.data[i + 3] = 255;
        }
        ctx.putImageData(out, 0, 0);
        return mask;
    }
    async function applyImageBrush(){
        if(!cropState) return;
        const node = S().nodes.find(function(n){ return n.id === cropState.nodeId; });
        const img = document.getElementById('cropImage');
        if(!node || !img.naturalWidth || !img.naturalHeight || !editCanvasHasPixels()) return;
        const canvasEl = document.createElement('canvas');
        canvasEl.width = img.naturalWidth;
        canvasEl.height = img.naturalHeight;
        const ctx = canvasEl.getContext('2d');
        ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
        ctx.drawImage(editDrawCanvas(), 0, 0);
        const blob = await new Promise(function(resolve){ canvasEl.toBlob(resolve, 'image/png'); });
        if(!blob) return;
        const base = (node.name || 'image').replace(/\.[^.]+$/, '');
        const file = await uploadCroppedBlob(blob, base + '_paint.png');
        if(file){
            node.url = file.url;
            node.name = file.name;
            closeImageEditor();
            A().render();
            A().scheduleSave();
        }
    }
    async function applyImageGridSplit(){
        if(!cropState) return;
        const node = S().nodes.find(function(n){ return n.id === cropState.nodeId; });
        const img = document.getElementById('cropImage');
        if(!node || !img.naturalWidth || !img.naturalHeight) return;
        const rects = gridSplitRects(img.naturalWidth, img.naturalHeight);
        if(!rects.length) return;
        const base = (node.name || 'image').replace(/\.[^.]+$/, '');
        const blobs = [];
        for(const rect of rects){
            const canvasEl = document.createElement('canvas');
            canvasEl.width = rect.w;
            canvasEl.height = rect.h;
            canvasEl.getContext('2d').drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
            const blob = await new Promise(function(resolve){ canvasEl.toBlob(resolve, 'image/png'); });
            if(blob) blobs.push({blob, name: base + '_r' + (rect.row + 1) + '_c' + (rect.col + 1) + '.png'});
        }
        if(!blobs.length) return;
        const files = await uploadImageBlobs(blobs);
        if(files.length){
            const out = imageEditorOutputNode(node);
            const urls = files.map(function(file){ return file.url; }).filter(Boolean);
            const layout = gridLayoutFromRects(rects);
            A().appendOutputImages(out, urls, {url:node.url, name:node.name || 'source image'}, urls.map(function(url, i){
                return {
                    runMs:0,
                    run:{prompt:'宫格切分', refs:[{url:node.url, name:node.name || 'source image'}]},
                    grid:{...layout, row:rects[i]?.row || 0, col:rects[i]?.col || 0, w:rects[i]?.w || 1, h:rects[i]?.h || 1}
                };
            }), layout);
            closeImageEditor();
            A().render();
            A().scheduleSave();
        }
    }
    function applyImageEdit(){
        if(imageEditMode === 'outpaint') return applyImageOutpaint();
        if(imageEditMode === 'mask') return applyImageMask();
        if(imageEditMode === 'brush') return applyImageBrush();
        if(imageEditMode === 'grid') return applyImageGridSplit();
        return applyImageCrop();
    }

    // ── 事件监听 ─────────────────────────────────────────────────

    document.getElementById('cropBox').addEventListener('mousedown', function(event){ beginCropDrag(event, 'move'); });
    document.getElementById('cropHandle').addEventListener('mousedown', function(event){ beginCropDrag(event, 'resize'); });
    document.getElementById('outpaintFrame')?.addEventListener('mousedown', function(event){
        if(event.target.closest('[data-outpaint-handle]')) return;
        document.getElementById('cropCanvas')?.classList.add('dragging-image');
        beginCropDrag(event, 'image');
    });
    document.querySelectorAll('[data-outpaint-handle]').forEach(function(handle){
        handle.addEventListener('mousedown', function(event){ beginCropDrag(event, 'outpaint-' + (handle.dataset.outpaintHandle || 'corner')); });
    });
    document.getElementById('cropImage')?.addEventListener('mousedown', function(event){
        if(imageEditMode !== 'outpaint' || !cropState) return;
        document.getElementById('cropCanvas')?.classList.add('dragging-image');
        beginCropDrag(event, 'image');
    });
    document.querySelectorAll('[data-image-edit-mode]').forEach(function(btn){
        btn.addEventListener('click', function(event){
            event.stopPropagation();
            setImageEditMode(btn.dataset.imageEditMode || 'crop', true);
        });
    });
    document.getElementById('editDrawCanvas').addEventListener('pointerdown', beginEditDraw);
    document.getElementById('editDrawCanvas').addEventListener('pointermove', moveEditDraw);
    document.getElementById('editDrawCanvas').addEventListener('pointerup', endEditDraw);
    document.getElementById('editDrawCanvas').addEventListener('pointercancel', endEditDraw);
    document.getElementById('editDrawCanvas').addEventListener('pointerleave', endEditDraw);
    ['gridHorizontalLines','gridVerticalLines','gridGapSize'].forEach(function(id){
        document.getElementById(id).addEventListener('input', function(){
            syncGridGapValue();
            refreshGridSplitPreview();
        });
    });
    // 图片编辑区滚轮缩放
    document.getElementById('imageEditStage').addEventListener('wheel', function(event){
        if(!cropState) return;
        event.preventDefault();
        event.stopPropagation();
        const stage = event.currentTarget;
        const oldZoom = imageEditZoom;
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        imageEditZoom = Math.max(0.15, Math.min(6.0, imageEditZoom * factor));
        // 焦点缩放：保持鼠标指向的图片位置不动
        const stageRect = stage.getBoundingClientRect();
        const mx = event.clientX - stageRect.left; // 鼠标在 stage 内偏移
        const my = event.clientY - stageRect.top;
        const contentX = stage.scrollLeft + mx;
        const contentY = stage.scrollTop + my;
        applyImageEditZoom();
        const scale = imageEditZoom / oldZoom;
        stage.scrollLeft = contentX * scale - mx;
        stage.scrollTop = contentY * scale - my;
    }, {passive: false});
    window.addEventListener('resize', function(){
        if(cropState) syncImageEditOverflow();
    });

    window.addEventListener('mousemove', function(event){
        if(!cropDrag || !cropState) return;
        const dx = event.clientX - cropDrag.sx;
        const dy = event.clientY - cropDrag.sy;
        if(cropDrag.mode === 'move'){
            cropState.x = cropDrag.start.x + dx;
            cropState.y = cropDrag.start.y + dy;
        } else if(cropDrag.mode === 'image'){
            cropState.x = cropDrag.start.x + dx;
            cropState.y = cropDrag.start.y + dy;
        } else if(String(cropDrag.mode || '').startsWith('outpaint-')){
            resizeOutpaintFromDrag(dx, dy);
        } else {
            cropState.w = cropDrag.start.w + dx;
            cropState.h = cropDrag.start.h + dy;
        }
        clampCrop();
        renderCropBox();
    });
    window.addEventListener('mouseup', function(){ cropDrag = null; document.getElementById('cropCanvas')?.classList.remove('dragging-image'); });

    // ── 导出 ─────────────────────────────────────────────────────

    var exports = {
        cropBounds: cropBounds,
        editDrawCanvas: editDrawCanvas,
        resizeEditDrawCanvas: resizeEditDrawCanvas,
        setImageEditMode: setImageEditMode,
        editDrawSnapshot: editDrawSnapshot,
        restoreEditDrawSnapshot: restoreEditDrawSnapshot,
        pushEditDrawHistory: pushEditDrawHistory,
        syncEditDrawingHistoryButtons: syncEditDrawingHistoryButtons,
        undoEditDrawing: undoEditDrawing,
        redoEditDrawing: redoEditDrawing,
        clearEditDrawing: clearEditDrawing,
        resetEditDrawingHistory: resetEditDrawingHistory,
        setBrushTool: setBrushTool,
        syncBrushToolButtons: syncBrushToolButtons,
        editDrawPoint: editDrawPoint,
        gridCustomLineHit: gridCustomLineHit,
        setGridCustomLinePos: setGridCustomLinePos,
        editBrushSize: editBrushSize,
        brushColor: brushColor,
        setupDrawStyle: setupDrawStyle,
        normalizeMaskPreviewCanvas: normalizeMaskPreviewCanvas,
        circledNumber: circledNumber,
        drawBrushShape: drawBrushShape,
        drawNumberLabel: drawNumberLabel,
        beginEditDraw: beginEditDraw,
        moveEditDraw: moveEditDraw,
        endEditDraw: endEditDraw,
        editCanvasHasPixels: editCanvasHasPixels,
        syncGridGapValue: syncGridGapValue,
        gridSplitSettings: gridSplitSettings,
        gridSplitRects: gridSplitRects,
        gridSplitRectsCustom: gridSplitRectsCustom,
        gridLayoutFromRects: gridLayoutFromRects,
        applyGridPreset: applyGridPreset,
        toggleGridCustomMode: toggleGridCustomMode,
        setGridCustomOrientation: setGridCustomOrientation,
        clearGridCustomLines: clearGridCustomLines,
        undoGridCustomLine: undoGridCustomLine,
        _syncGridCustomUndoBtn: _syncGridCustomUndoBtn,
        applyImageEditZoom: applyImageEditZoom,
        syncImageEditOverflow: syncImageEditOverflow,
        resetImageEditZoom: resetImageEditZoom,
        _updateZoomLabel: _updateZoomLabel,
        _syncGridCustomCursor: _syncGridCustomCursor,
        refreshGridSplitPreview: refreshGridSplitPreview,
        imageEditorOutputPoint: imageEditorOutputPoint,
        imageEditorOutputNode: imageEditorOutputNode,
        addGeneratedImageNode: addGeneratedImageNode,
        renderCropBox: renderCropBox,
        outpaintNaturalSize: outpaintNaturalSize,
        updateOutpaintResolutionLabel: updateOutpaintResolutionLabel,
        clampOutpaint: clampOutpaint,
        resetOutpaintBox: resetOutpaintBox,
        resetCropBox: resetCropBox,
        openImageEditor: openImageEditor,
        closeImageEditor: closeImageEditor,
        clampCrop: clampCrop,
        beginCropDrag: beginCropDrag,
        resizeOutpaintFromDrag: resizeOutpaintFromDrag,
        uploadCroppedBlob: uploadCroppedBlob,
        uploadImageBlobs: uploadImageBlobs,
        applyImageCrop: applyImageCrop,
        applyImageOutpaint: applyImageOutpaint,
        applyImageMask: applyImageMask,
        maskCanvasFromDrawCanvas: maskCanvasFromDrawCanvas,
        applyImageBrush: applyImageBrush,
        applyImageGridSplit: applyImageGridSplit,
        applyImageEdit: applyImageEdit
    };

    window.ImageEditor = exports;

    // 暴露 onclick 调用的函数到全局
    window.cropBounds = cropBounds;
    window.setImageEditMode = setImageEditMode;
    window.undoEditDrawing = undoEditDrawing;
    window.redoEditDrawing = redoEditDrawing;
    window.clearEditDrawing = clearEditDrawing;
    window.setBrushTool = setBrushTool;
    window.toggleGridCustomMode = toggleGridCustomMode;
    window.applyGridPreset = applyGridPreset;
    window.setGridCustomOrientation = setGridCustomOrientation;
    window.undoGridCustomLine = undoGridCustomLine;
    window.clearGridCustomLines = clearGridCustomLines;
    window.resetImageEditZoom = resetImageEditZoom;
    window.resetCropBox = resetCropBox;
    window.applyImageEdit = applyImageEdit;
    window.closeImageEditor = closeImageEditor;
    window.openImageEditor = openImageEditor;

})();
