(function () {
    'use strict';

    var dropZone = document.getElementById('canvas-drop-zone');
    var cardsEl = document.getElementById('canvas-cards');
    var cardsWrap = document.getElementById('canvas-cards-wrap');
    var emptyHint = document.getElementById('canvas-empty-hint');
    var zoomOutBtn = document.getElementById('canvas-zoom-out');
    var zoomInBtn = document.getElementById('canvas-zoom-in');
    var zoomLevelEl = document.getElementById('canvas-zoom-level');
    var canvasPane = document.getElementById('canvas-pane');

    var ZOOM_MIN = 0.25;
    var ZOOM_MAX = 2;
    var ZOOM_STEP = 0.25;
    var ZOOM_STORAGE = 'openmud_canvas_zoom';
    var POSITIONS_STORAGE_PREFIX = 'openmud_canvas_pos_';

    var zoom = parseFloat(localStorage.getItem(ZOOM_STORAGE) || '1') || 1;
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));

    function esc(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function ext(name) { return (name || '').split('.').pop().toLowerCase(); }
    function isImage(doc) { return /\.(png|jpg|jpeg|gif|webp)$/i.test(doc.name || '') || (doc.type || '').indexOf('image') >= 0; }
    function isPdf(doc) { return /\.pdf$/i.test(doc.name || '') || (doc.type || '').indexOf('pdf') >= 0; }
    function isText(doc) { return ['txt', 'md', 'json', 'markdown', 'csv', 'tsv', 'js', 'ts', 'html', 'css'].indexOf(ext(doc.name)) >= 0 || (doc.type || '').indexOf('text') >= 0; }
    function formatSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }
    function ab2text(ab) {
        try { return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(ab)); } catch (e) { return null; }
    }
    function truncate(str, maxLen) {
        if (!str) return '';
        var trimmed = str.trim().slice(0, maxLen);
        return trimmed.length < str.trim().length ? trimmed + '...' : trimmed;
    }

    function buildPreview(doc) {
        if (!doc || !doc.data) return null;
        try {
            if (isPdf(doc)) {
                var pdfBlob = new Blob([doc.data], { type: 'application/pdf' });
                var pdfUrl = URL.createObjectURL(pdfBlob);
                return '<div class="canvas-card-preview canvas-card-preview-pdf"><iframe src="' + pdfUrl + '#toolbar=0&navpanes=0&scrollbar=0&view=FitH" title="pdf" tabindex="-1" aria-hidden="true"></iframe></div>';
            }
            if (isImage(doc)) {
                var imgBlob = new Blob([doc.data], { type: doc.type || 'image/png' });
                var imgUrl = URL.createObjectURL(imgBlob);
                return '<div class="canvas-card-preview canvas-card-preview-img"><img src="' + imgUrl + '" alt="" draggable="false"></div>';
            }
            if (isText(doc)) {
                var raw = ab2text(doc.data);
                if (!raw) return null;
                return '<div class="canvas-card-preview canvas-card-preview-text"><pre class="canvas-card-text-inner">' + esc(truncate(raw, 320)) + '</pre></div>';
            }
        } catch (e) {}
        return null;
    }

    function applyZoom() {
        if (cardsWrap) {
            cardsWrap.style.transform = 'scale(' + zoom + ')';
            cardsWrap.style.transformOrigin = 'top left';
        }
        if (zoomLevelEl) zoomLevelEl.textContent = Math.round(zoom * 100) + '%';
        try { localStorage.setItem(ZOOM_STORAGE, String(zoom)); } catch (e) {}
    }

    function getPositions(projectId) {
        try {
            var raw = localStorage.getItem(POSITIONS_STORAGE_PREFIX + (projectId || ''));
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }
    function setPosition(projectId, docId, x, y) {
        var pos = getPositions(projectId);
        pos[docId] = { x: x, y: y };
        try { localStorage.setItem(POSITIONS_STORAGE_PREFIX + (projectId || ''), JSON.stringify(pos)); } catch (e) {}
    }

    function updateCardsSize() {
        if (!cardsEl) return;
        var cards = cardsEl.querySelectorAll('.canvas-card');
        var pad = 40;
        var maxRight = 200, maxBottom = 200;
        cards.forEach(function (c) {
            var l = parseInt(c.style.left, 10) || 0;
            var t = parseInt(c.style.top, 10) || 0;
            var w = c.offsetWidth || 180;
            var h = c.offsetHeight || 220;
            maxRight = Math.max(maxRight, l + w + pad);
            maxBottom = Math.max(maxBottom, t + h + pad);
        });
        cardsEl.style.width = maxRight + 'px';
        cardsEl.style.height = maxBottom + 'px';
        if (cardsWrap) {
            cardsWrap.style.width = maxRight + 'px';
            cardsWrap.style.height = maxBottom + 'px';
        }
    }

    function makeCardDraggable(card, doc, projectId) {
        card.addEventListener('mousedown', function (e) {
            if (e.target.classList.contains('canvas-card-delete') || e.target.tagName === 'IFRAME' || e.button !== 0) return;
            e.preventDefault();
            var startX = e.clientX;
            var startY = e.clientY;
            var startLeft = parseInt(card.style.left, 10) || 0;
            var startTop = parseInt(card.style.top, 10) || 0;
            var didDrag = false;
            document.body.style.userSelect = 'none';
            function onMove(ev) {
                var dx = (ev.clientX - startX) / zoom;
                var dy = (ev.clientY - startY) / zoom;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
                card.style.left = (startLeft + dx) + 'px';
                card.style.top = (startTop + dy) + 'px';
            }
            function onUp() {
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                card._didDrag = didDrag;
                setTimeout(function () { delete card._didDrag; }, 0);
                setPosition(projectId, doc.id, parseInt(card.style.left, 10), parseInt(card.style.top, 10));
                updateCardsSize();
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    function renderCanvas(docs) {
        if (!cardsEl || !emptyHint) return;
        var openmud = window.openmud;
        var projectId = openmud && openmud.getActiveProjectId ? openmud.getActiveProjectId() : null;
        var positions = getPositions(projectId);
        cardsEl.innerHTML = '';
        if (!docs || docs.length === 0) {
            emptyHint.hidden = false;
            return;
        }
        emptyHint.hidden = true;
        docs.forEach(function (doc, idx) {
            var card = document.createElement('div');
            card.className = 'canvas-card';
            card.setAttribute('data-doc-id', doc.id);
            var pos = positions[doc.id];
            if (!pos) {
                var col = idx % 3;
                var row = Math.floor(idx / 3);
                pos = { x: 24 + col * 210, y: 24 + row * 260 };
            }
            card.style.position = 'absolute';
            card.style.left = pos.x + 'px';
            card.style.top = pos.y + 'px';
            var preview = buildPreview(doc) || '<div class="canvas-card-preview canvas-card-preview-text"><pre class="canvas-card-text-inner">' + esc((doc.name || 'Document')) + '</pre></div>';
            card.innerHTML = '<button type="button" class="canvas-card-delete" title="Remove from project">×</button>' + preview + '<div class="canvas-card-footer"><span class="canvas-card-name" title="' + esc(doc.name) + '">' + esc(doc.name || 'Document') + '</span><span class="canvas-card-size">' + formatSize(doc.size) + '</span></div>';
            card.addEventListener('click', function (e) {
                if (e.target.classList.contains('canvas-card-delete') || card._didDrag) return;
                if (openmud && openmud.openDocument) openmud.openDocument(doc);
            });
            var del = card.querySelector('.canvas-card-delete');
            if (del) {
                del.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (openmud && openmud.deleteDocument) {
                        openmud.deleteDocument(doc.id).then(function () {
                            openmud.renderDocuments && openmud.renderDocuments();
                            openmud.renderCanvas && openmud.renderCanvas();
                        });
                    }
                });
            }
            makeCardDraggable(card, doc, projectId);
            cardsEl.appendChild(card);
        });
        requestAnimationFrame(updateCardsSize);
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        if (dropZone) dropZone.classList.remove('drag-over');
        var openmud = window.openmud;
        if (!openmud || !openmud.getActiveProjectId || !openmud.saveDocument) return;
        var projectId = openmud.getActiveProjectId();
        var files = e.dataTransfer && e.dataTransfer.files;
        if (!projectId || !files || !files.length) return;
        Array.from(files).forEach(function (file) {
            if (file.size <= 50 * 1024 * 1024) {
                openmud.saveDocument(projectId, file).then(function () {
                    openmud.renderDocuments && openmud.renderDocuments();
                    openmud.renderCanvas && openmud.renderCanvas();
                });
            }
        });
    }

    if (dropZone) {
        dropZone.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', function (e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over'); });
        dropZone.addEventListener('drop', handleDrop);
    }
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', function () { zoom = Math.max(ZOOM_MIN, zoom - ZOOM_STEP); applyZoom(); });
    if (zoomInBtn) zoomInBtn.addEventListener('click', function () { zoom = Math.min(ZOOM_MAX, zoom + ZOOM_STEP); applyZoom(); });
    if (window.ResizeObserver && canvasPane) new ResizeObserver(function () { updateCardsSize(); }).observe(canvasPane);
    applyZoom();

    window.openmudInitCanvas = function (openmud) {
        openmud.renderCanvas = function () {
            var projectId = openmud.getActiveProjectId ? openmud.getActiveProjectId() : null;
            if (!projectId || !openmud.getDocuments) return renderCanvas([]);
            openmud.getDocuments(projectId).then(renderCanvas);
        };
    };
})();
