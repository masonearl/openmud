(function () {
    'use strict';

    var API_BASE = '/api';
    var STORAGE_PROJECTS = 'rockmud_projects';
    var STORAGE_ACTIVE = 'rockmud_activeProject';
    var STORAGE_MESSAGES = 'rockmud_messages';
    var STORAGE_MODEL = 'rockmud_model';
    var STORAGE_SIDEBAR_WIDTH = 'rockmud_sidebarWidth';

    var WELCOME_MSG = "Hi, I'm the Rockmud assistant. Ask me about cost estimates, project types (waterline, sewer, storm, gas, electrical), or anything construction—e.g. \"Estimate 1500 LF of 8 inch sewer in clay.\" Use the Tools menu to open Quick estimate, Proposal, or Schedule—you can edit them right here and refine through chat.";

    function id() { return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); }

    function getProjects() {
        try {
            var raw = localStorage.getItem(STORAGE_PROJECTS);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }

    function setProjects(arr) {
        localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(arr));
    }

    function getActiveId() {
        return localStorage.getItem(STORAGE_ACTIVE) || null;
    }

    function setActiveId(id) {
        if (id) localStorage.setItem(STORAGE_ACTIVE, id);
        else localStorage.removeItem(STORAGE_ACTIVE);
    }

    function getMessages(projectId) {
        try {
            var raw = localStorage.getItem(STORAGE_MESSAGES);
            var all = raw ? JSON.parse(raw) : {};
            return all[projectId] || [];
        } catch (e) { return []; }
    }

    function setMessages(projectId, msgs) {
        var raw = localStorage.getItem(STORAGE_MESSAGES);
        var all = raw ? JSON.parse(raw) : {};
        all[projectId] = msgs;
        localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(all));
    }

    var messagesEl = document.getElementById('chat-messages');
    var form = document.getElementById('chat-form');
    var input = document.getElementById('chat-input');
    var sendBtn = document.getElementById('chat-send');
    var projectsList = document.getElementById('projects-list');
    var btnNewProject = document.getElementById('btn-new-project');
    var modalNewProject = document.getElementById('modal-new-project');
    var formNewProject = document.getElementById('form-new-project');
    var inputProjectName = document.getElementById('input-project-name');
    var btnCancelProject = document.getElementById('btn-cancel-project');
    var formEstimate = document.getElementById('form-estimate');
    var estimateResult = document.getElementById('estimate-result');
    var estimateFeedback = document.getElementById('estimate-feedback');
    var formFeedback = document.getElementById('form-feedback');
    var inputActualCost = document.getElementById('input-actual-cost');

    var activeProjectId = null;
    var lastEstimatePayload = null;
    var lastEstimateResult = null;
    var activeTool = null;

    var btnTools = document.getElementById('btn-tools');
    var toolsDropdown = document.getElementById('tools-dropdown');
    var chatToolPanel = document.getElementById('chat-tool-panel');
    var toolPanelTitle = document.getElementById('tool-panel-title');
    var btnCloseTool = document.getElementById('btn-close-tool');

    function addMessage(role, content, projectId) {
        projectId = projectId || activeProjectId;
        if (!projectId) return;
        var msgs = getMessages(projectId);
        msgs.push({ role: role, content: content });
        setMessages(projectId, msgs);
        if (projectId === activeProjectId) renderMessages();
    }

    var MSG_COLLAPSE_THRESHOLD = 400;

    function sanitizeResponse(text) {
        if (!text || typeof text !== 'string') return text;
        var s = text
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/\\\[[\s\S]*?\\\]/g, '')
            .replace(/\$\$[\s\S]*?\$\$/g, '')
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return s;
    }

    function renderMessageContent(content, wrap) {
        var text = (content || '').trim();
        var scheduleMatch = text.match(/\[ROCKMUD_SCHEDULE\]([\s\S]*?)\[\/ROCKMUD_SCHEDULE\]/);
        var displayText = text;
        var scheduleData = null;
        if (scheduleMatch) {
            displayText = text.replace(/\[ROCKMUD_SCHEDULE\][\s\S]*?\[\/ROCKMUD_SCHEDULE\]/, '').trim();
            try {
                scheduleData = JSON.parse(scheduleMatch[1].trim());
            } catch (e) { /* ignore */ }
        }
        displayText = sanitizeResponse(displayText);
        var p = document.createElement('p');
        p.textContent = displayText;
        wrap.appendChild(p);
        if (scheduleData && scheduleData.project && scheduleData.phases && Array.isArray(scheduleData.phases)) {
            var card = document.createElement('div');
            card.className = 'msg-schedule-card';
            card.innerHTML = '<div class="msg-schedule-loading">Loading schedule…</div>';
            wrap.appendChild(card);
            fetch(API_BASE + '/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_name: scheduleData.project,
                    duration_days: scheduleData.duration || 14,
                    start_date: scheduleData.start_date || new Date().toISOString().slice(0, 10),
                    phases: scheduleData.phases
                })
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (data.html) {
                    var inner = document.createElement('div');
                    inner.className = 'msg-schedule-inner';
                    inner.innerHTML = data.html;
                    var btnWrap = document.createElement('div');
                    btnWrap.className = 'msg-schedule-actions';
                    var btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn-primary btn-sm';
                    btn.textContent = 'Download PDF';
                    btn.addEventListener('click', function () {
                        var el = document.createElement('div');
                        el.innerHTML = data.html;
                        el.style.position = 'absolute';
                        el.style.left = '-9999px';
                        el.style.background = '#fff';
                        el.style.color = '#111';
                        document.body.appendChild(el);
                        if (typeof html2pdf !== 'undefined') {
                            html2pdf().set({ filename: 'schedule-' + (data.project_name || 'project').replace(/\s+/g, '-').slice(0, 20) + '.pdf', margin: 15 }).from(el.firstElementChild).save().then(function () {
                                document.body.removeChild(el);
                            });
                        } else {
                            var w = window.open('', '_blank');
                            w.document.write(data.html);
                            w.document.close();
                            document.body.removeChild(el);
                        }
                    });
                    btnWrap.appendChild(btn);
                    inner.appendChild(btnWrap);
                    card.innerHTML = '';
                    card.appendChild(inner);
                    card.classList.remove('loading');
                } else {
                    card.innerHTML = '<div class="msg-schedule-error">Could not load schedule.</div>';
                }
            }).catch(function () {
                card.innerHTML = '<div class="msg-schedule-error">Could not load schedule.</div>';
            });
        }
    }

    function renderMessages() {
        messagesEl.innerHTML = '';
        var msgs = activeProjectId ? getMessages(activeProjectId) : [];
        if (msgs.length === 0) {
            msgs = [{ role: 'assistant', content: WELCOME_MSG }];
        }
        var firstAssistantSeen = false;
        msgs.forEach(function (m) {
            var wrap = document.createElement('div');
            wrap.className = 'msg msg-' + m.role;
            var contentWrap = document.createElement('div');
            contentWrap.className = 'msg-content';
            renderMessageContent(m.content, contentWrap);
            wrap.appendChild(contentWrap);
            var contentEl = contentWrap.querySelector('p');
            var isFirstAssistant = m.role === 'assistant' && !firstAssistantSeen;
            if (m.role === 'assistant') firstAssistantSeen = true;
            if (contentEl && contentEl.textContent.length > MSG_COLLAPSE_THRESHOLD && !isFirstAssistant) {
                contentWrap.classList.add('msg-collapsible');
                contentWrap.classList.add('msg-collapsed');
                var toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'msg-toggle';
                toggle.textContent = 'Show more';
                toggle.addEventListener('click', function () {
                    contentWrap.classList.toggle('msg-collapsed');
                    toggle.textContent = contentWrap.classList.contains('msg-collapsed') ? 'Show more' : 'Show less';
                });
                wrap.appendChild(toggle);
            }
            messagesEl.appendChild(wrap);
        });
        scrollToLatest();
    }

    function scrollToLatest() {
        var last = messagesEl.lastElementChild;
        if (last) last.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    function renderProjects() {
        var projects = getProjects();
        projectsList.innerHTML = '';
        if (projects.length === 0) {
            projectsList.innerHTML = '<li class="projects-empty">No projects yet.<br>Click + New to create one.</li>';
            return;
        }
        projects.forEach(function (p) {
            var li = document.createElement('li');
            var a = document.createElement('button');
            a.type = 'button';
            a.className = 'project-item' + (p.id === activeProjectId ? ' active' : '');
            a.textContent = p.name;
            a.addEventListener('click', function () { switchProject(p.id); });
            li.appendChild(a);
            projectsList.appendChild(li);
        });
    }

    var DB_NAME = 'rockmud_docs';
    var DB_VERSION = 1;
    var DOC_STORE = 'documents';
    var MAX_FILE_SIZE = 5 * 1024 * 1024;

    function openDB() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = function () { reject(req.error); };
            req.onsuccess = function () { resolve(req.result); };
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(DOC_STORE)) {
                    var store = db.createObjectStore(DOC_STORE, { keyPath: 'id' });
                    store.createIndex('projectId', 'projectId', { unique: false });
                }
            };
        });
    }

    function saveDocument(projectId, file) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var reader = new FileReader();
                reader.onload = function () {
                    var doc = {
                        id: 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
                        projectId: projectId,
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        data: reader.result,
                        createdAt: Date.now()
                    };
                    var tx = db.transaction(DOC_STORE, 'readwrite');
                    tx.objectStore(DOC_STORE).add(doc);
                    tx.oncomplete = function () { resolve(doc.id); };
                    tx.onerror = function () { reject(tx.error); };
                };
                reader.onerror = function () { reject(reader.error); };
                reader.readAsArrayBuffer(file);
            });
        });
    }

    function getDocuments(projectId) {
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction(DOC_STORE, 'readonly');
                var index = tx.objectStore(DOC_STORE).index('projectId');
                var req = index.getAll(projectId);
                req.onsuccess = function () {
                    resolve(req.result || []);
                };
                req.onerror = function () { resolve([]); };
            });
        });
    }

    function deleteDocument(docId) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(DOC_STORE, 'readwrite');
                tx.objectStore(DOC_STORE).delete(docId);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function downloadDocument(doc) {
        var blob = new Blob([doc.data], { type: doc.type || 'application/octet-stream' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = doc.name;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function renderDocuments() {
        var listEl = document.getElementById('documents-list');
        var hintEl = document.getElementById('documents-hint');
        var uploadLabel = document.querySelector('.btn-upload');
        if (!listEl || !hintEl) return;

        if (!activeProjectId) {
            listEl.innerHTML = '';
            hintEl.textContent = 'Select a project to add documents';
            hintEl.hidden = false;
            if (uploadLabel) uploadLabel.style.pointerEvents = 'none';
            return;
        }

        if (uploadLabel) uploadLabel.style.pointerEvents = '';

        getDocuments(activeProjectId).then(function (docs) {
            listEl.innerHTML = '';
            hintEl.textContent = docs.length === 0 ? 'No documents. Click + Add to upload.' : '';
            hintEl.hidden = docs.length > 0;
            docs.forEach(function (doc) {
                var li = document.createElement('div');
                li.className = 'document-item';
                li.innerHTML = '<span class="document-name" title="' + (doc.name || '').replace(/"/g, '&quot;') + '">' + (doc.name || 'Document') + '</span>' +
                    '<span class="document-size">' + formatSize(doc.size || 0) + '</span>' +
                    '<button type="button" class="btn-download-doc" data-id="' + doc.id + '" title="Download">↓</button>' +
                    '<button type="button" class="btn-delete-doc" data-id="' + doc.id + '" title="Remove">×</button>';
                listEl.appendChild(li);
            });
            listEl.querySelectorAll('.btn-delete-doc').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    deleteDocument(btn.getAttribute('data-id')).then(function () { renderDocuments(); });
                });
            });
            listEl.querySelectorAll('.btn-download-doc').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var doc = docs.find(function (d) { return d.id === btn.getAttribute('data-id'); });
                    if (doc) downloadDocument(doc);
                });
            });
        });
    }

    function switchProject(id) {
        activeProjectId = id;
        setActiveId(id);
        renderProjects();
        renderMessages();
        renderDocuments();
    }

    function createProject(name) {
        var projects = getProjects();
        var p = { id: id(), name: name.trim(), createdAt: Date.now() };
        projects.unshift(p);
        setProjects(projects);
        setMessages(p.id, []);
        switchProject(p.id);
        modalNewProject.hidden = true;
        inputProjectName.value = '';
    }

    function handleDocUpload(inputEl) {
        if (!inputEl || !activeProjectId || !inputEl.files || inputEl.files.length === 0) return;
        var files = Array.from(inputEl.files);
        var rejected = 0;
        files.forEach(function (file) {
            if (file.size > MAX_FILE_SIZE) {
                rejected++;
                return;
            }
            saveDocument(activeProjectId, file).then(function () {
                renderDocuments();
            }).catch(function (err) {
                console.error('Upload failed:', err);
            });
        });
        if (rejected > 0) {
            addMessage('assistant', 'Some files were skipped (max 5 MB per file).');
        }
        inputEl.value = '';
    }
    var docUpload = document.getElementById('doc-upload');
    if (docUpload) {
        docUpload.addEventListener('change', function () {
            handleDocUpload(this);
        });
    }
    var chatDocUpload = document.getElementById('chat-doc-upload');
    if (chatDocUpload) {
        chatDocUpload.addEventListener('change', function () {
            handleDocUpload(this);
        });
    }

    function ensureProject() {
        var projects = getProjects();
        if (projects.length === 0) {
            createProject('Untitled project');
        } else if (!activeProjectId || !projects.find(function (p) { return p.id === activeProjectId; })) {
            switchProject(projects[0].id);
        }
    }

    function setLoading(on) {
        sendBtn.disabled = on;
        sendBtn.setAttribute('aria-busy', on ? 'true' : 'false');
    }

    function getToolContext() {
        if (!activeTool) return '';
        if (activeTool === 'estimate' && lastEstimatePayload) {
            var p = lastEstimatePayload;
            return '\n[Active: Quick estimate. Current: ' + p.linear_feet + ' LF ' + p.pipe_diameter + '" ' + p.project_type + ', ' + p.soil_type + ', crew ' + p.crew_size + '. Last result: $' + (lastEstimateResult ? lastEstimateResult.predicted_cost.toLocaleString() : '—') + ', ' + (lastEstimateResult ? lastEstimateResult.duration_days : '—') + ' days. User can ask to change values—suggest the new value and they can update the form.]';
        }
        if (activeTool === 'proposal') {
            var client = document.getElementById('prop-client').value;
            var scope = document.getElementById('prop-scope').value;
            var total = document.getElementById('prop-total').value;
            return '\n[Active: Proposal. Client: ' + (client || '—') + ', Scope: ' + (scope ? scope.slice(0, 80) + '…' : '—') + ', Total: $' + (total || '—') + '. User can edit via form or ask for changes in chat.]';
        }
        if (activeTool === 'schedule') {
            var proj = document.getElementById('sched-project').value;
            var dur = document.getElementById('sched-duration').value;
            var phases = document.getElementById('sched-phases').value;
            return '\n[Active: Schedule. Project: ' + (proj || '—') + ', Duration: ' + (dur || '—') + ' days, Phases: ' + (phases ? phases.slice(0, 60) + '…' : '—') + '. User can edit via form or ask for changes in chat.]';
        }
        return '';
    }

    function getDocumentsContext() {
        return new Promise(function (resolve) {
            if (!activeProjectId) { resolve(''); return; }
            getDocuments(activeProjectId).then(function (docs) {
                if (docs.length === 0) { resolve(''); return; }
                var names = docs.map(function (d) { return d.name + ' (' + formatSize(d.size) + ')'; }).join(', ');
                resolve('\n[Project has ' + docs.length + ' uploaded document(s): ' + names + '. User may ask about these files.]');
            });
        });
    }

    function getCopyableChat() {
        var msgs = activeProjectId ? getMessages(activeProjectId) : [];
        if (msgs.length === 0) return '';
        var modelSelect = document.getElementById('model-select');
        var model = modelSelect ? modelSelect.value : 'gpt-4o-mini';
        var lines = ['Model: ' + model, 'Project: ' + (activeProjectId || '—'), ''];
        msgs.forEach(function (m) {
            lines.push((m.role === 'user' ? 'User' : 'Assistant') + ':');
            lines.push(m.content);
            lines.push('');
        });
        return lines.join('\n');
    }

    var TOOL_TRIGGERS = /generate|build|create|make|draft|estimate|bid|proposal|schedule/i;
    function shouldUseTools(text) {
        return TOOL_TRIGGERS.test(text);
    }

    function doSend() {
        var text = (input.value || '').trim();
        if (!text || !activeProjectId) return;

        addMessage('user', text);
        input.value = '';
        input.style.height = 'auto';
        setLoading(true);

        var msgs = getMessages(activeProjectId);
        var history = msgs.map(function (m) { return { role: m.role, content: m.content }; }).slice(-20);
        var toolCtx = getToolContext();
        if (toolCtx && history.length > 0) {
            history[history.length - 1].content = history[history.length - 1].content + toolCtx;
        }

        getDocumentsContext().then(function (docCtx) {
            if (docCtx && history.length > 0) {
                history[history.length - 1].content = history[history.length - 1].content + docCtx;
            }
            var modelSelect = document.getElementById('model-select');
            var model = modelSelect ? modelSelect.value : 'gpt-4o-mini';
            if (modelSelect) localStorage.setItem(STORAGE_MODEL, model);

            var useTools = shouldUseTools(text);
            var payload = {
                messages: history,
                model: model,
                temperature: 0.7,
                max_tokens: 1024,
                use_tools: useTools,
                available_tools: useTools ? ['build_schedule', 'generate_proposal', 'estimate_project_cost', 'calculate_material_cost', 'calculate_labor_cost', 'calculate_equipment_cost'] : undefined
            };
            if (!useTools) delete payload.available_tools;

            var controller = new AbortController();
            var timeoutId = setTimeout(function () { controller.abort(); }, 60000);
            fetch(API_BASE + '/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            })
                .then(function (r) {
                    clearTimeout(timeoutId);
                    return r.json().then(function (data) {
                        if (!r.ok) {
                            var errMsg = (data && data.error) ? data.error : 'Request failed (' + r.status + ')';
                            addMessage('assistant', 'Error: ' + errMsg);
                        } else {
                            addMessage('assistant', (data && data.response) || 'No response.');
                        }
                    }).catch(function () {
                        addMessage('assistant', 'Error: Request failed (' + r.status + '). Check API keys in Vercel.');
                    });
                })
                .catch(function (err) {
                    clearTimeout(timeoutId);
                    var msg = err.name === 'AbortError' ? 'Request timed out. Try again.' : (err.message || 'Check your connection and try again.');
                    addMessage('assistant', 'Could not reach the assistant. ' + msg);
                })
                .then(function () {
                    setLoading(false);
                    scrollToLatest();
                });
        });
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        doSend();
    });

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            doSend();
        }
    });

    function autoGrowTextarea() {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    }
    input.addEventListener('input', autoGrowTextarea);

    document.querySelectorAll('.quick-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var prompt = btn.getAttribute('data-prompt');
            if (prompt) { input.value = prompt; input.focus(); }
        });
    });

    var btnCopyChat = document.getElementById('btn-copy-chat');
    if (btnCopyChat) {
        btnCopyChat.addEventListener('click', function () {
            var text = getCopyableChat();
            if (!text) {
                addMessage('assistant', 'No messages to copy yet.');
                return;
            }
            navigator.clipboard.writeText(text).then(function () {
                var orig = btnCopyChat.textContent;
                btnCopyChat.textContent = 'Copied!';
                btnCopyChat.classList.add('copied');
                setTimeout(function () {
                    btnCopyChat.textContent = orig;
                    btnCopyChat.classList.remove('copied');
                }, 1500);
            }).catch(function () {
                addMessage('assistant', 'Could not copy. Try selecting the chat manually.');
            });
        });
    }

    btnNewProject.addEventListener('click', function () {
        modalNewProject.hidden = false;
        inputProjectName.focus();
    });

    btnCancelProject.addEventListener('click', function () {
        modalNewProject.hidden = true;
    });

    formNewProject.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = inputProjectName.value.trim();
        if (name) createProject(name);
    });

    function openTool(tool) {
        activeTool = tool;
        toolsDropdown.hidden = true;
        btnTools.setAttribute('aria-expanded', 'false');
        document.querySelectorAll('.tool-form-wrap').forEach(function (el) { el.classList.remove('active'); });
        var wrap = document.getElementById('tool-form-' + tool);
        if (wrap) wrap.classList.add('active');
        var titles = { estimate: 'Quick estimate', proposal: 'Proposal', schedule: 'Build schedule' };
        toolPanelTitle.textContent = titles[tool] || 'Tool';
        chatToolPanel.hidden = false;
        if (tool === 'estimate') {
            estimateResult.hidden = true;
            estimateFeedback.hidden = true;
            lastEstimatePayload = null;
        }
        if (tool === 'schedule') {
            document.getElementById('sched-start').value = new Date().toISOString().slice(0, 10);
        }
    }

    function closeTool() {
        activeTool = null;
        chatToolPanel.hidden = true;
        document.querySelectorAll('.tool-form-wrap').forEach(function (el) { el.classList.remove('active'); });
    }

    btnTools.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = toolsDropdown.hidden === false;
        toolsDropdown.hidden = isOpen;
        btnTools.setAttribute('aria-expanded', String(!isOpen));
    });

    document.querySelectorAll('.dropdown-item').forEach(function (item) {
        item.addEventListener('click', function () {
            var tool = item.getAttribute('data-tool');
            if (tool) openTool(tool);
        });
    });

    btnCloseTool.addEventListener('click', closeTool);

    toolsDropdown.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () {
        toolsDropdown.hidden = true;
        btnTools.setAttribute('aria-expanded', 'false');
    });

    function getEstimatePayload() {
        return {
            project_type: document.getElementById('est-project-type').value,
            linear_feet: parseInt(document.getElementById('est-linear-feet').value, 10),
            pipe_diameter: parseInt(document.getElementById('est-pipe-diameter').value, 10),
            trench_depth: parseFloat(document.getElementById('est-trench-depth').value),
            soil_type: document.getElementById('est-soil-type').value,
            location_zone: document.getElementById('est-location').value,
            crew_size: parseInt(document.getElementById('est-crew-size').value, 10),
            has_dewatering: document.getElementById('est-dewatering').checked,
            has_rock_excavation: document.getElementById('est-rock').checked,
            num_fittings: parseInt(document.getElementById('est-fittings').value, 10) || 0,
            road_crossings: parseInt(document.getElementById('est-road-crossings').value, 10) || 0,
            season: document.getElementById('est-season').value,
            pipe_material: document.getElementById('est-pipe-material').value
        };
    }

    formEstimate.addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = document.getElementById('btn-run-estimate');
        btn.disabled = true;
        btn.textContent = 'Running…';
        var payload = getEstimatePayload();
        lastEstimatePayload = payload;

        fetch(API_BASE + '/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var html = '<h4>Estimate result</h4>' +
                    '<p class="est-total">$' + (data.predicted_cost || 0).toLocaleString() + '</p>' +
                    '<p class="est-range">Range: $' + (data.confidence_range_low || 0).toLocaleString() + ' – $' + (data.confidence_range_high || 0).toLocaleString() + '</p>' +
                    '<p class="est-perlf">$' + (data.per_lf || 0).toFixed(2) + ' / LF</p>' +
                    '<p class="est-duration">' + (data.duration_days || 0) + ' days</p>';
                if (data.breakdown) {
                    html += '<div class="est-breakdown"><strong>Breakdown:</strong> ';
                    var parts = [];
                    if (data.breakdown.material) parts.push('Material $' + data.breakdown.material.toLocaleString());
                    if (data.breakdown.labor) parts.push('Labor $' + data.breakdown.labor.toLocaleString());
                    if (data.breakdown.equipment) parts.push('Equipment $' + data.breakdown.equipment.toLocaleString());
                    if (data.breakdown.misc) parts.push('Misc $' + data.breakdown.misc.toLocaleString());
                    if (data.breakdown.overhead) parts.push('OH $' + data.breakdown.overhead.toLocaleString());
                    if (data.breakdown.markup) parts.push('Markup $' + data.breakdown.markup.toLocaleString());
                    html += parts.join(', ') + '</div>';
                }
                html += '<div class="est-actions"><button type="button" class="btn-secondary btn-sm" id="btn-gen-proposal">Generate proposal</button> ' +
                    '<button type="button" class="btn-secondary btn-sm" id="btn-gen-schedule">Generate schedule</button></div>';
                estimateResult.innerHTML = html;
                estimateResult.hidden = false;
                estimateFeedback.hidden = false;
                lastEstimateResult = data;
                bindEstimateActions();
                var summary = 'Estimate: $' + (data.predicted_cost || 0).toLocaleString() + ', ' + (data.duration_days || 0) + ' days. Use the buttons above to generate a proposal or schedule, or ask me to adjust values.';
                addMessage('assistant', summary);
            })
            .catch(function () {
                estimateResult.innerHTML = '<p class="est-error">Could not reach the API. Try again later.</p>';
                estimateResult.hidden = false;
                estimateFeedback.hidden = true;
            })
            .then(function () {
                btn.disabled = false;
                btn.textContent = 'Run estimate';
            });
    });

    formFeedback.addEventListener('submit', function (e) {
        e.preventDefault();
        var actual = parseInt(inputActualCost.value, 10);
        if (!actual || !lastEstimatePayload) return;
        var payload = Object.assign({}, lastEstimatePayload, { actual_cost: actual });
        fetch(API_BASE + '/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
            .then(function () {
                estimateFeedback.innerHTML = '<p class="feedback-success">Thanks! Feedback submitted.</p>';
            })
            .catch(function () {
                estimateFeedback.innerHTML = '<p class="feedback-error">Could not submit. Try again.</p>';
            });
    });

    modalNewProject.addEventListener('click', function (e) {
        if (e.target === modalNewProject) modalNewProject.hidden = true;
    });

    function bindEstimateActions() {
        var btnProp = document.getElementById('btn-gen-proposal');
        var btnSched = document.getElementById('btn-gen-schedule');
        if (btnProp) btnProp.onclick = function () { openProposalFromEstimate(); };
        if (btnSched) btnSched.onclick = function () { openScheduleFromEstimate(); };
    }

    var formProposal = document.getElementById('form-proposal');
    var formSchedule = document.getElementById('form-schedule');

    var projectTypeLabels = { waterline: 'waterline', sewer: 'sewer', storm_drain: 'storm drain', gas: 'gas', electrical: 'electrical' };
    function openProposalFromEstimate() {
        if (lastEstimatePayload && lastEstimateResult) {
            var pt = projectTypeLabels[lastEstimatePayload.project_type] || lastEstimatePayload.project_type || 'pipe';
            document.getElementById('prop-scope').value = lastEstimatePayload.linear_feet + ' LF of ' + lastEstimatePayload.pipe_diameter + '" ' +
                pt + ', ' + lastEstimatePayload.soil_type + ' soil, ' + lastEstimatePayload.trench_depth + ' ft depth';
            document.getElementById('prop-total').value = lastEstimateResult.predicted_cost || '';
            document.getElementById('prop-duration').value = lastEstimateResult.duration_days || '';
        }
        openTool('proposal');
    }

    function openScheduleFromEstimate() {
        if (lastEstimateResult) {
            document.getElementById('sched-duration').value = lastEstimateResult.duration_days || 14;
        }
        document.getElementById('sched-start').value = new Date().toISOString().slice(0, 10);
        openTool('schedule');
    }

    formProposal.addEventListener('submit', function (e) {
        e.preventDefault();
        var client = document.getElementById('prop-client').value.trim();
        var scope = document.getElementById('prop-scope').value.trim();
        var total = document.getElementById('prop-total').value;
        var duration = document.getElementById('prop-duration').value;
        var assumptions = document.getElementById('prop-assumptions').value.trim();
        var exclusions = document.getElementById('prop-exclusions').value.trim();
        var html = '<div class="pdf-doc" style="font-family:Merriweather,Georgia,serif;padding:40px;max-width:700px;margin:0 auto;">' +
            '<h1 style="margin:0 0 8px;">Proposal</h1>' +
            '<p style="color:#666;margin:0 0 24px;">' + client + '</p>' +
            '<h2 style="font-size:1.1rem;margin:24px 0 8px;">Scope</h2>' +
            '<p style="margin:0;line-height:1.6;">' + (scope || '—').replace(/\n/g, '<br>') + '</p>' +
            '<h2 style="font-size:1.1rem;margin:24px 0 8px;">Pricing</h2>' +
            '<p style="margin:0;font-size:1.25rem;font-weight:700;">' + (total ? '$' + parseInt(total, 10).toLocaleString() : '—') + '</p>' +
            (duration ? '<p style="margin:8px 0 0;">Duration: ' + duration + ' days</p>' : '') +
            (assumptions ? '<h2 style="font-size:1.1rem;margin:24px 0 8px;">Assumptions</h2><p style="margin:0;line-height:1.6;">' + assumptions.replace(/\n/g, '<br>') + '</p>' : '') +
            (exclusions ? '<h2 style="font-size:1.1rem;margin:24px 0 8px;">Exclusions</h2><p style="margin:0;line-height:1.6;">' + exclusions.replace(/\n/g, '<br>') + '</p>' : '') +
            '<p style="margin:32px 0 0;font-size:0.875rem;color:#666;">Generated by Rockmud · rockmud.com</p></div>';
        var el = document.createElement('div');
        el.innerHTML = html;
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        el.style.background = '#fff';
        el.style.color = '#111';
        document.body.appendChild(el);
        if (typeof html2pdf !== 'undefined') {
            html2pdf().set({ filename: 'proposal-' + (client || 'project').replace(/\s+/g, '-').slice(0, 30) + '.pdf', margin: 15 }).from(el.firstElementChild).save().then(function () {
                document.body.removeChild(el);
            });
        } else {
            var w = window.open('', '_blank');
            w.document.write(html);
            w.document.close();
            document.body.removeChild(el);
        }
    });

    formSchedule.addEventListener('submit', function (e) {
        e.preventDefault();
        var project = document.getElementById('sched-project').value.trim() || 'Project';
        var startStr = document.getElementById('sched-start').value;
        var duration = parseInt(document.getElementById('sched-duration').value, 10) || 14;
        var phasesStr = document.getElementById('sched-phases').value.trim();
        var phases = phasesStr ? phasesStr.split(',').map(function (p) { return p.trim(); }).filter(Boolean) : ['Mobilization', 'Trenching', 'Pipe install', 'Backfill', 'Restoration'];
        var start = startStr ? new Date(startStr) : new Date();
        var daysPerPhase = Math.max(1, Math.floor(duration / phases.length));
        var rows = [];
        var d = new Date(start);
        for (var i = 0; i < phases.length; i++) {
            var phaseDays = i === phases.length - 1 ? (duration - (phases.length - 1) * daysPerPhase) : daysPerPhase;
            var end = new Date(d);
            end.setDate(end.getDate() + phaseDays - 1);
            rows.push({ phase: phases[i], start: d.toLocaleDateString(), end: end.toLocaleDateString(), days: phaseDays });
            d.setDate(d.getDate() + phaseDays);
        }
        var table = '<table style="width:100%;border-collapse:collapse;"><tr style="background:#f0f0f0;"><th style="padding:10px;text-align:left;">Phase</th><th>Start</th><th>End</th><th>Days</th></tr>';
        rows.forEach(function (r) {
            table += '<tr><td style="padding:10px;border-bottom:1px solid #ddd;">' + r.phase + '</td><td style="padding:10px;border-bottom:1px solid #ddd;">' + r.start + '</td><td style="padding:10px;border-bottom:1px solid #ddd;">' + r.end + '</td><td style="padding:10px;border-bottom:1px solid #ddd;">' + r.days + '</td></tr>';
        });
        table += '</table>';
        var html = '<div class="pdf-doc" style="font-family:Merriweather,Georgia,serif;padding:40px;max-width:700px;margin:0 auto;">' +
            '<h1 style="margin:0 0 8px;">Schedule</h1>' +
            '<p style="color:#666;margin:0 0 24px;">' + project + ' · ' + duration + ' days</p>' +
            table +
            '<p style="margin:24px 0 0;font-size:0.875rem;color:#666;">Generated by Rockmud · rockmud.com</p></div>';
        var el = document.createElement('div');
        el.innerHTML = html;
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        el.style.background = '#fff';
        el.style.color = '#111';
        document.body.appendChild(el);
        if (typeof html2pdf !== 'undefined') {
            html2pdf().set({ filename: 'schedule-' + project.replace(/\s+/g, '-').slice(0, 20) + '.pdf', margin: 15 }).from(el.firstElementChild).save().then(function () {
                document.body.removeChild(el);
            });
        } else {
            var w = window.open('', '_blank');
            w.document.write(html);
            w.document.close();
            document.body.removeChild(el);
        }
    });

    var modelSelect = document.getElementById('model-select');
    var modelTrigger = document.getElementById('model-select-trigger');
    var modelDropdown = document.getElementById('model-dropdown');
    var modelLabel = document.getElementById('model-select-label');
    if (modelSelect && modelTrigger && modelDropdown && modelLabel) {
        var saved = localStorage.getItem(STORAGE_MODEL);
        if (saved && modelSelect.querySelector('option[value="' + saved + '"]')) modelSelect.value = saved;
        function updateModelLabel() {
            var opt = modelSelect.querySelector('option[value="' + modelSelect.value + '"]');
            modelLabel.textContent = opt ? opt.textContent : modelSelect.value;
            modelDropdown.querySelectorAll('.model-dropdown-item').forEach(function (btn) {
                btn.setAttribute('aria-selected', btn.getAttribute('data-value') === modelSelect.value ? 'true' : 'false');
            });
        }
        updateModelLabel();
        modelTrigger.addEventListener('click', function (e) {
            e.stopPropagation();
            var open = !modelDropdown.hidden;
            modelDropdown.hidden = open;
            modelTrigger.setAttribute('aria-expanded', String(!open));
        });
        modelDropdown.addEventListener('click', function (e) { e.stopPropagation(); });
        modelDropdown.querySelectorAll('.model-dropdown-item').forEach(function (btn) {
            btn.addEventListener('click', function () {
                modelSelect.value = btn.getAttribute('data-value');
                localStorage.setItem(STORAGE_MODEL, modelSelect.value);
                updateModelLabel();
                modelDropdown.hidden = true;
                modelTrigger.setAttribute('aria-expanded', 'false');
            });
        });
        document.addEventListener('click', function () {
            modelDropdown.hidden = true;
            modelTrigger.setAttribute('aria-expanded', 'false');
        });
    } else if (modelSelect) {
        var saved = localStorage.getItem(STORAGE_MODEL);
        if (saved) modelSelect.value = saved;
        modelSelect.addEventListener('change', function () { localStorage.setItem(STORAGE_MODEL, modelSelect.value); });
    }

    var btnRefreshChat = document.getElementById('btn-refresh-chat');
    if (btnRefreshChat) {
        btnRefreshChat.addEventListener('click', function () {
            input.value = '';
            input.style.height = 'auto';
            input.focus();
        });
    }

    ensureProject();
    renderProjects();
    renderMessages();
    renderDocuments();

    (function initSidebarResize() {
        var sidebar = document.getElementById('projects-sidebar');
        var handle = document.getElementById('sidebar-resize-handle');
        if (!sidebar || !handle) return;
        var saved = localStorage.getItem(STORAGE_SIDEBAR_WIDTH);
        if (saved) {
            var w = parseInt(saved, 10);
            if (w >= 160 && w <= 400) sidebar.style.setProperty('--sidebar-width', w + 'px');
        }
        var startX, startW;
        handle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            startX = e.clientX;
            startW = sidebar.offsetWidth;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            function onMove(e) {
                var dx = e.clientX - startX;
                var newW = Math.max(160, Math.min(400, startW + dx));
                sidebar.style.setProperty('--sidebar-width', newW + 'px');
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                localStorage.setItem(STORAGE_SIDEBAR_WIDTH, String(sidebar.offsetWidth));
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    })();
})();
