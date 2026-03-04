(function () {
    'use strict';

    var dropZone   = document.getElementById('canvas-drop-zone');
    var cardsEl    = document.getElementById('canvas-cards');
    var cardsWrap  = document.getElementById('canvas-cards-wrap');
    var emptyHint  = document.getElementById('canvas-empty-hint');
    var zoomOutBtn = document.getElementById('canvas-zoom-out');
    var zoomInBtn  = document.getElementById('canvas-zoom-in');
    var zoomLevelEl = document.getElementById('canvas-zoom-level');
    var canvasPane = document.getElementById('canvas-pane');

    var ZOOM_MIN = 0.25;
    var ZOOM_MAX = 2;
    var ZOOM_STEP = 0.25;
    var ZOOM_STORAGE = 'mudrag_canvas_zoom';
    var POSITIONS_STORAGE_PREFIX = 'mudrag_canvas_pos_';

    var zoom = parseFloat(localStorage.getItem(ZOOM_STORAGE) || '1') || 1;
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));

    // ── Helpers ──────────────────────────────────────────────────────────────
    function ext(name) { return (name || '').split('.').pop().toLowerCase(); }
    function isImage(doc) { return /\.(png|jpg|jpeg|gif|webp)$/i.test(doc.name || '') || (doc.type || '').indexOf('image') >= 0; }
    function isPdf(doc) { return /\.pdf$/i.test(doc.name || '') || (doc.type || '').indexOf('pdf') >= 0; }
    function isText(doc) { var e = ext(doc.name); return ['txt', 'md', 'json', 'markdown', 'csv', 'tsv', 'js', 'ts', 'html', 'css'].indexOf(e) >= 0 || (doc.type || '').indexOf('text') >= 0; }

    function formatSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function ab2text(ab) {
        try {
            return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(ab));
        } catch (e) { return null; }
    }

    function truncate(str, maxLen) {
        if (!str) return '';
        var trimmed = str.trim().slice(0, maxLen);
        return trimmed.length < str.trim().length ? trimmed + '…' : trimmed;
    }

    function esc(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Preview builders ─────────────────────────────────────────────────────
    function buildImagePreview(doc) {
        if (!doc.data) return null;
        try {
            var blob = new Blob([doc.data], { type: doc.type || 'image/png' });
            var url = URL.createObjectURL(blob);
            return '<div class="canvas-card-preview canvas-card-preview-img"><img src="' + url + '" alt="" draggable="false"></div>';
        } catch (e) { return null; }
    }

    function buildTextPreview(doc) {
        if (!doc.data) return null;
        var raw = ab2text(doc.data);
        if (!raw) return null;
        var e2 = ext(doc.name);
        var lines = raw.split('\n').slice(0, 8).map(function (l) { return esc(l); }).join('\n');
        var preview = truncate(lines, 300);
        return '<div class="canvas-card-preview canvas-card-preview-text">' +
            '<pre class="canvas-card-text-inner">' + preview + '</pre>' +
            '</div>';
    }

    function buildPdfPreview(doc) {
        if (!doc.data) return null;
        try {
            var blob = new Blob([doc.data], { type: 'application/pdf' });
            var url = URL.createObjectURL(blob);
            return '<div class="canvas-card-preview canvas-card-preview-pdf">' +
                '<iframe src="' + url + '#toolbar=0&navpanes=0&scrollbar=0&view=FitH" title="pdf" tabindex="-1" aria-hidden="true"></iframe>' +
                '</div>';
        } catch (e) { return null; }
    }

    function buildDocIcon(doc) {
        var icons = {
            pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>',
            md:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M10 13l-2 3 2 3m4-6l2 3-2 3"/></svg>',
            csv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
            xlsx:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
            img: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
            doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
        };
        var e2 = ext(doc.name);
        var svg = icons[e2] || icons[['jpg','jpeg','png','gif','webp'].indexOf(e2) >= 0 ? 'img' : ['xlsx','xls'].indexOf(e2) >= 0 ? 'xlsx' : 'doc'];
        return svg || icons.doc;
    }

    function buildPreview(doc) {
        if (isPdf(doc)) return buildPdfPreview(doc);
        if (isImage(doc)) return buildImagePreview(doc);
        if (isText(doc)) return buildTextPreview(doc);
        return null;
    }

    // ── Zoom ─────────────────────────────────────────────────────────────────
    function applyZoom() {
        if (cardsWrap) {
            cardsWrap.style.transform = 'scale(' + zoom + ')';
            // Adjust the wrapper's reported size so the scroll container knows the true content size
            cardsWrap.style.transformOrigin = 'top left';
        }
        if (zoomLevelEl) zoomLevelEl.textContent = Math.round(zoom * 100) + '%';
        try { localStorage.setItem(ZOOM_STORAGE, String(zoom)); } catch (e) {}
    }

    /** Compute zoom so all cards fit within the visible canvas pane */
    function fitToView() {
        if (!cardsEl || !canvasPane) return;
        var cards = cardsEl.querySelectorAll('.canvas-card');
        if (!cards.length) return;
        var maxRight = 0, maxBottom = 0;
        cards.forEach(function (c) {
            var l = parseInt(c.style.left, 10) || 0;
            var t = parseInt(c.style.top, 10) || 0;
            var w = c.offsetWidth || 160;
            var h = c.offsetHeight || 200;
            maxRight  = Math.max(maxRight,  l + w);
            maxBottom = Math.max(maxBottom, t + h);
        });
        // Available canvas area (with padding)
        var pad = 32;
        var availW = (canvasPane.clientWidth  || 400) - pad * 2;
        var availH = (canvasPane.clientHeight || 400) - pad * 2;
        var needed = Math.min(availW / (maxRight + pad), availH / (maxBottom + pad));
        var fitted = Math.floor(needed / ZOOM_STEP) * ZOOM_STEP; // snap to step
        fitted = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitted));
        // Only zoom out — never zoom in automatically
        if (fitted < zoom) {
            zoom = fitted;
            applyZoom();
        }
    }

    // ── Positions ────────────────────────────────────────────────────────────
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

    // ── Drag (no text selection) ──────────────────────────────────────────────
    function makeCardDraggable(card, doc, projectId) {
        card.addEventListener('mousedown', function (e) {
            if (e.target.classList.contains('canvas-card-delete')) return;
            if (e.target.tagName === 'IFRAME') return;
            if (e.button !== 0) return;
            e.preventDefault(); // prevent text selection during drag

            var startX = e.clientX;
            var startY = e.clientY;
            var startLeft = parseInt(card.style.left, 10) || 0;
            var startTop  = parseInt(card.style.top,  10) || 0;
            var didDrag = false;

            card.classList.add('canvas-card-dragging');
            document.body.style.userSelect = 'none';
            document.body.style.webkitUserSelect = 'none';

            function onMove(ev) {
                var dx = (ev.clientX - startX) / zoom;
                var dy = (ev.clientY - startY) / zoom;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
                card.style.left = (startLeft + dx) + 'px';
                card.style.top  = (startTop  + dy) + 'px';
            }

            function onUp() {
                card.classList.remove('canvas-card-dragging');
                document.body.style.userSelect = '';
                document.body.style.webkitUserSelect = '';
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

    // ── Update canvas-cards size to wrap content ──────────────────────────────
    function updateCardsSize() {
        if (!cardsEl) return;
        var cards = cardsEl.querySelectorAll('.canvas-card');
        var pad = 40;
        var maxRight = 200, maxBottom = 200;
        cards.forEach(function (c) {
            var l = parseInt(c.style.left, 10) || 0;
            var t = parseInt(c.style.top,  10) || 0;
            var w = c.offsetWidth  || 168;
            var h = c.offsetHeight || 240;
            maxRight  = Math.max(maxRight,  l + w + pad);
            maxBottom = Math.max(maxBottom, t + h + pad);
        });
        cardsEl.style.width  = maxRight  + 'px';
        cardsEl.style.height = maxBottom + 'px';
        // cardsWrap layout size = pre-scaled dims (transform doesn't affect layout)
        if (cardsWrap) {
            cardsWrap.style.width  = maxRight  + 'px';
            cardsWrap.style.height = maxBottom + 'px';
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────
    function renderCanvas(docs) {
        if (!cardsEl || !emptyHint) return;
        var mudrag = window.mudrag;
        var projectId = mudrag && mudrag.getActiveProjectId ? mudrag.getActiveProjectId() : null;
        var positions = getPositions(projectId);

        cardsEl.innerHTML = '';
        if (!docs || docs.length === 0) {
            emptyHint.hidden = false;
            if (cardsWrap) { cardsWrap.style.width = ''; cardsWrap.style.height = ''; }
            return;
        }
        emptyHint.hidden = true;

        docs.forEach(function (doc, idx) {
            var card = document.createElement('div');
            card.className = 'canvas-card';
            card.setAttribute('data-doc-id', doc.id);

            var pos = positions[doc.id];
            if (!pos) {
                // Default grid layout: 3 columns
                var col = idx % 3;
                var row = Math.floor(idx / 3);
                pos = { x: 24 + col * 200, y: 24 + row * 260 };
            }
            card.style.position = 'absolute';
            card.style.left = pos.x + 'px';
            card.style.top  = pos.y + 'px';

            // Build preview
            var preview = buildPreview(doc);
            var previewHtml = preview || (
                '<div class="canvas-card-preview canvas-card-preview-icon">' +
                    '<span class="canvas-card-icon-svg">' + buildDocIcon(doc) + '</span>' +
                '</div>'
            );

            card.innerHTML =
                '<button type="button" class="canvas-card-delete" title="Remove from canvas">×</button>' +
                previewHtml +
                '<div class="canvas-card-footer">' +
                    '<span class="canvas-card-name" title="' + esc(doc.name) + '">' + esc(doc.name || 'Document') + '</span>' +
                    '<span class="canvas-card-size">' + formatSize(doc.size) + '</span>' +
                '</div>';

            card.addEventListener('click', function (e) {
                if (e.target.classList.contains('canvas-card-delete')) return;
                if (card._didDrag) return;
                if (mudrag && mudrag.openDocument) mudrag.openDocument(doc);
            });

            var btnDel = card.querySelector('.canvas-card-delete');
            if (btnDel) {
                btnDel.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (mudrag && mudrag.deleteDocument && mudrag.renderDocuments && mudrag.renderCanvas) {
                        mudrag.deleteDocument(doc.id).then(function () {
                            mudrag.renderDocuments();
                            mudrag.renderCanvas();
                        });
                    }
                });
            }

            makeCardDraggable(card, doc, projectId);
            cardsEl.appendChild(card);
        });

        // Size the canvas to fit all cards, then fit-to-view
        requestAnimationFrame(function () {
            updateCardsSize();
            fitToView();
        });
    }

    // ── Drop zone ─────────────────────────────────────────────────────────────
    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        if (dropZone) dropZone.classList.remove('drag-over');
        var mudrag = window.mudrag;
        if (!mudrag || !mudrag.getActiveProjectId || !mudrag.saveDocument || !mudrag.renderDocuments) return;
        var projectId = mudrag.getActiveProjectId();
        if (!projectId) return;
        var files = e.dataTransfer && e.dataTransfer.files;
        if (!files || !files.length) return;
        Array.from(files).forEach(function (file) {
            if (file.size <= 50 * 1024 * 1024) {
                mudrag.saveDocument(projectId, file).then(function () {
                    mudrag.renderDocuments();
                    mudrag.renderCanvas && mudrag.renderCanvas();
                });
            }
        });
    }

    if (dropZone) {
        dropZone.addEventListener('dragover',  function (e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', function (e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over'); });
        dropZone.addEventListener('drop', handleDrop);
    }

    if (zoomOutBtn) zoomOutBtn.addEventListener('click', function () { zoom = Math.max(ZOOM_MIN, zoom - ZOOM_STEP); applyZoom(); });
    if (zoomInBtn)  zoomInBtn.addEventListener('click',  function () { zoom = Math.min(ZOOM_MAX, zoom + ZOOM_STEP); applyZoom(); });

    // Re-fit when the panel is resized
    if (window.ResizeObserver && canvasPane) {
        new ResizeObserver(function () { fitToView(); }).observe(canvasPane);
    }

    applyZoom();

    window.mudragInitCanvas = function (mudrag) {
        mudrag.renderCanvas = function () {
            var projectId = mudrag.getActiveProjectId ? mudrag.getActiveProjectId() : null;
            if (!projectId) { renderCanvas([]); return; }
            mudrag.getDocuments(projectId).then(renderCanvas);
        };
    };
})();
