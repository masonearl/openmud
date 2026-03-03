(function () {
    'use strict';

    // ── Markdown renderer ───────────────────────────────────────────────────────
    function renderMarkdown(md) {
        if (!md) return '';
        var lines = md.split('\n');
        var html = '', inCode = false, codeLang = '', codeLines = [];
        var inList = false, inOL = false, inBQ = false, inTable = false;

        function flushList() { if (inList) { html += '</ul>'; inList = false; } if (inOL) { html += '</ol>'; inOL = false; } }
        function flushBQ()   { if (inBQ)   { html += '</blockquote>'; inBQ = false; } }
        function flushTable(){ if (inTable) { html += '</tbody></table>'; inTable = false; } }

        function inline(t) {
            return t
                .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                .replace(/`([^`]+)`/g,'<code>$1</code>')
                .replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>')
                .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
                .replace(/__(.+?)__/g,'<strong>$1</strong>')
                .replace(/\*(.+?)\*/g,'<em>$1</em>')
                .replace(/_(.+?)_/g,'<em>$1</em>')
                .replace(/~~(.+?)~~/g,'<del>$1</del>')
                .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
        }

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (/^```/.test(line)) {
                if (!inCode) { flushList(); flushBQ(); flushTable(); inCode = true; codeLang = line.slice(3).trim(); codeLines = []; }
                else {
                    html += '<pre class="doc-viewer-code-block"' + (codeLang ? ' data-lang="' + codeLang + '"' : '') + '><code>' +
                        codeLines.join('\n').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</code></pre>';
                    inCode = false; codeLines = []; codeLang = '';
                }
                continue;
            }
            if (inCode) { codeLines.push(line); continue; }
            if (line.trim() === '') { flushList(); flushBQ(); flushTable(); html += '<div class="md-spacer"></div>'; continue; }
            if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) { flushList(); flushBQ(); flushTable(); html += '<hr class="md-hr">'; continue; }
            var hm = line.match(/^(#{1,6})\s+(.+)/);
            if (hm) { flushList(); flushBQ(); flushTable(); var lv = hm[1].length; html += '<h'+lv+' class="md-h'+lv+'">'+inline(hm[2])+'</h'+lv+'>'; continue; }

            // Tables
            if (/^\|/.test(line)) {
                if (/^\|[\s|:-]+\|$/.test(line.trim())) { continue; } // separator
                var cells = line.split('|').slice(1,-1).map(function(c){ return inline(c.trim()); });
                if (!inTable) {
                    flushList(); flushBQ();
                    html += '<table class="md-table"><thead><tr>';
                    cells.forEach(function(c){ html += '<th>'+c+'</th>'; });
                    html += '</tr></thead><tbody>';
                    inTable = true;
                } else {
                    html += '<tr>'; cells.forEach(function(c){ html += '<td>'+c+'</td>'; }); html += '</tr>';
                }
                var nxt = lines[i+1] || '';
                if (!/^\|/.test(nxt)) { flushTable(); }
                continue;
            }
            flushTable();

            var bqm = line.match(/^>\s?(.*)/);
            if (bqm) { flushList(); if (!inBQ) { html += '<blockquote class="md-blockquote">'; inBQ = true; } html += '<p>'+inline(bqm[1])+'</p>'; continue; }
            if (inBQ) flushBQ();

            var ulm = line.match(/^(\s*)[-*+]\s+(.+)/);
            if (ulm) { if (inOL){html+='</ol>';inOL=false;} if (!inList){html+='<ul class="md-ul">';inList=true;} html+='<li>'+inline(ulm[2])+'</li>'; continue; }
            var olm = line.match(/^\s*\d+\.\s+(.+)/);
            if (olm) { if (inList){html+='</ul>';inList=false;} if (!inOL){html+='<ol class="md-ol">';inOL=true;} html+='<li>'+inline(olm[1])+'</li>'; continue; }

            flushList();
            html += '<p class="md-p">'+inline(line)+'</p>';
        }
        flushList(); flushBQ(); flushTable();
        if (inCode && codeLines.length) html += '<pre class="doc-viewer-code-block"><code>' + codeLines.join('\n').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</code></pre>';
        return html;
    }

    // ── JSON syntax highlight ───────────────────────────────────────────────────
    function highlightJSON(str) {
        str = str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        return str.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function(m) {
            var cls = 'json-num';
            if (/^"/.test(m)) cls = /:$/.test(m) ? 'json-key' : 'json-str';
            else if (/true|false/.test(m)) cls = 'json-bool';
            else if (/null/.test(m)) cls = 'json-null';
            return '<span class="'+cls+'">'+m+'</span>';
        });
    }

    // ── CSV serialize/parse ─────────────────────────────────────────────────────
    function parseCSV(text) {
        if (typeof Papa !== 'undefined') {
            return Papa.parse(text, { skipEmptyLines: false }).data || [];
        }
        // Fallback: naive split
        return text.split('\n').map(function(l){ return l.split(','); });
    }

    function serializeCSV(rows) {
        return rows.map(function(row) {
            return row.map(function(cell) {
                var s = String(cell === null || cell === undefined ? '' : cell);
                return (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0)
                    ? '"' + s.replace(/"/g, '""') + '"' : s;
            }).join(',');
        }).join('\n');
    }

    function colLabel(n) { // 0→A, 1→B, 25→Z, 26→AA
        var s = '';
        do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
        return s;
    }

    // ── DOM refs ────────────────────────────────────────────────────────────────
    var viewerPane    = document.getElementById('document-viewer-pane');
    var viewerContent = document.getElementById('document-viewer-content');
    var docTabsEl     = document.getElementById('doc-tabs');
    var canvasPane    = document.getElementById('canvas-pane');
    var focusTabCanvas = document.getElementById('focus-tab-canvas');

    // ── Tab state ───────────────────────────────────────────────────────────────
    // Each tab: { doc, type, rawText, parsedData, viewMode, dirty, excelSheetIdx }
    var openTabs = [];
    var activeTabIdx = -1;

    function getExt(name) { var m=(name||'').match(/\.([^.]+)$/); return m?m[1].toLowerCase():''; }

    function fileIcon(name) {
        var e = getExt(name);
        return { md:'📝', pdf:'📄', csv:'📊', xlsx:'📊', xls:'📊', docx:'📄', doc:'📄',
                 png:'🖼', jpg:'🖼', jpeg:'🖼', gif:'🖼', webp:'🖼', json:'{ }', txt:'📄' }[e] || '📄';
    }

    function detectType(doc) {
        var type = (doc.type||'').toLowerCase(), name = (doc.name||'').toLowerCase();
        if (type.indexOf('csv')>=0 || name.endsWith('.csv') || name.endsWith('.tsv')) return 'csv';
        if (type.indexOf('spreadsheet')>=0 || type.indexOf('excel')>=0 || name.endsWith('.xlsx') || name.endsWith('.xls')) return 'xlsx';
        if (type.indexOf('pdf')>=0 || name.endsWith('.pdf')) return 'pdf';
        if (type.indexOf('image')>=0 || /\.(png|jpg|jpeg|gif|webp)$/i.test(name)) return 'image';
        if (type.indexOf('wordprocessingml')>=0 || type.indexOf('msword')>=0 || name.endsWith('.docx') || name.endsWith('.doc')) return 'docx';
        if (name.endsWith('.json')) return 'json';
        if (name.endsWith('.md') || name.endsWith('.markdown')) return 'md';
        if (type.indexOf('text')>=0 || /\.(txt|js|ts|html|css|sh|yaml|yml|xml|ini|env|log)$/i.test(name)) return 'text';
        return 'unknown';
    }

    // ── Tab bar ─────────────────────────────────────────────────────────────────
    function renderTabBar() {
        if (!docTabsEl) return;
        docTabsEl.innerHTML = '';
        openTabs.forEach(function(tab, idx) {
            var el = document.createElement('div');
            el.className = 'doc-tab' + (idx === activeTabIdx ? ' doc-tab-active' : '') + (tab.dirty ? ' doc-tab-dirty' : '');
            el.title = tab.doc.name || '';
            el.innerHTML =
                '<span class="doc-tab-icon">' + fileIcon(tab.doc.name) + '</span>' +
                '<span class="doc-tab-name">' + esc(tab.doc.name||'Untitled') + '</span>' +
                (tab.dirty ? '<span class="doc-tab-dot" title="Unsaved changes"></span>' : '') +
                '<button type="button" class="doc-tab-close" aria-label="Close">×</button>';
            el.querySelector('.doc-tab-close').addEventListener('click', function(e){ e.stopPropagation(); closeTab(idx); });
            el.addEventListener('click', function(){ activateTab(idx); });
            docTabsEl.appendChild(el);
        });
    }

    // ── Render helpers ───────────────────────────────────────────────────────────
    function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function makeToolbar(leftHtml, rightHtml) {
        return '<div class="dv-toolbar">' +
            '<div class="dv-toolbar-left">' + (leftHtml||'') + '</div>' +
            '<div class="dv-toolbar-right">' + (rightHtml||'') + '</div>' +
            '</div>';
    }

    function modePills(modes, active) {
        return modes.map(function(m){
            return '<button type="button" class="dv-pill' + (m.id===active?' dv-pill-active':'') + '" data-mode="'+m.id+'">'+m.label+'</button>';
        }).join('');
    }

    // ── CSV render ───────────────────────────────────────────────────────────────
    function renderCSVTable(rows, editable) {
        if (!rows || !rows.length) return '<p class="dv-empty">Empty file</p>';
        var maxCols = rows.reduce(function(m,r){ return Math.max(m, r.length); }, 0);

        var html = '<div class="dv-spreadsheet"><table class="dv-csv-table"><colgroup><col class="dv-rn-col">';
        for (var c=0;c<maxCols;c++) html += '<col>';
        html += '</colgroup><thead><tr><th class="dv-rn-corner"></th>';
        for (var c2=0;c2<maxCols;c2++) html += '<th class="dv-col-header">'+colLabel(c2)+'</th>';
        html += '</tr></thead><tbody>';

        rows.forEach(function(row, ri) {
            html += '<tr><th class="dv-rn">'+(ri+1)+'</th>';
            for (var ci=0;ci<maxCols;ci++) {
                var val = esc(row[ci] !== undefined ? String(row[ci]) : '');
                var isHeader = ri === 0;
                if (editable) {
                    html += (isHeader ? '<th' : '<td') +
                        ' class="dv-cell' + (isHeader?' dv-cell-header':'') + '"' +
                        ' contenteditable="true" data-row="'+ri+'" data-col="'+ci+'" spellcheck="false">'+val+
                        (isHeader ? '</th>' : '</td>');
                } else {
                    html += (isHeader ? '<th' : '<td') + ' class="dv-cell' + (isHeader?' dv-cell-header':'') + '">'+val+(isHeader?'</th>':'</td>');
                }
            }
            html += '</tr>';
        });
        html += '</tbody></table></div>';
        return html;
    }

    function buildCSVContent(tab) {
        var isTable = (tab.viewMode !== 'code');
        var toolbar = makeToolbar(
            modePills([{id:'table',label:'⊞ Table'},{id:'code',label:'{ } Code'}], isTable?'table':'code'),
            (isTable
                ? '<button class="dv-btn dv-btn-save" data-action="save-csv">Save</button>'
                : '') +
            '<button class="dv-btn" data-action="export-csv">Export</button>'
        );
        var body = isTable
            ? renderCSVTable(tab.parsedData, true)
            : '<div class="dv-code-wrap"><textarea class="dv-code-editor" spellcheck="false" data-action="csv-raw">' + esc(tab.rawText||'') + '</textarea></div>';
        return '<div class="dv-viewer-wrap">' + toolbar + '<div class="dv-body">' + body + '</div></div>';
    }

    // ── Excel render ─────────────────────────────────────────────────────────────
    function buildExcelContent(tab) {
        if (!tab.parsedData) return '<p class="dv-empty">Could not parse workbook.</p>';
        var sheets = tab.parsedData.sheets;
        var si = tab.excelSheetIdx || 0;
        var sheetTabs = sheets.length > 1
            ? '<div class="dv-sheet-tabs">' + sheets.map(function(s,i){
                return '<button class="dv-sheet-tab'+(i===si?' dv-sheet-tab-active':'')+'" data-sheet="'+i+'">'+esc(s.name)+'</button>';
              }).join('') + '</div>' : '';
        var rows = sheets[si] ? sheets[si].data : [];
        var toolbar = makeToolbar(sheetTabs, '<button class="dv-btn" data-action="export-xlsx">Export</button>');
        return '<div class="dv-viewer-wrap">' + toolbar + '<div class="dv-body">' + renderCSVTable(rows, false) + '</div></div>';
    }

    // ── JSON render ──────────────────────────────────────────────────────────────
    function buildJSONContent(tab) {
        var isPreview = (tab.viewMode !== 'raw');
        var toolbar = makeToolbar(
            modePills([{id:'preview',label:'⊞ Formatted'},{id:'raw',label:'{ } Raw'}], isPreview?'preview':'raw'),
            ''
        );
        var body;
        if (isPreview) {
            try {
                var pretty = JSON.stringify(JSON.parse(tab.rawText||'{}'), null, 2);
                body = '<pre class="doc-viewer-code-block doc-viewer-json">' + highlightJSON(pretty) + '</pre>';
            } catch(e) {
                body = '<pre class="doc-viewer-code-block">' + esc(tab.rawText||'') + '</pre>';
            }
        } else {
            body = '<div class="dv-code-wrap"><textarea class="dv-code-editor" spellcheck="false">'+esc(tab.rawText||'')+'</textarea></div>';
        }
        return '<div class="dv-viewer-wrap">' + toolbar + '<div class="dv-body">' + body + '</div></div>';
    }

    // ── MD render ────────────────────────────────────────────────────────────────
    function buildMDContent(tab) {
        var isPreview = (tab.viewMode !== 'edit');
        var toolbar = makeToolbar(
            modePills([{id:'preview',label:'👁 Preview'},{id:'edit',label:'✏ Edit'}], isPreview?'preview':'edit'),
            (tab.dirty ? '<button class="dv-btn dv-btn-save" data-action="save-text">Save</button>' : '')
        );
        var body = isPreview
            ? '<div class="doc-viewer-md">' + renderMarkdown(tab.rawText||'') + '</div>'
            : '<div class="dv-code-wrap"><textarea class="dv-code-editor dv-md-editor" spellcheck="true" data-action="md-raw">'+esc(tab.rawText||'')+'</textarea></div>';
        return '<div class="dv-viewer-wrap">' + toolbar + '<div class="dv-body">' + body + '</div></div>';
    }

    // ── Plain text ───────────────────────────────────────────────────────────────
    function buildTextContent(tab) {
        var toolbar = makeToolbar(
            '<span class="dv-type-label">' + esc(getExt(tab.doc.name||'').toUpperCase() || 'TXT') + '</span>',
            tab.dirty ? '<button class="dv-btn dv-btn-save" data-action="save-text">Save</button>' : ''
        );
        var body = '<div class="dv-code-wrap"><textarea class="dv-code-editor" spellcheck="false" data-action="text-raw">'+esc(tab.rawText||'')+'</textarea></div>';
        return '<div class="dv-viewer-wrap">' + toolbar + '<div class="dv-body">' + body + '</div></div>';
    }

    // ── PDF ──────────────────────────────────────────────────────────────────────
    function buildPDFContent(tab) {
        return '<div class="dv-pdf-wrap"><iframe src="'+tab.pdfUrl+'" title="'+esc(tab.doc.name)+'"></iframe></div>';
    }

    // ── Image ────────────────────────────────────────────────────────────────────
    function buildImageContent(tab) {
        var toolbar = makeToolbar('<span class="dv-type-label">' + esc(tab.doc.name||'') + '</span>', '');
        var body = '<div class="dv-img-wrap"><img src="'+tab.imgUrl+'" alt="'+esc(tab.doc.name||'')+'" draggable="false"></div>';
        return '<div class="dv-viewer-wrap">' + toolbar + '<div class="dv-body">' + body + '</div></div>';
    }

    // ── DOCX ─────────────────────────────────────────────────────────────────────
    function buildDocxContent(tab) {
        var toolbar = makeToolbar('<span class="dv-type-label">DOCX</span>', '');
        var body = '<div class="doc-viewer-docx">' + (tab.docxHtml||'<p>Could not render.</p>') + '</div>';
        return '<div class="dv-viewer-wrap">' + toolbar + '<div class="dv-body">' + body + '</div></div>';
    }

    // ── Dispatch content builder ─────────────────────────────────────────────────
    function buildContent(tab) {
        switch(tab.type) {
            case 'csv':   return buildCSVContent(tab);
            case 'xlsx':  return buildExcelContent(tab);
            case 'json':  return buildJSONContent(tab);
            case 'md':    return buildMDContent(tab);
            case 'text':  return buildTextContent(tab);
            case 'pdf':   return buildPDFContent(tab);
            case 'image': return buildImageContent(tab);
            case 'docx':  return buildDocxContent(tab);
            default:      return '<p class="dv-empty">Preview not available for this file type.</p>';
        }
    }

    // ── Activate / paint ─────────────────────────────────────────────────────────
    function paintTab(idx) {
        if (idx < 0 || idx >= openTabs.length || !viewerContent) return;
        var tab = openTabs[idx];
        viewerContent.innerHTML = buildContent(tab);
        wireTabEvents(tab, idx);
    }

    function wireTabEvents(tab, idx) {
        if (!viewerContent) return;

        // Mode pill clicks
        viewerContent.querySelectorAll('.dv-pill').forEach(function(btn) {
            btn.addEventListener('click', function() {
                tab.viewMode = btn.getAttribute('data-mode');
                paintTab(idx);
            });
        });

        // Sheet tabs (Excel)
        viewerContent.querySelectorAll('.dv-sheet-tab').forEach(function(btn) {
            btn.addEventListener('click', function() {
                tab.excelSheetIdx = parseInt(btn.getAttribute('data-sheet'), 10);
                paintTab(idx);
            });
        });

        // Editable CSV cells → update parsedData on blur
        if (tab.type === 'csv') {
            viewerContent.querySelectorAll('[data-row][data-col]').forEach(function(cell) {
                cell.addEventListener('input', function() {
                    var r = parseInt(cell.getAttribute('data-row'),10);
                    var c = parseInt(cell.getAttribute('data-col'),10);
                    if (!tab.parsedData[r]) tab.parsedData[r] = [];
                    tab.parsedData[r][c] = cell.textContent;
                    tab.rawText = serializeCSV(tab.parsedData);
                    if (!tab.dirty) { tab.dirty = true; renderTabBar(); }
                });
                // Tab key moves to next cell
                cell.addEventListener('keydown', function(e) {
                    if (e.key === 'Tab') {
                        e.preventDefault();
                        var r = parseInt(cell.getAttribute('data-row'),10);
                        var c = parseInt(cell.getAttribute('data-col'),10);
                        var next = viewerContent.querySelector('[data-row="'+r+'"][data-col="'+(c+1)+'"]')
                            || viewerContent.querySelector('[data-row="'+(r+1)+'"][data-col="0"]');
                        if (next) { next.focus(); var range = document.createRange(); range.selectNodeContents(next); range.collapse(false); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        var r2 = parseInt(cell.getAttribute('data-row'),10);
                        var c2 = parseInt(cell.getAttribute('data-col'),10);
                        var down = viewerContent.querySelector('[data-row="'+(r2+1)+'"][data-col="'+c2+'"]');
                        if (down) down.focus();
                    }
                });
            });

            // Raw CSV textarea
            var rawArea = viewerContent.querySelector('[data-action="csv-raw"]');
            if (rawArea) {
                rawArea.addEventListener('input', function() {
                    tab.rawText = rawArea.value;
                    tab.parsedData = parseCSV(tab.rawText);
                    if (!tab.dirty) { tab.dirty = true; renderTabBar(); }
                });
            }
        }

        // MD / text textarea
        var mdArea = viewerContent.querySelector('[data-action="md-raw"]');
        if (mdArea) {
            mdArea.addEventListener('input', function() {
                tab.rawText = mdArea.value;
                if (!tab.dirty) { tab.dirty = true; renderTabBar(); }
                // Rebuild save btn
                var saveBtn = viewerContent.querySelector('.dv-btn-save');
                if (!saveBtn) {
                    var right = viewerContent.querySelector('.dv-toolbar-right');
                    if (right) {
                        var b = document.createElement('button');
                        b.type = 'button'; b.className = 'dv-btn dv-btn-save'; b.textContent = 'Save'; b.setAttribute('data-action','save-text');
                        right.insertBefore(b, right.firstChild);
                        b.addEventListener('click', function(){ doSave(tab, idx); });
                    }
                }
            });
        }
        var textArea = viewerContent.querySelector('[data-action="text-raw"]');
        if (textArea) {
            textArea.addEventListener('input', function() {
                tab.rawText = textArea.value;
                if (!tab.dirty) { tab.dirty = true; renderTabBar(); paintTab(idx); }
            });
        }

        // Save buttons
        viewerContent.querySelectorAll('[data-action="save-csv"], [data-action="save-text"]').forEach(function(btn) {
            btn.addEventListener('click', function() { doSave(tab, idx); });
        });

        // Export buttons
        var exportCSV = viewerContent.querySelector('[data-action="export-csv"]');
        if (exportCSV) {
            exportCSV.addEventListener('click', function() {
                var text = tab.rawText || serializeCSV(tab.parsedData||[]);
                downloadText(text, tab.doc.name || 'export.csv', 'text/csv');
            });
        }
        var exportXLSX = viewerContent.querySelector('[data-action="export-xlsx"]');
        if (exportXLSX) {
            exportXLSX.addEventListener('click', function() {
                if (tab.rawXLSX) downloadBinary(tab.rawXLSX, tab.doc.name||'export.xlsx');
            });
        }
    }

    // ── Save back to IDB ─────────────────────────────────────────────────────────
    function doSave(tab, idx) {
        var text = tab.rawText || '';
        var encoder = new TextEncoder();
        var buf = encoder.encode(text).buffer;
        tab.doc.data = buf;
        tab.doc.size = buf.byteLength;
        if (window.mudrag && window.mudrag.updateDocumentContent) {
            window.mudrag.updateDocumentContent(tab.doc.id, buf).then(function() {
                tab.dirty = false;
                renderTabBar();
                paintTab(idx); // re-render to remove save button from MD preview
                showSaveFlash();
            });
        }
    }

    function showSaveFlash() {
        var f = document.createElement('div');
        f.className = 'dv-save-flash';
        f.textContent = '✓ Saved';
        (viewerContent||document.body).appendChild(f);
        setTimeout(function(){ f.classList.add('dv-save-flash-show'); }, 10);
        setTimeout(function(){ f.classList.remove('dv-save-flash-show'); setTimeout(function(){ f.remove(); }, 300); }, 1800);
    }

    // ── Download helpers ─────────────────────────────────────────────────────────
    function downloadText(text, name, mime) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text],{type:mime||'text/plain'}));
        a.download = name; a.click(); URL.revokeObjectURL(a.href);
    }
    function downloadBinary(ab, name) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([ab]));
        a.download = name; a.click(); URL.revokeObjectURL(a.href);
    }

    // ── Activate tab ─────────────────────────────────────────────────────────────
    function activateTab(idx) {
        if (idx < 0 || idx >= openTabs.length) return;
        activeTabIdx = idx;
        ensureRightPanelVisible();
        if (viewerPane) viewerPane.hidden = false;
        if (canvasPane) canvasPane.hidden = true;
        if (focusTabCanvas) focusTabCanvas.classList.remove('focus-tab-active');
        if (window.mudragSetMainFocus) window.mudragSetMainFocus('document');
        paintTab(idx);
        renderTabBar();
        var el = docTabsEl && docTabsEl.querySelector('.doc-tab-active');
        if (el) el.scrollIntoView({ inline:'nearest', block:'nearest' });
    }

    function closeTab(idx) {
        openTabs.splice(idx, 1);
        if (!openTabs.length) {
            activeTabIdx = -1;
            if (viewerPane) viewerPane.hidden = true;
            if (viewerContent) viewerContent.innerHTML = '';
            if (canvasPane) canvasPane.hidden = false;
            if (focusTabCanvas) focusTabCanvas.classList.add('focus-tab-active');
            if (window.mudragSetMainFocus) window.mudragSetMainFocus('canvas');
            var mw = document.getElementById('main-wrapper');
            if (mw) mw.classList.add('right-panel-hidden');
            try { localStorage.setItem('mudrag_try_right_panel_visible','false'); } catch(e){}
        } else {
            activeTabIdx = Math.min(idx, openTabs.length - 1);
            activateTab(activeTabIdx);
        }
        renderTabBar();
    }

    function ensureRightPanelVisible() {
        var mw = document.getElementById('main-wrapper');
        if (mw && mw.classList.contains('right-panel-hidden')) {
            mw.classList.remove('right-panel-hidden');
            try { localStorage.setItem('mudrag_try_right_panel_visible','true'); } catch(e){}
        }
    }

    function fetchDocData(docId, cb) {
        if (!window.indexedDB) return cb(null);
        var req = indexedDB.open('mudrag_docs', 2);
        req.onsuccess = function() {
            var db = req.result;
            if (!db.objectStoreNames.contains('documents')) { db.close(); return cb(null); }
            var tx = db.transaction('documents','readonly');
            var get = tx.objectStore('documents').get(docId);
            get.onsuccess = function(){ db.close(); cb(get.result||null); };
            get.onerror = function(){ db.close(); cb(null); };
        };
        req.onerror = function(){ cb(null); };
    }

    function ab2text(ab) {
        try { return new TextDecoder('utf-8',{fatal:false}).decode(new Uint8Array(ab)); } catch(e){ return null; }
    }

    // ── Main open ────────────────────────────────────────────────────────────────
    function openDocument(doc) {
        if (!doc) return;
        if (window.mudrag && window.mudrag.setLastOpenedDocumentId) {
            window.mudrag.setLastOpenedDocumentId(doc.id || null);
        }
        if (doc.data === undefined || doc.data === null) {
            fetchDocData(doc.id, function(full) {
                if (full && full.data !== undefined) openDocument(full);
                else openDocument(Object.assign({}, doc, {data: new ArrayBuffer(0)}));
            });
            return;
        }

        // Already open → activate
        for (var i=0;i<openTabs.length;i++) {
            if (openTabs[i].doc.id === doc.id) {
                if (window.mudrag && window.mudrag.setLastOpenedDocumentId) {
                    window.mudrag.setLastOpenedDocumentId(doc.id || null);
                }
                activateTab(i);
                return;
            }
        }

        var type = detectType(doc);
        var blob = new Blob([doc.data], {type: doc.type || 'application/octet-stream'});
        var tab = { doc: doc, type: type, viewMode: 'preview', dirty: false };

        if (type === 'csv') {
            var rCSV = new FileReader();
            rCSV.onload = function() {
                tab.rawText = rCSV.result;
                tab.parsedData = parseCSV(tab.rawText);
                tab.viewMode = 'table';
                pushTab(tab);
            };
            rCSV.readAsText(blob);
        } else if (type === 'xlsx') {
            var rXL = new FileReader();
            rXL.onload = function() {
                tab.rawXLSX = rXL.result;
                if (typeof XLSX !== 'undefined') {
                    try {
                        var wb = XLSX.read(rXL.result, {type:'array'});
                        tab.parsedData = {
                            sheets: wb.SheetNames.map(function(sn) {
                                return { name: sn, data: XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1}) };
                            })
                        };
                        tab.excelSheetIdx = 0;
                    } catch(e) { tab.parsedData = null; }
                }
                pushTab(tab);
            };
            rXL.readAsArrayBuffer(blob);
        } else if (type === 'pdf') {
            tab.pdfUrl = URL.createObjectURL(blob);
            pushTab(tab);
        } else if (type === 'image') {
            tab.imgUrl = URL.createObjectURL(blob);
            pushTab(tab);
        } else if (type === 'docx') {
            var rDX = new FileReader();
            rDX.onload = function() {
                if (typeof mammoth !== 'undefined') {
                    mammoth.convertToHtml({arrayBuffer: rDX.result}).then(function(res) {
                        tab.docxHtml = res.value;
                        pushTab(tab);
                    }).catch(function(){ tab.docxHtml = ''; pushTab(tab); });
                } else { tab.docxHtml = ''; pushTab(tab); }
            };
            rDX.readAsArrayBuffer(blob);
        } else if (type === 'json') {
            var rJ = new FileReader();
            rJ.onload = function() {
                tab.rawText = rJ.result;
                tab.viewMode = 'preview';
                pushTab(tab);
            };
            rJ.readAsText(blob);
        } else if (type === 'md') {
            var rMD = new FileReader();
            rMD.onload = function() {
                tab.rawText = rMD.result;
                tab.viewMode = 'preview';
                pushTab(tab);
            };
            rMD.readAsText(blob);
        } else {
            var rT = new FileReader();
            rT.onload = function() {
                tab.rawText = rT.result || ab2text(doc.data) || '';
                tab.viewMode = 'edit';
                pushTab(tab);
            };
            rT.readAsText(blob);
        }
    }

    function pushTab(tab) {
        // Guard: was it opened while we were loading?
        for (var i=0;i<openTabs.length;i++) {
            if (openTabs[i].doc.id === tab.doc.id) { openTabs[i] = tab; activateTab(i); return; }
        }
        openTabs.push(tab);
        activateTab(openTabs.length - 1);
    }

    function closeDocument() {
        openTabs = []; activeTabIdx = -1;
        if (viewerPane) viewerPane.hidden = true;
        if (viewerContent) viewerContent.innerHTML = '';
        if (canvasPane) canvasPane.hidden = false;
        if (focusTabCanvas) focusTabCanvas.classList.add('focus-tab-active');
        if (window.mudragSetMainFocus) window.mudragSetMainFocus('canvas');
        renderTabBar();
        var mw = document.getElementById('main-wrapper');
        if (mw) mw.classList.add('right-panel-hidden');
        try { localStorage.setItem('mudrag_try_right_panel_visible','false'); } catch(e){}
    }

    function setFocus(focus) {
        if (!viewerPane || !canvasPane) return;
        if (focus === 'document') {
            if (!openTabs.length) return;
            viewerPane.hidden = false; canvasPane.hidden = true;
            if (focusTabCanvas) focusTabCanvas.classList.remove('focus-tab-active');
            if (window.mudragSetMainFocus) window.mudragSetMainFocus('document');
        } else {
            viewerPane.hidden = true; canvasPane.hidden = false;
            if (focusTabCanvas) focusTabCanvas.classList.add('focus-tab-active');
            if (window.mudragSetMainFocus) window.mudragSetMainFocus('canvas');
        }
    }

    window.mudragInitDocumentViewer = function(mudrag) {
        mudrag.openDocument = openDocument;
        mudrag.closeDocument = closeDocument;
        mudrag.setFocus = setFocus;
        mudrag.getCurrentDocument = function(){ return openTabs[activeTabIdx] ? openTabs[activeTabIdx].doc : null; };
        mudrag.getCurrentDocumentText = function(){
            var t = openTabs[activeTabIdx];
            if (!t) return null;
            if (t.type === 'csv') return t.rawText || serializeCSV(t.parsedData||[]);
            return t.rawText || null;
        };
    };
})();
