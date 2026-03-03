(function () {
    'use strict';

    var API_BASE = '/api';
    var STORAGE_PROJECTS = 'rockmud_projects';
    var STORAGE_ACTIVE = 'rockmud_activeProject';
    var STORAGE_MESSAGES = 'rockmud_messages';
    var STORAGE_MODEL = 'rockmud_model';
    var STORAGE_CHAT_MODE = 'rockmud_chat_mode';
    var STORAGE_SIDEBAR_WIDTH = 'rockmud_sidebarWidth';
    var DEFAULT_MODEL = 'gpt-4o-mini';
    var BROWSER_TIMEZONE = (function () {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        } catch (e) {
            return 'UTC';
        }
    })();

    var WELCOME_MSG = "Hi, I'm the openmud assistant. Ask me about cost estimates, project types (waterline, sewer, storm, gas, electrical), or anything construction—e.g. \"Estimate 1500 LF of 8 inch sewer in clay.\" You can also use /addevent to create a calendar event with Apple/Google/.ics buttons. Use the Tools menu to open Quick estimate, Proposal, or Schedule—you can edit them right here and refine through chat.";

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

    var messagesEl = document.getElementById('chat-messages-inner') || document.getElementById('chat-messages');
    var form = document.getElementById('chat-form');
    var input = document.getElementById('chat-input');
    var sendBtn = document.getElementById('chat-send');
    var projectsList = document.getElementById('projects-list');
    var btnNewProject = document.getElementById('btn-new-project');
    var modalNewProject = document.getElementById('modal-new-project');
    var modalSettings = document.getElementById('modal-settings');
    var formNewProject = document.getElementById('form-new-project');
    var inputProjectName = document.getElementById('input-project-name');
    var btnCancelProject = document.getElementById('btn-cancel-project');
    var formEstimate = document.getElementById('form-estimate');
    var estimateResult = document.getElementById('estimate-result');
    var estimateFeedback = document.getElementById('estimate-feedback');
    var formFeedback = document.getElementById('form-feedback');
    var inputActualCost = document.getElementById('input-actual-cost');
    var estimatorChipProject = document.getElementById('estimator-chip-project');
    var estimatorChipDocs = document.getElementById('estimator-chip-docs');
    var estimatorChipSummary = document.getElementById('estimator-chip-summary');
    var estimatorChatNote = document.getElementById('estimator-chat-note');

    var activeProjectId = null;
    var editingProjectId = null;
    var docClipboard = null;
    var editingDocumentId = null;
    var activeDocContextMenu = null;
    var lastEstimatePayload = null;
    var lastEstimateResult = null;
    var activeTool = null;
    var authClient = null;
    var authUser = null;
    var authAccessToken = '';
    var authReady = false;
    var authSupabaseUrl = '';

    var btnTools = document.getElementById('btn-tools');
    var toolsDropdown = document.getElementById('tools-dropdown');
    var chatToolPanel = document.getElementById('chat-tool-panel');
    var workspaceFocusBar = document.getElementById('workspace-focusbar');
    var workspaceCanvasPane = document.getElementById('canvas-pane');
    var workspaceDocumentPane = document.getElementById('document-viewer-pane');
    var focusTabChat = document.getElementById('focus-tab-chat');
    var focusTabCanvas = document.getElementById('focus-tab-canvas');
    var chatMessagesPane = document.getElementById('chat-messages');
    var toolPanelTitle = document.getElementById('tool-panel-title');
    var toolPanelSubtitle = document.getElementById('tool-panel-subtitle');
    var btnCloseTool = document.getElementById('btn-close-tool');
    var btnOpenSettings = document.getElementById('btn-open-settings');
    var btnCloseSettings = document.getElementById('btn-close-settings');
    var authStatusEl = document.getElementById('auth-status');
    var btnSigninGoogle = document.getElementById('btn-signin-google');
    var btnSigninApple = document.getElementById('btn-signin-apple');
    var btnSignout = document.getElementById('btn-signout');
    var btnConnectGmail = document.getElementById('btn-connect-gmail');

    function setMainFocus(focus) {
        var f = focus === 'document' ? 'document' : (focus === 'canvas' ? 'canvas' : 'chat');
        if (workspaceFocusBar) workspaceFocusBar.hidden = (f === 'chat');
        if (workspaceCanvasPane) workspaceCanvasPane.hidden = (f !== 'canvas');
        if (workspaceDocumentPane) workspaceDocumentPane.hidden = (f !== 'document');
        if (chatMessagesPane) chatMessagesPane.hidden = (f !== 'chat');
        if (focusTabCanvas) {
            if (f === 'canvas') focusTabCanvas.classList.add('focus-tab-active');
            else focusTabCanvas.classList.remove('focus-tab-active');
        }
        if (focusTabChat) {
            if (f === 'chat') focusTabChat.classList.add('focus-tab-active');
            else focusTabChat.classList.remove('focus-tab-active');
        }
    }

    window.openmudSetMainFocus = setMainFocus;

    function openSettingsModal() {
        if (!modalSettings) return;
        modalSettings.hidden = false;
    }

    function closeSettingsModal() {
        if (!modalSettings) return;
        modalSettings.hidden = true;
    }

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
            .replace(/__([^_]+)__/g, '$1')
            .replace(/_([^_]+)_/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\\\[[\s\S]*?\\\]/g, '')
            .replace(/\$\$[\s\S]*?\$\$/g, '')
            .replace(/^#{1,6}\s+/gm, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/^[-*_]{3,}\s*$/gm, '')
            .replace(/^\s*[-*]\s+/gm, '• ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return s;
    }

    function blobToDataUrl(blob) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result || '')); };
            reader.onerror = function () { reject(reader.error || new Error('Could not read image.')); };
            reader.readAsDataURL(blob);
        });
    }

    function insertTextAtCursor(el, text) {
        if (!el) return;
        var start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
        var end = typeof el.selectionEnd === 'number' ? el.selectionEnd : el.value.length;
        var before = el.value.slice(0, start);
        var after = el.value.slice(end);
        var needsSpacer = before && !/\s$/.test(before);
        var insert = (needsSpacer ? '\n' : '') + text;
        el.value = before + insert + after;
        var cursor = (before + insert).length;
        el.selectionStart = cursor;
        el.selectionEnd = cursor;
    }

    function extractImageText(dataUrl) {
        return fetch(API_BASE + '/ocr-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_data_url: dataUrl })
        }).then(function (r) {
            return r.json().then(function (data) {
                if (!r.ok) {
                    throw new Error((data && data.error) || ('OCR failed (' + r.status + ')'));
                }
                return String((data && data.text) || '').trim();
            });
        });
    }

    function handleImagePaste(file) {
        if (!file) return;
        if (file.size > MAX_FILE_SIZE) {
            addMessage('assistant', 'Pasted image is too large (max 5 MB).');
            return;
        }
        var originalPlaceholder = input.placeholder;
        input.placeholder = 'Extracting text from pasted image...';
        sendBtn.disabled = true;
        blobToDataUrl(file)
            .then(function (dataUrl) { return extractImageText(dataUrl); })
            .then(function (text) {
                if (!text) {
                    addMessage('assistant', 'No readable text found in the pasted image.');
                    return;
                }
                insertTextAtCursor(input, text);
                autoGrowTextarea();
                input.focus();
            })
            .catch(function (err) {
                addMessage('assistant', 'Could not extract text from pasted image. ' + (err.message || 'Try again.'));
            })
            .then(function () {
                input.placeholder = originalPlaceholder;
                sendBtn.disabled = false;
            });
    }

    function toGoogleDate(dateObj) {
        return dateObj.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function buildGoogleCalendarUrl(eventData) {
        var start = new Date(eventData.start_iso);
        var end = new Date(eventData.end_iso || eventData.start_iso);
        var dates;
        if (eventData.all_day) {
            var startDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
            var endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1));
            dates = toGoogleDate(startDay).slice(0, 8) + '/' + toGoogleDate(endDay).slice(0, 8);
        } else {
            dates = toGoogleDate(start) + '/' + toGoogleDate(end);
        }
        var params = new URLSearchParams({
            action: 'TEMPLATE',
            text: eventData.title || 'Event',
            dates: dates
        });
        if (eventData.description) params.set('details', eventData.description);
        if (eventData.location) params.set('location', eventData.location);
        return 'https://calendar.google.com/calendar/render?' + params.toString();
    }

    function renderMessageContent(content, wrap) {
        var text = (content || '').trim();
        var scheduleMatch = text.match(/\[OPENMUD_SCHEDULE\]([\s\S]*?)\[\/OPENMUD_SCHEDULE\]/);
        var proposalMatch = text.match(/\[OPENMUD_PROPOSAL\]([\s\S]*?)\[\/OPENMUD_PROPOSAL\]/);
        var calendarMatch = text.match(/\[OPENMUD_CALENDAR\]([\s\S]*?)\[\/OPENMUD_CALENDAR\]/);
        var displayText = text;
        var scheduleData = null;
        var proposalData = null;
        var calendarData = null;
        if (scheduleMatch) {
            displayText = displayText.replace(/\[OPENMUD_SCHEDULE\][\s\S]*?\[\/OPENMUD_SCHEDULE\]/, '').trim();
            try {
                scheduleData = JSON.parse(scheduleMatch[1].trim());
            } catch (e) { /* ignore */ }
        }
        if (proposalMatch) {
            displayText = displayText.replace(/\[OPENMUD_PROPOSAL\][\s\S]*?\[\/OPENMUD_PROPOSAL\]/, '').trim();
            try {
                proposalData = JSON.parse(proposalMatch[1].trim());
            } catch (e) { /* ignore */ }
        }
        if (calendarMatch) {
            displayText = displayText.replace(/\[OPENMUD_CALENDAR\][\s\S]*?\[\/OPENMUD_CALENDAR\]/, '').trim();
            try {
                calendarData = JSON.parse(calendarMatch[1].trim());
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
            var scheduleState = {
                project: scheduleData.project,
                duration: scheduleData.duration || 14,
                start_date: scheduleData.start_date || new Date().toISOString().slice(0, 10),
                phases: scheduleData.phases.slice()
            };
            function renderScheduleCard(data) {
                if (!data || !data.html) {
                    card.innerHTML = '<div class="msg-schedule-error">Could not load schedule.</div>';
                    return;
                }
                var inner = document.createElement('div');
                inner.className = 'msg-schedule-inner';
                inner.innerHTML = data.html;
                var editWrap = document.createElement('div');
                editWrap.className = 'msg-schedule-edit';
                editWrap.innerHTML = '<div class="msg-schedule-edit-row"><label>Project</label><input type="text" class="sched-edit-project" value="' + (data.project_name || '').replace(/"/g, '&quot;') + '"></div>' +
                    '<div class="msg-schedule-edit-row"><label>Start date</label><input type="date" class="sched-edit-start" value="' + (scheduleState.start_date || '') + '"></div>' +
                    '<div class="msg-schedule-edit-row"><label>Duration (days)</label><input type="number" class="sched-edit-duration" value="' + (data.duration || 14) + '" min="1"></div>' +
                    '<div class="msg-schedule-edit-row"><label>Phases (comma-separated)</label><input type="text" class="sched-edit-phases" value="' + (scheduleState.phases || []).join(', ').replace(/"/g, '&quot;') + '"></div>';
                var btnWrap = document.createElement('div');
                btnWrap.className = 'msg-schedule-actions';
                var updateBtn = document.createElement('button');
                updateBtn.type = 'button';
                updateBtn.className = 'btn-secondary btn-sm';
                updateBtn.textContent = 'Update';
                updateBtn.addEventListener('click', function () {
                    var proj = editWrap.querySelector('.sched-edit-project').value.trim() || 'Project';
                    var start = editWrap.querySelector('.sched-edit-start').value;
                    var dur = parseInt(editWrap.querySelector('.sched-edit-duration').value, 10) || 14;
                    var phasesStr = editWrap.querySelector('.sched-edit-phases').value.trim();
                    var phasesList = phasesStr ? phasesStr.split(',').map(function (p) { return p.trim(); }).filter(Boolean) : ['Mobilization', 'Trenching', 'Pipe install', 'Backfill', 'Restoration'];
                    scheduleState = { project: proj, duration: dur, start_date: start || new Date().toISOString().slice(0, 10), phases: phasesList };
                    updateBtn.disabled = true;
                    updateBtn.textContent = 'Updating…';
                    fetch(API_BASE + '/schedule', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ project_name: proj, duration_days: dur, start_date: start || null, phases: phasesList })
                    }).then(function (r) { return r.json(); }).then(function (d) {
                        renderScheduleCard(d);
                    }).catch(function () {
                        if (updateBtn.parentNode) {
                            updateBtn.disabled = false;
                            updateBtn.textContent = 'Update';
                        }
                        card.innerHTML = '<div class="msg-schedule-error">Could not update schedule.</div>';
                    });
                });
                var pdfBtn = document.createElement('button');
                pdfBtn.type = 'button';
                pdfBtn.className = 'btn-primary btn-sm';
                pdfBtn.textContent = 'Download PDF';
                pdfBtn.addEventListener('click', function () {
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
                btnWrap.appendChild(updateBtn);
                btnWrap.appendChild(pdfBtn);
                inner.appendChild(editWrap);
                inner.appendChild(btnWrap);
                card.innerHTML = '';
                card.appendChild(inner);
            }
            fetch(API_BASE + '/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_name: scheduleState.project,
                    duration_days: scheduleState.duration,
                    start_date: scheduleState.start_date,
                    phases: scheduleState.phases
                })
            }).then(function (r) { return r.json(); }).then(renderScheduleCard).catch(function () {
                card.innerHTML = '<div class="msg-schedule-error">Could not load schedule.</div>';
            });
        }
        if (proposalData && proposalData.scope != null) {
            var propCard = document.createElement('div');
            propCard.className = 'msg-schedule-card msg-proposal-card';
            propCard.innerHTML = '<div class="msg-schedule-loading">Loading proposal…</div>';
            wrap.appendChild(propCard);
            fetch(API_BASE + '/proposal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client: proposalData.client || 'Project',
                    scope: proposalData.scope || '',
                    total: proposalData.total || 0,
                    duration: proposalData.duration || null,
                    bid_items: proposalData.bid_items || []
                })
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (data && data.html) {
                    var inner = document.createElement('div');
                    inner.className = 'msg-schedule-inner';
                    inner.innerHTML = data.html;
                    var btnWrap = document.createElement('div');
                    btnWrap.className = 'msg-schedule-actions';
                    var pdfBtn = document.createElement('button');
                    pdfBtn.type = 'button';
                    pdfBtn.className = 'btn-primary btn-sm';
                    pdfBtn.textContent = 'Download PDF';
                    pdfBtn.addEventListener('click', function () {
                        var el = document.createElement('div');
                        el.innerHTML = data.html;
                        el.style.position = 'absolute';
                        el.style.left = '-9999px';
                        el.style.background = '#fff';
                        el.style.color = '#111';
                        document.body.appendChild(el);
                        if (typeof html2pdf !== 'undefined') {
                            html2pdf().set({ filename: 'proposal-' + (data.client || 'project').replace(/\s+/g, '-').slice(0, 30) + '.pdf', margin: 15 }).from(el.firstElementChild).save().then(function () {
                                document.body.removeChild(el);
                            });
                        } else {
                            var w = window.open('', '_blank');
                            w.document.write(data.html);
                            w.document.close();
                            document.body.removeChild(el);
                        }
                    });
                    btnWrap.appendChild(pdfBtn);
                    inner.appendChild(btnWrap);
                    propCard.innerHTML = '';
                    propCard.appendChild(inner);
                } else {
                    propCard.innerHTML = '<div class="msg-schedule-error">Could not load proposal.</div>';
                }
            }).catch(function () {
                propCard.innerHTML = '<div class="msg-schedule-error">Could not load proposal.</div>';
            });
        }
        if (calendarData && calendarData.title && calendarData.start_iso) {
            var calCard = document.createElement('div');
            calCard.className = 'msg-schedule-card msg-calendar-card';
            var startDate = new Date(calendarData.start_iso);
            var endDate = new Date(calendarData.end_iso || calendarData.start_iso);
            var whenText = calendarData.all_day
                ? startDate.toLocaleDateString()
                : startDate.toLocaleString() + ' - ' + endDate.toLocaleTimeString();
            var whereText = calendarData.location ? ('<div class="msg-calendar-meta"><strong>Location:</strong> ' + escapeHtml(calendarData.location) + '</div>') : '';
            var descText = calendarData.description ? ('<div class="msg-calendar-meta"><strong>Notes:</strong> ' + escapeHtml(calendarData.description) + '</div>') : '';
            calCard.innerHTML = '<div class="msg-schedule-inner">' +
                '<div class="msg-calendar-title">' + escapeHtml(calendarData.title) + '</div>' +
                '<div class="msg-calendar-meta"><strong>When:</strong> ' + escapeHtml(whenText) + '</div>' +
                whereText +
                descText +
                '<div class="msg-schedule-actions"></div>' +
                '</div>';
            var actions = calCard.querySelector('.msg-schedule-actions');
            var payload = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(calendarData)))));
            var icsUrl = API_BASE + '/calendar/ics?data=' + payload;

            var appleBtn = document.createElement('a');
            appleBtn.className = 'btn-secondary btn-sm';
            appleBtn.href = icsUrl;
            appleBtn.target = '_blank';
            appleBtn.rel = 'noopener';
            appleBtn.textContent = 'Add to Apple Calendar';

            var googleBtn = document.createElement('a');
            googleBtn.className = 'btn-secondary btn-sm';
            googleBtn.href = buildGoogleCalendarUrl(calendarData);
            googleBtn.target = '_blank';
            googleBtn.rel = 'noopener';
            googleBtn.textContent = 'Add to Google Calendar';

            var downloadBtn = document.createElement('a');
            downloadBtn.className = 'btn-primary btn-sm';
            downloadBtn.href = icsUrl + '&download=1';
            downloadBtn.textContent = 'Download .ics';

            actions.appendChild(appleBtn);
            actions.appendChild(googleBtn);
            actions.appendChild(downloadBtn);
            wrap.appendChild(calCard);
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
        var container = document.getElementById('chat-messages');
        if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
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
            if (editingProjectId === p.id) {
                var inputEl = document.createElement('input');
                inputEl.type = 'text';
                inputEl.className = 'project-item-input';
                inputEl.value = p.name;
                inputEl.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        renameProject(p.id, inputEl.value);
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        editingProjectId = null;
                        renderProjects();
                    }
                });
                inputEl.addEventListener('blur', function () {
                    renameProject(p.id, inputEl.value);
                });
                li.appendChild(inputEl);
                projectsList.appendChild(li);
                setTimeout(function () {
                    inputEl.focus();
                    inputEl.select();
                }, 0);
                return;
            }
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'project-item' + (p.id === activeProjectId ? ' active' : '');
            btn.textContent = p.name;
            btn.addEventListener('click', function () { switchProject(p.id); });
            btn.addEventListener('dblclick', function (e) {
                e.preventDefault();
                editingProjectId = p.id;
                renderProjects();
            });
            li.appendChild(btn);
            projectsList.appendChild(li);
        });
    }

    function renameProject(projectId, nextName) {
        var name = String(nextName || '').trim();
        editingProjectId = null;
        if (!name) {
            renderProjects();
            return;
        }
        var projects = getProjects();
        var target = projects.find(function (p) { return p.id === projectId; });
        if (!target) {
            renderProjects();
            return;
        }
        target.name = name;
        setProjects(projects);
        renderProjects();
        refreshEstimatorProjectSignals();
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

    function updateDocumentContent(docId, dataBuffer) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(DOC_STORE, 'readwrite');
                var store = tx.objectStore(DOC_STORE);
                var req = store.get(docId);
                req.onsuccess = function () {
                    var doc = req.result;
                    if (!doc) return resolve(false);
                    doc.data = dataBuffer;
                    doc.size = dataBuffer ? dataBuffer.byteLength : (doc.size || 0);
                    store.put(doc);
                };
                req.onerror = function () { reject(req.error); };
                tx.oncomplete = function () {
                    resolve(true);
                };
                tx.onerror = function () { reject(tx.error); };
            });
        }).then(function (ok) {
            if (ok) {
                renderDocuments();
                if (window.openmud && window.openmud.renderCanvas) window.openmud.renderCanvas();
            }
            return ok;
        });
    }

    function cloneDocumentToProject(doc, targetProjectId) {
        if (!doc || !targetProjectId) return Promise.resolve();
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var newDoc = {
                    id: 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
                    projectId: targetProjectId,
                    name: doc.name,
                    size: doc.size,
                    type: doc.type,
                    data: doc.data,
                    createdAt: Date.now()
                };
                var tx = db.transaction(DOC_STORE, 'readwrite');
                tx.objectStore(DOC_STORE).add(newDoc);
                tx.oncomplete = function () { resolve(newDoc.id); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function renameDocument(docId, nextName) {
        var name = String(nextName || '').trim();
        editingDocumentId = null;
        if (!activeProjectId || !docId) {
            renderDocuments();
            return Promise.resolve(false);
        }
        if (!name) {
            renderDocuments();
            return Promise.resolve(false);
        }
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(DOC_STORE, 'readwrite');
                var store = tx.objectStore(DOC_STORE);
                var req = store.get(docId);
                req.onsuccess = function () {
                    var doc = req.result;
                    if (!doc) {
                        resolve(false);
                        return;
                    }
                    doc.name = name;
                    store.put(doc);
                };
                req.onerror = function () { reject(req.error); };
                tx.oncomplete = function () {
                    renderDocuments();
                    resolve(true);
                };
                tx.onerror = function () { reject(tx.error); };
            });
        }).catch(function () {
            renderDocuments();
            return false;
        });
    }

    function hideDocContextMenu() {
        if (!activeDocContextMenu) return;
        if (activeDocContextMenu.parentNode) activeDocContextMenu.parentNode.removeChild(activeDocContextMenu);
        activeDocContextMenu = null;
    }

    function openDocContextMenu(event, doc) {
        hideDocContextMenu();
        if (!doc) return;
        var menu = document.createElement('div');
        menu.className = 'doc-context-menu';
        menu.innerHTML = ''
            + '<button type="button" data-action="open">Open</button>'
            + '<button type="button" data-action="rename">Rename</button>'
            + '<button type="button" data-action="copy">Copy</button>'
            + '<button type="button" data-action="download">Download</button>'
            + '<button type="button" data-action="delete" class="danger">Delete</button>';
        document.body.appendChild(menu);
        var x = event.clientX;
        var y = event.clientY;
        var maxX = window.innerWidth - menu.offsetWidth - 8;
        var maxY = window.innerHeight - menu.offsetHeight - 8;
        menu.style.left = Math.max(8, Math.min(x, maxX)) + 'px';
        menu.style.top = Math.max(8, Math.min(y, maxY)) + 'px';
        menu.querySelector('[data-action="open"]').addEventListener('click', function () {
            hideDocContextMenu();
            if (window.openmud && window.openmud.openDocument) {
                window.openmud.openDocument(doc);
            }
        });
        menu.querySelector('[data-action="rename"]').addEventListener('click', function () {
            editingDocumentId = doc.id;
            hideDocContextMenu();
            renderDocuments();
        });
        menu.querySelector('[data-action="copy"]').addEventListener('click', function () {
            docClipboard = {
                copiedFromProjectId: activeProjectId,
                copiedAt: Date.now(),
                doc: doc
            };
            hideDocContextMenu();
            addMessage('assistant', 'Copied "' + (doc.name || 'document') + '". Switch projects and press Cmd/Ctrl+V to paste.');
        });
        menu.querySelector('[data-action="download"]').addEventListener('click', function () {
            hideDocContextMenu();
            downloadDocument(doc);
        });
        menu.querySelector('[data-action="delete"]').addEventListener('click', function () {
            hideDocContextMenu();
            deleteDocument(doc.id).then(function () {
                renderDocuments();
                if (window.openmud && window.openmud.renderCanvas) window.openmud.renderCanvas();
            });
        });
        activeDocContextMenu = menu;
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
                var openTimer = null;
                if (editingDocumentId === doc.id) {
                    li.innerHTML = ''
                        + '<input type="text" class="document-rename-input" value="' + (doc.name || '').replace(/"/g, '&quot;') + '">'
                        + '<span class="document-size">' + formatSize(doc.size || 0) + '</span>';
                    var renameInput = li.querySelector('.document-rename-input');
                    renameInput.addEventListener('keydown', function (e) {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            renameDocument(doc.id, renameInput.value);
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            editingDocumentId = null;
                            renderDocuments();
                        }
                    });
                    renameInput.addEventListener('blur', function () {
                        renameDocument(doc.id, renameInput.value);
                    });
                    setTimeout(function () {
                        renameInput.focus();
                        renameInput.select();
                    }, 0);
                } else {
                    li.innerHTML = '<span class="document-name" title="' + (doc.name || '').replace(/"/g, '&quot;') + '">' + (doc.name || 'Document') + '</span>' +
                        '<span class="document-size">' + formatSize(doc.size || 0) + '</span>';
                }
                li.addEventListener('click', function () {
                    if (editingDocumentId === doc.id) return;
                    if (openTimer) clearTimeout(openTimer);
                    openTimer = setTimeout(function () {
                        if (window.openmud && window.openmud.openDocument) {
                            window.openmud.openDocument(doc);
                        }
                    }, 180);
                });
                li.addEventListener('dblclick', function () {
                    if (openTimer) clearTimeout(openTimer);
                    editingDocumentId = doc.id;
                    renderDocuments();
                });
                li.addEventListener('contextmenu', function (e) {
                    e.preventDefault();
                    openDocContextMenu(e, doc);
                });
                listEl.appendChild(li);
            });
        });
    }

    function switchProject(id) {
        hideDocContextMenu();
        editingDocumentId = null;
        activeProjectId = id;
        setActiveId(id);
        renderProjects();
        renderMessages();
        renderDocuments();
        if (window.openmud && window.openmud.renderCanvas) window.openmud.renderCanvas();
        refreshEstimatorProjectSignals();
        updateEstimatorSummary();
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
        uploadFilesToActiveProject(Array.from(inputEl.files), 'upload');
        inputEl.value = '';
    }

    function uploadFilesToActiveProject(files, source) {
        if (!activeProjectId || !files || files.length === 0) return;
        var rejected = 0;
        var accepted = 0;
        var tasks = [];
        files.forEach(function (file) {
            if (file.size > MAX_FILE_SIZE) {
                rejected++;
                return;
            }
            accepted++;
            tasks.push(saveDocument(activeProjectId, file).catch(function (err) {
                console.error('Upload failed:', err);
            }));
        });
        Promise.all(tasks).then(function () {
            renderDocuments();
            if (window.openmud && window.openmud.renderCanvas) window.openmud.renderCanvas();
            refreshEstimatorProjectSignals();
            if (accepted > 0 && source === 'paste') {
                addMessage('assistant', 'Added ' + accepted + ' pasted document' + (accepted === 1 ? '' : 's') + ' to this project.');
            }
            if (rejected > 0) {
                addMessage('assistant', 'Some files were skipped (max 5 MB per file).');
            }
        });
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
    if (focusTabChat) {
        focusTabChat.addEventListener('click', function () {
            setMainFocus('chat');
        });
    }
    var documentsSection = document.getElementById('documents-section');
    if (documentsSection) {
        documentsSection.addEventListener('dragover', function (e) {
            if (!activeProjectId) return;
            e.preventDefault();
            documentsSection.classList.add('drop-active');
        });
        documentsSection.addEventListener('dragleave', function () {
            documentsSection.classList.remove('drop-active');
        });
        documentsSection.addEventListener('drop', function (e) {
            documentsSection.classList.remove('drop-active');
            if (!activeProjectId) return;
            e.preventDefault();
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
                uploadFilesToActiveProject(Array.from(e.dataTransfer.files), 'drop');
            }
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
        var indicator = document.getElementById('chat-loading-indicator');
        if (indicator) indicator.hidden = !on;
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

    function getBrowserContext() {
        return '\n[Browser timezone: ' + BROWSER_TIMEZONE + ']';
    }

    function updateAuthUI() {
        if (!authStatusEl) return;
        var signedIn = !!(authUser && authUser.email);

        function setButtonState(btn, opts) {
            if (!btn) return;
            btn.hidden = !!opts.hidden;
            btn.disabled = !!opts.disabled;
        }

        if (!authReady) {
            authStatusEl.textContent = 'Auth unavailable';
            setButtonState(btnSigninGoogle, { hidden: false, disabled: true });
            setButtonState(btnSigninApple, { hidden: false, disabled: true });
            setButtonState(btnConnectGmail, { hidden: false, disabled: true });
            setButtonState(btnSignout, { hidden: false, disabled: true });
            return;
        }

        if (signedIn) {
            authStatusEl.textContent = 'Signed in: ' + authUser.email;
            setButtonState(btnSigninGoogle, { hidden: true, disabled: false });
            setButtonState(btnSigninApple, { hidden: true, disabled: false });
            setButtonState(btnConnectGmail, { hidden: false, disabled: false });
            setButtonState(btnSignout, { hidden: false, disabled: false });
        } else {
            authStatusEl.textContent = 'Not signed in';
            setButtonState(btnSigninGoogle, { hidden: false, disabled: false });
            setButtonState(btnSigninApple, { hidden: false, disabled: false });
            setButtonState(btnConnectGmail, { hidden: true, disabled: true });
            setButtonState(btnSignout, { hidden: true, disabled: true });
        }
    }

    function authHeaders() {
        var headers = { 'Content-Type': 'application/json' };
        if (authAccessToken) headers.Authorization = 'Bearer ' + authAccessToken;
        return headers;
    }

    function refreshAuthSession() {
        if (!authClient) return Promise.resolve();
        return authClient.auth.getSession().then(function (res) {
            var session = res && res.data ? res.data.session : null;
            authUser = session ? session.user : null;
            authAccessToken = session ? (session.access_token || '') : '';
            updateAuthUI();
        }).catch(function () {
            authUser = null;
            authAccessToken = '';
            updateAuthUI();
        });
    }

    function startEmailConnect(provider) {
        if (!authAccessToken) {
            addMessage('assistant', 'Sign in first, then connect your email provider.');
            return;
        }
        var returnPath = window.location.pathname || '/pages/chat.html';
        fetch(API_BASE + '/email/oauth/start', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ provider: provider, return_to: returnPath })
        }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
            .then(function (result) {
                if (!result.ok || !result.data || !result.data.auth_url) {
                    throw new Error((result.data && result.data.error) || 'Could not start OAuth flow.');
                }
                window.location.href = result.data.auth_url;
            })
            .catch(function (err) {
                addMessage('assistant', 'Email connect failed. ' + (err.message || 'Try again.'));
            });
    }

    function initSupabaseAuth() {
        if (!window.supabase || typeof window.supabase.createClient !== 'function') {
            updateAuthUI();
            return;
        }
        fetch(API_BASE + '/auth/config', { method: 'GET' })
            .then(function (r) { return r.json(); })
            .then(function (config) {
                if (!config || !config.enabled || !config.supabase_url || !config.supabase_anon_key) {
                    updateAuthUI();
                    return;
                }
                authSupabaseUrl = String(config.supabase_url || '').trim();
                authClient = window.supabase.createClient(config.supabase_url, config.supabase_anon_key);
                authReady = true;
                return refreshAuthSession().then(function () {
                    authClient.auth.onAuthStateChange(function (event, session) {
                        authUser = session ? session.user : null;
                        authAccessToken = session ? (session.access_token || '') : '';
                        updateAuthUI();
                    });
                });
            })
            .catch(function () {
                authSupabaseUrl = '';
                updateAuthUI();
            });
    }

    function preflightProvider(provider) {
        if (!authSupabaseUrl) return Promise.resolve({ ok: true });
        var redirectTo = window.location.origin + (window.location.pathname || '/pages/chat.html');
        var url = authSupabaseUrl.replace(/\/$/, '') + '/auth/v1/authorize?provider=' + encodeURIComponent(provider) + '&redirect_to=' + encodeURIComponent(redirectTo);
        return fetch(url, {
            method: 'GET',
            redirect: 'manual'
        }).then(function (res) {
            if (res.status >= 300 && res.status < 400) return { ok: true };
            if (res.ok) return { ok: true };
            return res.json().catch(function () { return {}; }).then(function (data) {
                var msg = String((data && (data.msg || data.message || data.error_description || data.error)) || '');
                if (/provider is not enabled/i.test(msg)) {
                    return { ok: false, reason: 'not_enabled' };
                }
                return { ok: true };
            });
        }).catch(function () {
            return { ok: true };
        });
    }

    function signInWithProvider(provider, label) {
        if (!authClient || !authReady) {
            addMessage('assistant', 'Supabase auth is not configured in environment.');
            return;
        }
        preflightProvider(provider).then(function (check) {
            if (!check.ok && check.reason === 'not_enabled') {
                addMessage('assistant', label + ' sign-in is not enabled in Supabase yet. Enable it in Authentication -> Sign In / Providers.');
                return;
            }
            authClient.auth.signInWithOAuth({
                provider: provider,
                options: { redirectTo: window.location.origin + (window.location.pathname || '/pages/chat.html') }
            }).then(function (res) {
                if (res && res.error) {
                    var msg = String(res.error.message || '');
                    if (msg.toLowerCase().indexOf('provider is not enabled') !== -1) {
                        addMessage('assistant', label + ' sign-in is not enabled in Supabase. Enable this provider in Authentication -> Sign In / Providers.');
                        return;
                    }
                    addMessage('assistant', 'Could not start ' + label + ' sign-in. ' + msg);
                }
            }).catch(function (err) {
                addMessage('assistant', 'Could not start ' + label + ' sign-in. ' + (err.message || 'Try again.'));
            });
        });
    }

    function getCopyableChat() {
        var msgs = activeProjectId ? getMessages(activeProjectId) : [];
        if (msgs.length === 0) return '';
        var modelSelect = document.getElementById('model-select');
        var model = modelSelect ? modelSelect.value : DEFAULT_MODEL;
        var mode = localStorage.getItem(STORAGE_CHAT_MODE) === 'ask' ? 'ask' : 'agent';
        var lines = ['Mode: ' + mode, 'Model: ' + model, 'Project: ' + (activeProjectId || '—'), ''];
        msgs.forEach(function (m) {
            lines.push((m.role === 'user' ? 'User' : 'Assistant') + ':');
            lines.push(m.content);
            lines.push('');
        });
        return lines.join('\n');
    }

    function doSend() {
        var text = (input.value || '').trim();
        if (!text || !activeProjectId) return;

        var estimatorUpdates = applyEstimateUpdatesFromText(text);
        if (estimatorUpdates.length > 0) {
            if (activeTool !== 'estimate') openTool('estimate');
            setEstimatorChatNote('Updated from chat: ' + estimatorUpdates.join(', '));
        } else {
            setEstimatorChatNote('');
        }

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
        if (history.length > 0) {
            history[history.length - 1].content = history[history.length - 1].content + getBrowserContext();
        }

        getDocumentsContext().then(function (docCtx) {
            if (docCtx && history.length > 0) {
                history[history.length - 1].content = history[history.length - 1].content + docCtx;
            }
            var modelSelect = document.getElementById('model-select');
            var model = modelSelect ? modelSelect.value : DEFAULT_MODEL;
            var mode = localStorage.getItem(STORAGE_CHAT_MODE) === 'ask' ? 'ask' : 'agent';
            if (modelSelect) localStorage.setItem(STORAGE_MODEL, model);

            var addeventCommand = /^\/addevent\b/i.test(text);
            var useTools = mode === 'agent' || addeventCommand;
            var payload = {
                messages: history,
                model: model,
                chat_mode: mode,
                temperature: 0.7,
                max_tokens: 1024,
                use_tools: useTools,
                available_tools: useTools ? ['build_schedule', 'generate_proposal', 'estimate_project_cost', 'calculate_material_cost', 'calculate_labor_cost', 'calculate_equipment_cost', 'create_calendar_event', 'search_email', 'send_email'] : undefined
            };
            if (useTools && lastEstimatePayload && lastEstimateResult) {
                payload.estimate_context = {
                    payload: lastEstimatePayload,
                    result: lastEstimateResult
                };
            }
            if (!useTools) delete payload.available_tools;

            var controller = new AbortController();
            var timeoutId = setTimeout(function () { controller.abort(); }, 20000);
            fetch(API_BASE + '/chat', {
                method: 'POST',
                headers: authHeaders(),
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
    input.addEventListener('paste', function (e) {
        if (!e.clipboardData || !e.clipboardData.items) return;
        var imageItem = Array.from(e.clipboardData.items).find(function (item) {
            return item && item.kind === 'file' && item.type && item.type.indexOf('image/') === 0;
        });
        if (!imageItem) return; // Keep normal text paste behavior.
        e.preventDefault();
        handleImagePaste(imageItem.getAsFile());
    });
    document.addEventListener('paste', function (e) {
        if (!activeProjectId || !e.clipboardData || !e.clipboardData.items) return;
        if (e.target === input || (e.target && e.target.closest && e.target.closest('#chat-input'))) return;
        var files = Array.from(e.clipboardData.items)
            .filter(function (item) { return item && item.kind === 'file'; })
            .map(function (item) { return item.getAsFile(); })
            .filter(Boolean);
        if (files.length === 0) return;
        e.preventDefault();
        uploadFilesToActiveProject(files, 'paste');
    });
    document.addEventListener('keydown', function (e) {
        var isPaste = (e.metaKey || e.ctrlKey) && String(e.key || '').toLowerCase() === 'v';
        if (!isPaste || !docClipboard || !docClipboard.doc || !activeProjectId) return;
        var target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target.closest && target.closest('#chat-input')))) return;
        e.preventDefault();
        cloneDocumentToProject(docClipboard.doc, activeProjectId).then(function () {
            renderDocuments();
            refreshEstimatorProjectSignals();
            addMessage('assistant', 'Pasted "' + (docClipboard.doc.name || 'document') + '" into this project.');
        }).catch(function () {
            addMessage('assistant', 'Could not paste copied document. Try again.');
        });
    });

    function autoGrowTextarea() {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    }
    input.addEventListener('input', autoGrowTextarea);

    document.querySelectorAll('.quick-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var prompt = btn.getAttribute('data-prompt');
            if (prompt) {
                input.value = prompt;
                autoGrowTextarea();
                input.focus();
            }
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

    function setActiveToolShortcut(tool) {
        document.querySelectorAll('[data-open-tool]').forEach(function (btn) {
            var isActive = btn.getAttribute('data-open-tool') === tool;
            if (btn.classList.contains('quick-tool-btn') || btn.classList.contains('chat-header-tool')) {
                btn.classList.toggle('active', isActive);
            }
        });
    }

    function openTool(tool) {
        activeTool = tool;
        if (toolsDropdown) toolsDropdown.hidden = true;
        if (btnTools) btnTools.setAttribute('aria-expanded', 'false');
        document.querySelectorAll('.tool-form-wrap').forEach(function (el) { el.classList.remove('active'); });
        var wrap = document.getElementById('tool-form-' + tool);
        if (wrap) wrap.classList.add('active');
        var titles = { estimate: 'Quick estimate', proposal: 'Proposal', schedule: 'Build schedule' };
        var subtitles = {
            estimate: 'Set project assumptions and run a rough order-of-magnitude estimate.',
            proposal: 'Generate a clean proposal PDF from scope, cost, and duration.',
            schedule: 'Build a phase schedule and export a field-ready PDF.'
        };
        toolPanelTitle.textContent = titles[tool] || 'Tool';
        if (toolPanelSubtitle) {
            toolPanelSubtitle.textContent = subtitles[tool] || 'Use a workflow form, then refine in chat.';
        }
        chatToolPanel.hidden = false;
        setActiveToolShortcut(tool);
        if (tool === 'estimate') {
            estimateResult.hidden = true;
            estimateFeedback.hidden = true;
            lastEstimatePayload = null;
            refreshEstimatorProjectSignals();
            updateEstimatorSummary();
        }
        if (tool === 'schedule') {
            document.getElementById('sched-start').value = new Date().toISOString().slice(0, 10);
        }
        if (wrap) {
            var firstField = wrap.querySelector('input, select, textarea');
            if (firstField) firstField.focus();
        }
    }

    function closeTool() {
        activeTool = null;
        chatToolPanel.hidden = true;
        document.querySelectorAll('.tool-form-wrap').forEach(function (el) { el.classList.remove('active'); });
        setActiveToolShortcut(null);
    }

    if (btnTools && toolsDropdown) {
        btnTools.addEventListener('click', function (e) {
            e.stopPropagation();
            var isOpen = toolsDropdown.hidden === false;
            toolsDropdown.hidden = isOpen;
            btnTools.setAttribute('aria-expanded', String(!isOpen));
        });
    }

    document.querySelectorAll('.dropdown-item').forEach(function (item) {
        item.addEventListener('click', function () {
            var tool = item.getAttribute('data-tool');
            if (tool) openTool(tool);
        });
    });

    document.querySelectorAll('[data-open-tool]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var tool = btn.getAttribute('data-open-tool');
            if (!tool) return;
            if (activeTool === tool && chatToolPanel.hidden === false) {
                closeTool();
                return;
            }
            openTool(tool);
        });
    });

    btnCloseTool.addEventListener('click', closeTool);

    if (toolsDropdown) toolsDropdown.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () {
        hideDocContextMenu();
        if (toolsDropdown) toolsDropdown.hidden = true;
        if (btnTools) btnTools.setAttribute('aria-expanded', 'false');
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

    function updateEstimatorSummary() {
        if (!estimatorChipSummary) return;
        var p = getEstimatePayload();
        estimatorChipSummary.textContent = 'Scope: ' + (p.linear_feet || 0) + ' LF · ' + (p.pipe_diameter || 0) + ' in · ' + (p.trench_depth || 0) + ' ft';
    }

    function refreshEstimatorProjectSignals() {
        if (estimatorChipProject) {
            var projects = getProjects();
            var active = projects.find(function (p) { return p.id === activeProjectId; });
            estimatorChipProject.textContent = 'Project: ' + (active ? active.name : 'Untitled project');
        }
        if (estimatorChipDocs) {
            if (!activeProjectId) {
                estimatorChipDocs.textContent = 'Docs: 0 linked';
            } else {
                getDocuments(activeProjectId).then(function (docs) {
                    estimatorChipDocs.textContent = 'Docs: ' + docs.length + ' linked';
                }).catch(function () {
                    estimatorChipDocs.textContent = 'Docs: 0 linked';
                });
            }
        }
    }

    function setEstimatorChatNote(text) {
        if (!estimatorChatNote) return;
        if (!text) {
            estimatorChatNote.hidden = true;
            estimatorChatNote.textContent = '';
            return;
        }
        estimatorChatNote.textContent = text;
        estimatorChatNote.hidden = false;
    }

    function applyEstimateUpdatesFromText(text) {
        var t = String(text || '').toLowerCase();
        if (!t) return [];
        var updates = [];
        var byId = {
            project_type: document.getElementById('est-project-type'),
            linear_feet: document.getElementById('est-linear-feet'),
            pipe_diameter: document.getElementById('est-pipe-diameter'),
            trench_depth: document.getElementById('est-trench-depth'),
            soil_type: document.getElementById('est-soil-type'),
            location_zone: document.getElementById('est-location'),
            crew_size: document.getElementById('est-crew-size'),
            season: document.getElementById('est-season'),
            pipe_material: document.getElementById('est-pipe-material'),
            has_dewatering: document.getElementById('est-dewatering'),
            has_rock_excavation: document.getElementById('est-rock'),
            num_fittings: document.getElementById('est-fittings'),
            road_crossings: document.getElementById('est-road-crossings')
        };

        function updateValue(key, next, label) {
            var el = byId[key];
            if (!el) return;
            var prev = (el.type === 'checkbox') ? el.checked : el.value;
            if (el.type === 'checkbox') el.checked = !!next;
            else el.value = String(next);
            var now = (el.type === 'checkbox') ? el.checked : el.value;
            if (String(prev) !== String(now)) updates.push(label + ' → ' + now);
        }

        var num;
        num = t.match(/(?:linear\s*feet|lf)\s*(?:to|=)?\s*(\d[\d,]*)/);
        if (!num) num = t.match(/(\d[\d,]*)\s*(?:lf|linear\s*feet?)/);
        if (num) updateValue('linear_feet', parseInt(num[1].replace(/,/g, ''), 10), 'LF');

        num = t.match(/(?:diameter|pipe(?:\s+size)?)\s*(?:to|=)?\s*(\d+(?:\.\d+)?)/);
        if (!num) num = t.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")\s*(?:pipe|diameter)?/);
        if (num) updateValue('pipe_diameter', parseFloat(num[1]), 'Diameter');

        num = t.match(/(?:depth|trench\s*depth)\s*(?:to|=)?\s*(\d+(?:\.\d+)?)/);
        if (!num) num = t.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|')\s*(?:deep|depth|trench)/);
        if (num) updateValue('trench_depth', parseFloat(num[1]), 'Depth');

        num = t.match(/(?:crew|crew\s*size)\s*(?:to|=)?\s*(\d{1,2})/);
        if (!num) num = t.match(/(\d{1,2})\s*(?:person|people|man)[-\s]*crew/);
        if (num) updateValue('crew_size', parseInt(num[1], 10), 'Crew');

        num = t.match(/(?:fittings?)\s*(?:to|=)?\s*(\d+)/);
        if (num) updateValue('num_fittings', parseInt(num[1], 10), 'Fittings');

        num = t.match(/(?:road\s*crossings?)\s*(?:to|=)?\s*(\d+)/);
        if (num) updateValue('road_crossings', parseInt(num[1], 10), 'Road crossings');

        if (/\bwaterline\b/.test(t)) updateValue('project_type', 'waterline', 'Type');
        else if (/\bsewer\b/.test(t)) updateValue('project_type', 'sewer', 'Type');
        else if (/\bstorm\b/.test(t)) updateValue('project_type', 'storm_drain', 'Type');
        else if (/\bgas\b/.test(t)) updateValue('project_type', 'gas', 'Type');
        else if (/\belectrical\b/.test(t)) updateValue('project_type', 'electrical', 'Type');

        if (/\bsand\b/.test(t)) updateValue('soil_type', 'sand', 'Soil');
        else if (/\bclay\b/.test(t)) updateValue('soil_type', 'clay', 'Soil');
        else if (/\bgravel\b/.test(t)) updateValue('soil_type', 'gravel', 'Soil');
        else if (/\brock\b/.test(t)) updateValue('soil_type', 'rock', 'Soil');

        if (/\bsalt lake\b/.test(t)) updateValue('location_zone', 'salt_lake_metro', 'Location');
        else if (/\butah county\b/.test(t)) updateValue('location_zone', 'utah_county', 'Location');
        else if (/\bdavis\b|\bweber\b/.test(t)) updateValue('location_zone', 'davis_weber', 'Location');
        else if (/\brural\b/.test(t)) updateValue('location_zone', 'rural_utah', 'Location');
        else if (/\bmountain\b/.test(t)) updateValue('location_zone', 'mountain_areas', 'Location');

        if (/\bwinter\b/.test(t)) updateValue('season', 'winter', 'Season');
        else if (/\bspring\b/.test(t)) updateValue('season', 'spring', 'Season');
        else if (/\bsummer\b/.test(t)) updateValue('season', 'summer', 'Season');
        else if (/\bfall\b|\bautumn\b/.test(t)) updateValue('season', 'fall', 'Season');

        if (/\bhdpe\b/.test(t)) updateValue('pipe_material', 'HDPE', 'Material');
        else if (/\bdip\b/.test(t)) updateValue('pipe_material', 'DIP', 'Material');
        else if (/\bsdr\s*35\b/.test(t)) updateValue('pipe_material', 'PVC SDR 35', 'Material');
        else if (/\brcp\b/.test(t)) updateValue('pipe_material', 'RCP', 'Material');
        else if (/\bpvc conduit\b/.test(t)) updateValue('pipe_material', 'PVC Conduit', 'Material');
        else if (/\bpvc\b/.test(t)) updateValue('pipe_material', 'PVC C900', 'Material');

        if (/\bno dewatering\b|\bwithout dewatering\b/.test(t)) updateValue('has_dewatering', false, 'Dewatering');
        else if (/\bdewatering\b/.test(t)) updateValue('has_dewatering', true, 'Dewatering');

        if (/\bno rock\b|\bwithout rock\b/.test(t)) updateValue('has_rock_excavation', false, 'Rock');
        else if (/\brock excavation\b|\brock\b/.test(t)) updateValue('has_rock_excavation', true, 'Rock');

        if (updates.length > 0) {
            updateEstimatorSummary();
            refreshEstimatorProjectSignals();
        }
        return updates;
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
                updateEstimatorSummary();
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
    if (modalSettings) {
        modalSettings.addEventListener('click', function (e) {
            if (e.target === modalSettings) closeSettingsModal();
        });
    }

    function bindEstimateActions() {
        var btnProp = document.getElementById('btn-gen-proposal');
        var btnSched = document.getElementById('btn-gen-schedule');
        if (btnProp) btnProp.onclick = function () { openProposalFromEstimate(); };
        if (btnSched) btnSched.onclick = function () { openScheduleFromEstimate(); };
    }

    var formProposal = document.getElementById('form-proposal');
    var formSchedule = document.getElementById('form-schedule');

    if (formEstimate) {
        formEstimate.querySelectorAll('input, select, textarea').forEach(function (el) {
            el.addEventListener('change', updateEstimatorSummary);
            el.addEventListener('input', updateEstimatorSummary);
        });
    }

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
            '<p style="margin:32px 0 0;font-size:0.875rem;color:#666;">Generated by openmud · openmud.ai</p></div>';
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
            '<p style="margin:24px 0 0;font-size:0.875rem;color:#666;">Generated by openmud · openmud.ai</p></div>';
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
    var modeTrigger = document.getElementById('agent-dropdown');
    var modeDropdown = document.getElementById('mode-dropdown');
    var modeLabel = document.getElementById('agent-mode-label');

    function closeModelDropdown() {
        if (modelDropdown) modelDropdown.hidden = true;
        if (modelTrigger) modelTrigger.setAttribute('aria-expanded', 'false');
    }

    function closeModeDropdown() {
        if (modeDropdown) modeDropdown.hidden = true;
        if (modeTrigger) modeTrigger.setAttribute('aria-expanded', 'false');
    }

    if (modeTrigger && modeDropdown && modeLabel) {
        var savedMode = localStorage.getItem(STORAGE_CHAT_MODE);
        var activeMode = savedMode === 'ask' ? 'ask' : 'agent';
        function updateModeLabel() {
            modeLabel.textContent = activeMode === 'ask' ? 'Ask' : 'Agent';
            modeDropdown.querySelectorAll('.mode-dropdown-item').forEach(function (btn) {
                btn.setAttribute('aria-selected', btn.getAttribute('data-value') === activeMode ? 'true' : 'false');
            });
        }
        updateModeLabel();
        modeTrigger.addEventListener('click', function (e) {
            e.stopPropagation();
            closeModelDropdown();
            var open = !modeDropdown.hidden;
            modeDropdown.hidden = open;
            modeTrigger.setAttribute('aria-expanded', String(!open));
        });
        modeDropdown.addEventListener('click', function (e) { e.stopPropagation(); });
        modeDropdown.querySelectorAll('.mode-dropdown-item').forEach(function (btn) {
            btn.addEventListener('click', function () {
                activeMode = btn.getAttribute('data-value') === 'ask' ? 'ask' : 'agent';
                localStorage.setItem(STORAGE_CHAT_MODE, activeMode);
                updateModeLabel();
                closeModeDropdown();
            });
        });
    }

    if (modelSelect && modelTrigger && modelDropdown && modelLabel) {
        var saved = localStorage.getItem(STORAGE_MODEL);
        if (saved && modelSelect.querySelector('option[value="' + saved + '"]')) {
            modelSelect.value = saved;
        } else {
            modelSelect.value = DEFAULT_MODEL;
            localStorage.setItem(STORAGE_MODEL, DEFAULT_MODEL);
        }
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
            closeModeDropdown();
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
                closeModelDropdown();
            });
        });
        document.addEventListener('click', function () {
            closeModelDropdown();
            closeModeDropdown();
        });
    } else if (modelSelect) {
        var saved = localStorage.getItem(STORAGE_MODEL);
        if (saved && modelSelect.querySelector('option[value="' + saved + '"]')) {
            modelSelect.value = saved;
        } else {
            modelSelect.value = DEFAULT_MODEL;
        }
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

    if (btnSigninGoogle) {
        btnSigninGoogle.addEventListener('click', function () {
            signInWithProvider('google', 'Google');
        });
    }
    if (btnSigninApple) {
        btnSigninApple.addEventListener('click', function () {
            signInWithProvider('apple', 'Apple');
        });
    }
    if (btnSignout) {
        btnSignout.addEventListener('click', function () {
            if (!authClient) return;
            authClient.auth.signOut().then(function () {
                authUser = null;
                authAccessToken = '';
                updateAuthUI();
                closeSettingsModal();
            });
        });
    }
    if (btnConnectGmail) {
        btnConnectGmail.addEventListener('click', function () { startEmailConnect('gmail'); });
    }
    if (btnOpenSettings) {
        btnOpenSettings.addEventListener('click', function () { openSettingsModal(); });
    }
    if (btnCloseSettings) {
        btnCloseSettings.addEventListener('click', function () { closeSettingsModal(); });
    }

    (function initMobileViewportHeight() {
        var root = document.documentElement;
        if (!root || !root.classList.contains('has-app')) return;

        var rafId = null;
        function updateHeight() {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(function () {
                var h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
                if (h && h > 0) root.style.setProperty('--app-height', h + 'px');
            });
        }

        updateHeight();
        window.addEventListener('resize', updateHeight, { passive: true });
        window.addEventListener('orientationchange', updateHeight, { passive: true });
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', updateHeight, { passive: true });
            window.visualViewport.addEventListener('scroll', updateHeight, { passive: true });
        }
    })();

    window.openmud = {
        getActiveProjectId: function () { return activeProjectId; },
        getDocuments: getDocuments,
        saveDocument: saveDocument,
        deleteDocument: deleteDocument,
        renderDocuments: renderDocuments,
        updateDocumentContent: updateDocumentContent,
        openDocument: null,
        closeDocument: null,
        renderCanvas: null
    };

    if (typeof window.openmudInitCanvas === 'function') {
        window.openmudInitCanvas(window.openmud);
    }
    if (typeof window.openmudInitDocumentViewer === 'function') {
        window.openmudInitDocumentViewer(window.openmud);
    }

    ensureProject();
    renderProjects();
    renderMessages();
    renderDocuments();
    setMainFocus('chat');
    if (window.openmud && window.openmud.renderCanvas) window.openmud.renderCanvas();
    updateEstimatorSummary();
    refreshEstimatorProjectSignals();
    initSupabaseAuth();
    updateAuthUI();

    (function handleEmailConnectCallbackNotice() {
        var params = new URLSearchParams(window.location.search || '');
        var connected = params.get('email_connected');
        if (!connected) return;
        if (connected === 'gmail') {
            addMessage('assistant', 'Gmail connected. You can now ask me to search email or draft/send mail.');
        } else if (connected === 'microsoft') {
            addMessage('assistant', 'Outlook connected. You can now ask me to search email or draft/send mail.');
        } else {
            addMessage('assistant', 'Email connect did not complete. Try connecting again.');
        }
        params.delete('email_connected');
        var next = window.location.pathname + (params.toString() ? ('?' + params.toString()) : '');
        window.history.replaceState({}, '', next);
    })();

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
