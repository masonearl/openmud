(function () {
    'use strict';

    var viewerPane = document.getElementById('document-viewer-pane');
    var viewerContent = document.getElementById('document-viewer-content');
    var docTabsEl = document.getElementById('doc-tabs');
    var canvasPane = document.getElementById('canvas-pane');
    var focusTabCanvas = document.getElementById('focus-tab-canvas');

    var openTabs = [];
    var activeTabIdx = -1;

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    function getExt(name) { var m = (name || '').match(/\.([^.]+)$/); return m ? m[1].toLowerCase() : ''; }
    function fileIcon(name) {
        var e = getExt(name);
        return { md: 'M', pdf: 'PDF', csv: 'CSV', xlsx: 'XLSX', xls: 'XLS', docx: 'DOCX', doc: 'DOC', png: 'IMG', jpg: 'IMG', jpeg: 'IMG', gif: 'IMG', webp: 'IMG', json: 'JSON', txt: 'TXT' }[e] || 'DOC';
    }
    function detectType(doc) {
        var type = (doc.type || '').toLowerCase();
        var name = (doc.name || '').toLowerCase();
        if (type.indexOf('csv') >= 0 || name.endsWith('.csv') || name.endsWith('.tsv')) return 'csv';
        if (type.indexOf('spreadsheet') >= 0 || type.indexOf('excel') >= 0 || name.endsWith('.xlsx') || name.endsWith('.xls')) return 'xlsx';
        if (type.indexOf('pdf') >= 0 || name.endsWith('.pdf')) return 'pdf';
        if (type.indexOf('image') >= 0 || /\.(png|jpg|jpeg|gif|webp)$/i.test(name)) return 'image';
        if (type.indexOf('wordprocessingml') >= 0 || type.indexOf('msword') >= 0 || name.endsWith('.docx') || name.endsWith('.doc')) return 'docx';
        if (name.endsWith('.json')) return 'json';
        if (name.endsWith('.md') || name.endsWith('.markdown')) return 'md';
        if (type.indexOf('text') >= 0 || /\.(txt|js|ts|html|css|sh|yaml|yml|xml|ini|env|log)$/i.test(name)) return 'text';
        return 'unknown';
    }

    function parseCSV(text) {
        if (typeof Papa !== 'undefined') return Papa.parse(text, { skipEmptyLines: false }).data || [];
        return text.split('\n').map(function (l) { return l.split(','); });
    }
    function serializeCSV(rows) {
        return rows.map(function (row) {
            return row.map(function (cell) {
                var s = String(cell === null || cell === undefined ? '' : cell);
                return (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) ? '"' + s.replace(/"/g, '""') + '"' : s;
            }).join(',');
        }).join('\n');
    }

    function renderTabBar() {
        if (!docTabsEl) return;
        docTabsEl.innerHTML = '';
        openTabs.forEach(function (tab, idx) {
            var el = document.createElement('div');
            el.className = 'doc-tab' + (idx === activeTabIdx ? ' doc-tab-active' : '');
            el.title = tab.doc.name || '';
            el.innerHTML = '<span class="doc-tab-icon">' + fileIcon(tab.doc.name) + '</span><span class="doc-tab-name">' + esc(tab.doc.name || 'Untitled') + '</span><button type="button" class="doc-tab-close" aria-label="Close">×</button>';
            el.querySelector('.doc-tab-close').addEventListener('click', function (e) { e.stopPropagation(); closeTab(idx); });
            el.addEventListener('click', function () { activateTab(idx); });
            docTabsEl.appendChild(el);
        });
    }

    function modePills(modes, active) {
        return modes.map(function (m) {
            return '<button type="button" class="dv-pill' + (m.id === active ? ' dv-pill-active' : '') + '" data-mode="' + m.id + '">' + m.label + '</button>';
        }).join('');
    }
    function makeToolbar(leftHtml, rightHtml) {
        return '<div class="dv-toolbar"><div class="dv-toolbar-left">' + (leftHtml || '') + '</div><div class="dv-toolbar-right">' + (rightHtml || '') + '</div></div>';
    }
    function colLabel(n) {
        var s = '';
        do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
        return s;
    }
    function renderCSVTable(rows, editable) {
        if (!rows || !rows.length) return '<p class="dv-empty">Empty file</p>';
        var maxCols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
        var html = '<div class="dv-spreadsheet"><table class="dv-csv-table"><thead><tr><th></th>';
        for (var c = 0; c < maxCols; c++) html += '<th>' + colLabel(c) + '</th>';
        html += '</tr></thead><tbody>';
        rows.forEach(function (row, ri) {
            html += '<tr><th>' + (ri + 1) + '</th>';
            for (var ci = 0; ci < maxCols; ci++) {
                var val = esc(row[ci] !== undefined ? String(row[ci]) : '');
                var tag = ri === 0 ? 'th' : 'td';
                if (editable) html += '<' + tag + ' contenteditable="true" data-row="' + ri + '" data-col="' + ci + '">' + val + '</' + tag + '>';
                else html += '<' + tag + '>' + val + '</' + tag + '>';
            }
            html += '</tr>';
        });
        html += '</tbody></table></div>';
        return html;
    }

    function renderMarkdown(md) {
        if (!md) return '';
        return esc(md)
            .replace(/^### (.*)$/gm, '<h3>$1</h3>')
            .replace(/^## (.*)$/gm, '<h2>$1</h2>')
            .replace(/^# (.*)$/gm, '<h1>$1</h1>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }

    function buildContent(tab) {
        if (tab.type === 'pdf') return '<div class="dv-pdf-wrap"><iframe src="' + tab.pdfUrl + '" title="' + esc(tab.doc.name) + '"></iframe></div>';
        if (tab.type === 'image') return '<div class="dv-viewer-wrap">' + makeToolbar('<span class="dv-type-label">' + esc(tab.doc.name || '') + '</span>', '') + '<div class="dv-body"><div class="dv-img-wrap"><img src="' + tab.imgUrl + '" alt="' + esc(tab.doc.name || '') + '"></div></div></div>';
        if (tab.type === 'csv') {
            var tableMode = tab.viewMode !== 'code';
            return '<div class="dv-viewer-wrap">' + makeToolbar(modePills([{ id: 'table', label: 'Table' }, { id: 'code', label: 'Code' }], tableMode ? 'table' : 'code'), '<button class="dv-btn" data-action="save-csv">Save</button>') + '<div class="dv-body">' + (tableMode ? renderCSVTable(tab.parsedData, true) : '<textarea class="dv-code-editor" data-action="csv-raw">' + esc(tab.rawText || '') + '</textarea>') + '</div></div>';
        }
        if (tab.type === 'xlsx' && tab.parsedData) {
            var si = tab.excelSheetIdx || 0;
            var sheet = tab.parsedData.sheets[si];
            var sheetTabs = tab.parsedData.sheets.map(function (s, i) {
                return '<button class="dv-pill' + (i === si ? ' dv-pill-active' : '') + '" data-sheet="' + i + '">' + esc(s.name) + '</button>';
            }).join('');
            return '<div class="dv-viewer-wrap">' + makeToolbar(sheetTabs, '') + '<div class="dv-body">' + renderCSVTable((sheet && sheet.data) || [], false) + '</div></div>';
        }
        if (tab.type === 'md') {
            var preview = tab.viewMode !== 'edit';
            return '<div class="dv-viewer-wrap">' + makeToolbar(modePills([{ id: 'preview', label: 'Preview' }, { id: 'edit', label: 'Edit' }], preview ? 'preview' : 'edit'), '<button class="dv-btn" data-action="save-text">Save</button>') + '<div class="dv-body">' + (preview ? '<div class="doc-viewer-md">' + renderMarkdown(tab.rawText || '') + '</div>' : '<textarea class="dv-code-editor" data-action="text-raw">' + esc(tab.rawText || '') + '</textarea>') + '</div></div>';
        }
        if (tab.type === 'json') return '<div class="dv-viewer-wrap">' + makeToolbar('', '<button class="dv-btn" data-action="save-text">Save</button>') + '<div class="dv-body"><textarea class="dv-code-editor" data-action="text-raw">' + esc(tab.rawText || '') + '</textarea></div></div>';
        if (tab.type === 'docx') return '<div class="dv-viewer-wrap">' + makeToolbar('<span class="dv-type-label">DOCX</span>', '') + '<div class="dv-body"><div class="doc-viewer-docx">' + (tab.docxHtml || '<p>Could not render.</p>') + '</div></div></div>';
        return '<div class="dv-viewer-wrap">' + makeToolbar('<span class="dv-type-label">Text</span>', '<button class="dv-btn" data-action="save-text">Save</button>') + '<div class="dv-body"><textarea class="dv-code-editor" data-action="text-raw">' + esc(tab.rawText || '') + '</textarea></div></div>';
    }

    function doSave(tab, idx) {
        var text = tab.rawText || '';
        var buf = new TextEncoder().encode(text).buffer;
        tab.doc.data = buf;
        tab.doc.size = buf.byteLength;
        if (window.openmud && window.openmud.updateDocumentContent) {
            window.openmud.updateDocumentContent(tab.doc.id, buf).then(function () {
                paintTab(idx);
            });
        }
    }

    function paintTab(idx) {
        if (idx < 0 || idx >= openTabs.length || !viewerContent) return;
        var tab = openTabs[idx];
        viewerContent.innerHTML = buildContent(tab);
        wireTabEvents(tab, idx);
    }

    function wireTabEvents(tab, idx) {
        viewerContent.querySelectorAll('.dv-pill[data-mode]').forEach(function (btn) {
            btn.addEventListener('click', function () { tab.viewMode = btn.getAttribute('data-mode'); paintTab(idx); });
        });
        viewerContent.querySelectorAll('.dv-pill[data-sheet]').forEach(function (btn) {
            btn.addEventListener('click', function () { tab.excelSheetIdx = parseInt(btn.getAttribute('data-sheet'), 10); paintTab(idx); });
        });
        viewerContent.querySelectorAll('[data-row][data-col]').forEach(function (cell) {
            cell.addEventListener('input', function () {
                var r = parseInt(cell.getAttribute('data-row'), 10);
                var c = parseInt(cell.getAttribute('data-col'), 10);
                if (!tab.parsedData[r]) tab.parsedData[r] = [];
                tab.parsedData[r][c] = cell.textContent;
                tab.rawText = serializeCSV(tab.parsedData);
            });
        });
        var csvRaw = viewerContent.querySelector('[data-action="csv-raw"]');
        if (csvRaw) csvRaw.addEventListener('input', function () { tab.rawText = csvRaw.value; tab.parsedData = parseCSV(tab.rawText); });
        var txtRaw = viewerContent.querySelector('[data-action="text-raw"]');
        if (txtRaw) txtRaw.addEventListener('input', function () { tab.rawText = txtRaw.value; });
        var saveCSV = viewerContent.querySelector('[data-action="save-csv"]');
        if (saveCSV) saveCSV.addEventListener('click', function () { doSave(tab, idx); });
        var saveText = viewerContent.querySelector('[data-action="save-text"]');
        if (saveText) saveText.addEventListener('click', function () { doSave(tab, idx); });
    }

    function activateTab(idx) {
        if (idx < 0 || idx >= openTabs.length) return;
        activeTabIdx = idx;
        if (window.openmudSetMainFocus) window.openmudSetMainFocus('document');
        if (viewerPane) viewerPane.hidden = false;
        if (canvasPane) canvasPane.hidden = true;
        if (focusTabCanvas) focusTabCanvas.classList.remove('focus-tab-active');
        paintTab(idx);
        renderTabBar();
    }
    function closeTab(idx) {
        openTabs.splice(idx, 1);
        if (!openTabs.length) {
            activeTabIdx = -1;
            if (viewerPane) viewerPane.hidden = true;
            if (viewerContent) viewerContent.innerHTML = '';
            if (window.openmudSetMainFocus) window.openmudSetMainFocus('canvas');
            if (canvasPane) canvasPane.hidden = false;
            if (focusTabCanvas) focusTabCanvas.classList.add('focus-tab-active');
        } else {
            activateTab(Math.min(idx, openTabs.length - 1));
        }
        renderTabBar();
    }
    function closeDocument() {
        openTabs = [];
        activeTabIdx = -1;
        if (viewerPane) viewerPane.hidden = true;
        if (viewerContent) viewerContent.innerHTML = '';
        renderTabBar();
        if (window.openmudSetMainFocus) window.openmudSetMainFocus('canvas');
        if (canvasPane) canvasPane.hidden = false;
        if (focusTabCanvas) focusTabCanvas.classList.add('focus-tab-active');
    }
    function setFocus(focus) {
        if (window.openmudSetMainFocus) window.openmudSetMainFocus(focus === 'document' ? 'document' : 'canvas');
    }

    function openDocument(doc) {
        if (!doc) return;
        for (var i = 0; i < openTabs.length; i++) {
            if (openTabs[i].doc.id === doc.id) return activateTab(i);
        }
        var type = detectType(doc);
        var blob = new Blob([doc.data || new ArrayBuffer(0)], { type: doc.type || 'application/octet-stream' });
        var tab = { doc: doc, type: type, viewMode: 'preview' };
        if (type === 'pdf') {
            tab.pdfUrl = URL.createObjectURL(blob);
            openTabs.push(tab);
            return activateTab(openTabs.length - 1);
        }
        if (type === 'image') {
            tab.imgUrl = URL.createObjectURL(blob);
            openTabs.push(tab);
            return activateTab(openTabs.length - 1);
        }
        if (type === 'csv') {
            var rCSV = new FileReader();
            rCSV.onload = function () {
                tab.rawText = rCSV.result || '';
                tab.parsedData = parseCSV(tab.rawText);
                tab.viewMode = 'table';
                openTabs.push(tab);
                activateTab(openTabs.length - 1);
            };
            return rCSV.readAsText(blob);
        }
        if (type === 'xlsx') {
            var rXL = new FileReader();
            rXL.onload = function () {
                if (typeof XLSX !== 'undefined') {
                    try {
                        var wb = XLSX.read(rXL.result, { type: 'array' });
                        tab.parsedData = { sheets: wb.SheetNames.map(function (sn) { return { name: sn, data: XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1 }) }; }) };
                        tab.excelSheetIdx = 0;
                    } catch (e) { tab.parsedData = null; }
                }
                openTabs.push(tab);
                activateTab(openTabs.length - 1);
            };
            return rXL.readAsArrayBuffer(blob);
        }
        if (type === 'docx') {
            var rDX = new FileReader();
            rDX.onload = function () {
                if (typeof mammoth !== 'undefined') {
                    mammoth.convertToHtml({ arrayBuffer: rDX.result }).then(function (res) {
                        tab.docxHtml = res.value;
                        openTabs.push(tab);
                        activateTab(openTabs.length - 1);
                    }).catch(function () {
                        openTabs.push(tab);
                        activateTab(openTabs.length - 1);
                    });
                } else {
                    openTabs.push(tab);
                    activateTab(openTabs.length - 1);
                }
            };
            return rDX.readAsArrayBuffer(blob);
        }
        var rText = new FileReader();
        rText.onload = function () {
            tab.rawText = rText.result || '';
            tab.viewMode = type === 'md' ? 'preview' : 'edit';
            openTabs.push(tab);
            activateTab(openTabs.length - 1);
        };
        rText.readAsText(blob);
    }

    if (focusTabCanvas) {
        focusTabCanvas.addEventListener('click', function () {
            if (window.openmudSetMainFocus) window.openmudSetMainFocus('canvas');
        });
    }

    window.openmudInitDocumentViewer = function (openmud) {
        openmud.openDocument = openDocument;
        openmud.closeDocument = closeDocument;
        openmud.setFocus = setFocus;
        openmud.getCurrentDocument = function () { return openTabs[activeTabIdx] ? openTabs[activeTabIdx].doc : null; };
    };
})();
