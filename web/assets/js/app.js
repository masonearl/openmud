(function () {
    'use strict';

    // API base: desktop app uses local tool server (mud1 via Ollama); web uses same-origin or production.
    var isDesktopApp = /mudrag-desktop/i.test(navigator.userAgent || '');
    var isLocal = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    var search = window.location.search || '';
    var toolPortMatch = search.match(/[?&]toolPort=(\d+)/);
    var toolPort = toolPortMatch ? toolPortMatch[1] : (isDesktopApp ? '3847' : '');
    // Web localhost should use same-origin /api. Only force desktop API when
    // explicitly requested or running inside the desktop app runtime.
    var useDesktopApi = /[?&]useDesktopApi=1/.test(search) || isDesktopApp;
    var chatWindowParam = /[?&]chatWindow=1/.test(search);
    var chatWindowProjectId = (search.match(/[?&]projectId=([^&]+)/) || [])[1] || '';
    var chatWindowChatId = (search.match(/[?&]chatId=([^&]+)/) || [])[1] || '';
    var urlHasProdApi = /[?&]useProductionApi=1/.test(search);
    // Keep localhost stable: only use production API when explicitly requested
    // on the current URL. Avoid sticky localStorage flags that can silently force
    // remote API calls and cause confusing fetch failures during local testing.
    var useProdApi = isLocal && urlHasProdApi;
    var isToolServerOrigin = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') && (window.location.port === '3847' || window.location.port === '3848' || window.location.port === '3849' || window.location.port === '3850');
    var API_BASE = useProdApi ? 'https://openmud.ai/api' : (isToolServerOrigin ? '/api' : (useDesktopApi && toolPort ? 'http://127.0.0.1:' + toolPort + '/api' : '/api'));
    var STORAGE_PROJECTS = 'mudrag_projects';
    var STORAGE_ACTIVE = 'mudrag_activeProject';
    var STORAGE_MESSAGES = 'mudrag_messages';
    var STORAGE_PROJECT_DATA = 'mudrag_project_data';
    var STORAGE_ACTIVE_CHAT = 'mudrag_activeChat';
    var STORAGE_MODEL = 'mudrag_model';
    var STORAGE_SIDEBAR_WIDTH = 'mudrag_sidebarWidth';
    var STORAGE_SIDEBAR_VISIBLE = 'mudrag_sidebarVisible';
    var STORAGE_USAGE = 'mudrag_usage';
    var STORAGE_AGENT_MODE = 'mudrag_agentMode';
    var STORAGE_MAIN_VIEW = 'mudrag_try_main_view';
    var STORAGE_RIGHT_PANEL_VISIBLE = 'mudrag_try_right_panel_visible';
    var STORAGE_SUBSCRIBER_EMAIL = 'mudrag_subscriber_email';
    var STORAGE_SUB_ACTIVE = 'mudrag_subscription_active';
    var STORAGE_SUB_TIER = 'mudrag_subscription_tier';
    var STORAGE_PROVIDER_KEYS = 'mudrag_provider_keys_v1';
    var TIER_LIMITS = { free: 5, personal: 100, pro: null, executive: null };
    var _authToken = null;
    var DEV_KEY = 'openmud';

    function getAuthHeaders() {
        var h = { 'Content-Type': 'application/json' };
        if (_authToken) h['Authorization'] = 'Bearer ' + _authToken;
        return h;
    }

    function getProviderKeyHeaders() {
        var h = {};
        var cfg = {};
        try {
            var raw = localStorage.getItem(STORAGE_PROVIDER_KEYS);
            cfg = raw ? JSON.parse(raw) : {};
            if (cfg.openai) h['X-OpenAI-Api-Key'] = String(cfg.openai).trim();
            if (cfg.anthropic) h['X-Anthropic-Api-Key'] = String(cfg.anthropic).trim();
            if (cfg.grok) h['X-Grok-Api-Key'] = String(cfg.grok).trim();
            if (cfg.openrouter) h['X-OpenRouter-Api-Key'] = String(cfg.openrouter).trim();
            if (cfg.openclawApiKey) h['X-OpenClaw-Api-Key'] = String(cfg.openclawApiKey).trim();
            if (cfg.openclawBaseUrl) h['X-OpenClaw-Base-Url'] = String(cfg.openclawBaseUrl).trim();
            if (cfg.openclawModel) h['X-OpenClaw-Model'] = String(cfg.openclawModel).trim();
            // Relay token — always send if present so the server can route to the user's local agent
            var relayToken = '';
            try { relayToken = localStorage.getItem('openmud_oc_relay_token') || ''; } catch (e) {}
            if (relayToken) h['X-Openmud-Relay-Token'] = relayToken;
        } catch (e) {}
        return h;
    }

    function getProviderConfig() {
        try {
            var raw = localStorage.getItem(STORAGE_PROVIDER_KEYS);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function saveProviderConfig(next) {
        try {
            localStorage.setItem(STORAGE_PROVIDER_KEYS, JSON.stringify(next || {}));
            return true;
        } catch (e) {
            return false;
        }
    }

    function setModelSelection(value) {
        var modelSelectEl = document.getElementById('model-select');
        if (!modelSelectEl) return;
        var option = modelSelectEl.querySelector('option[value="' + value + '"]');
        if (!option) return;
        modelSelectEl.value = value;
        localStorage.setItem(STORAGE_MODEL, value);
        var labelEl = document.getElementById('model-select-label');
        if (labelEl) labelEl.textContent = option.textContent || value;
        var dropdownEl = document.getElementById('model-dropdown');
        if (dropdownEl) {
            dropdownEl.querySelectorAll('.model-dropdown-item').forEach(function (btn) {
                btn.setAttribute('aria-selected', btn.getAttribute('data-value') === value ? 'true' : 'false');
            });
        }
    }

    function getChatHeaders() {
        var h = getAuthHeaders();
        var keyHeaders = getProviderKeyHeaders();
        Object.keys(keyHeaders).forEach(function (k) {
            if (keyHeaders[k]) h[k] = keyHeaders[k];
        });
        // Dev key unlocks local testing without forcing a degraded fallback mode.
        try {
            if (localStorage.getItem('mudrag_dev_unlimited') === 'true') h['X-Openmud-Dev-Key'] = DEV_KEY;
        } catch (e) {}
        // Send the browser's local date so the server resolves "today/tonight" correctly
        // instead of using the UTC date on the Vercel server.
        try {
            h['X-Client-Date'] = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
        } catch (e) {}
        return h;
    }

    function syncAuthSession(session) {
        if (session && session.user && session.access_token) {
            _authToken = session.access_token;
            try {
                localStorage.setItem(STORAGE_SUBSCRIBER_EMAIL, session.user.email || '');
                localStorage.removeItem('mudrag_dev_unlimited');
            } catch (e) {}
        } else {
            _authToken = null;
        }
        updateNavAuth();
    }

    function updateNavAuth() {
        var isSignedIn = !!_authToken;
        var email = (isSignedIn && localStorage.getItem(STORAGE_SUBSCRIBER_EMAIL)) || '';
        var emailEl = document.getElementById('nav-user-email');
        var authLink = document.getElementById('nav-auth-link');
        var accountLink = document.getElementById('nav-account-link');
        var billingLink = document.getElementById('nav-billing-link');
        if (emailEl) {
            emailEl.textContent = email;
            emailEl.hidden = !email;
        }
        if (authLink) authLink.hidden = isSignedIn;
        if (accountLink) accountLink.hidden = !isSignedIn;
        if (billingLink) billingLink.hidden = !isSignedIn;
    }

    var WELCOME_MSG = "Hi, I'm the openmud assistant. Ask me about cost estimates, project types (waterline, sewer, storm, gas, electrical), or anything construction—e.g. \"Estimate 1500 LF of 8 inch sewer in clay.\" Just ask in chat and I'll run estimates, build proposals, and create schedules right here.";

    function id() { return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); }

    function getProjects() {
        try {
            var raw = localStorage.getItem(STORAGE_PROJECTS);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }

    function setProjects(arr) {
        localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(arr));
        if (isToolServerOrigin && API_BASE) {
            fetch(API_BASE + '/storage/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(arr)
            }).catch(function () {});
        }
        syncProjectsToApi(arr);
    }

    function syncProjectsToApi(arr) {
        if (!getAuthHeaders().Authorization || !arr || arr.length === 0) return;
        fetch(API_BASE + '/projects', {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ projects: arr })
        }).catch(function () {});
    }

    function loadProjectsFromApi(cb) {
        if (!getAuthHeaders().Authorization) { if (cb) cb(); return; }
        fetch(API_BASE + '/projects', { method: 'GET', headers: getAuthHeaders() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (data && Array.isArray(data.projects) && data.projects.length > 0) {
                    localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(data.projects));
                    if (cb) cb(data.projects);
                }
                if (cb) cb();
            })
            .catch(function () { if (cb) cb(); });
    }

    function syncMessagesToApi(projectId, msgs) {
        if (!getAuthHeaders().Authorization || !projectId) return;
        fetch(API_BASE + '/chat-messages', {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({ project_id: projectId, messages: msgs || getMessages(projectId) })
        }).catch(function () {});
    }

    function loadMessagesFromApi(projectId, cb) {
        if (!getAuthHeaders().Authorization || !projectId) { if (cb) cb([]); return; }
        fetch(API_BASE + '/chat-messages?project_id=' + encodeURIComponent(projectId), { method: 'GET', headers: getAuthHeaders() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                var msgs = (data && data.messages) ? data.messages : [];
                if (cb) cb(msgs);
            })
            .catch(function () { if (cb) cb([]); });
    }

    function getActiveId() {
        return localStorage.getItem(STORAGE_ACTIVE) || null;
    }

    function setActiveId(id) {
        if (id) localStorage.setItem(STORAGE_ACTIVE, id);
        else localStorage.removeItem(STORAGE_ACTIVE);
    }

    function getAllProjectData() {
        try {
            var raw = localStorage.getItem(STORAGE_PROJECT_DATA);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }

    function getProjectData(projectId) {
        if (!projectId) return {};
        var all = getAllProjectData();
        return all[projectId] || {};
    }

    function setProjectData(projectId, data) {
        if (!projectId) return;
        var all = getAllProjectData();
        all[projectId] = data || {};
        localStorage.setItem(STORAGE_PROJECT_DATA, JSON.stringify(all));
    }

    function removeProjectData(projectId) {
        if (!projectId) return;
        var all = getAllProjectData();
        if (!all[projectId]) return;
        delete all[projectId];
        localStorage.setItem(STORAGE_PROJECT_DATA, JSON.stringify(all));
    }

    function toCanonicalBidItems(items) {
        return (items || []).map(function (item, idx) {
            var desc = (item.description || item.desc || item.item || '').toString().trim();
            if (!desc) return null;
            var qty = item.qty != null ? Number(item.qty) : Number(item.quantity);
            var unitPrice = item.unit_price != null ? Number(item.unit_price) : (item.unitCost != null ? Number(item.unitCost) : Number(item.unit_price_cost));
            var amount = item.amount != null ? Number(item.amount) : (item.total != null ? Number(item.total) : NaN);
            if (!isFinite(amount) && isFinite(qty) && isFinite(unitPrice)) amount = Math.round(qty * unitPrice * 100) / 100;
            return {
                item_no: item.itemNo != null ? Number(item.itemNo) : (idx + 1),
                description: desc,
                qty: isFinite(qty) ? qty : 0,
                unit: (item.unit || '').toString(),
                unit_price: isFinite(unitPrice) ? unitPrice : 0,
                amount: isFinite(amount) ? amount : 0,
                section: (item.section || item.spec_section || '').toString(),
                notes: (item.notes || '').toString()
            };
        }).filter(Boolean);
    }

    function persistProjectBidItems(projectId, items, meta) {
        if (!projectId) return [];
        var canonicalItems = toCanonicalBidItems(items);
        var prev = getProjectData(projectId);
        var next = Object.assign({}, prev, {
            bid_items: canonicalItems,
            bid_items_meta: Object.assign({}, prev.bid_items_meta || {}, meta || {}, {
                count: canonicalItems.length,
                updated_at: new Date().toISOString()
            })
        });
        setProjectData(projectId, next);
        return canonicalItems;
    }

    function chatIdGen() { return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); }

    var activeChatId = null;

    function migrateMessages() {
        try {
            var raw = localStorage.getItem(STORAGE_MESSAGES);
            if (!raw) return;
            var all = JSON.parse(raw);
            var needsMigration = false;
            Object.keys(all).forEach(function (pid) { if (Array.isArray(all[pid])) needsMigration = true; });
            if (!needsMigration) return;
            var migrated = {};
            var activeChats = {};
            Object.keys(all).forEach(function (pid) {
                if (Array.isArray(all[pid])) {
                    var cid = chatIdGen();
                    migrated[pid] = {};
                    migrated[pid][cid] = { name: 'Chat 1', messages: all[pid], createdAt: Date.now() };
                    activeChats[pid] = cid;
                } else {
                    migrated[pid] = all[pid];
                }
            });
            localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(migrated));
            localStorage.setItem(STORAGE_ACTIVE_CHAT, JSON.stringify(activeChats));
        } catch (e) { /* migration failed, continue */ }
    }

    function getChats(projectId) {
        try {
            var raw = localStorage.getItem(STORAGE_MESSAGES);
            var all = raw ? JSON.parse(raw) : {};
            return all[projectId] || {};
        } catch (e) { return {}; }
    }

    function getActiveChatId(projectId) {
        try {
            var raw = localStorage.getItem(STORAGE_ACTIVE_CHAT);
            var ac = raw ? JSON.parse(raw) : {};
            return ac[projectId] || null;
        } catch (e) { return null; }
    }

    function setActiveChatId(projectId, cid) {
        try {
            var raw = localStorage.getItem(STORAGE_ACTIVE_CHAT);
            var ac = raw ? JSON.parse(raw) : {};
            ac[projectId] = cid;
            localStorage.setItem(STORAGE_ACTIVE_CHAT, JSON.stringify(ac));
        } catch (e) {}
    }

    function getMessages(projectId) {
        var cid = activeChatId || getActiveChatId(projectId);
        if (!cid) {
            var chats = getChats(projectId);
            var keys = Object.keys(chats);
            if (keys.length === 0) return [];
            cid = keys[0];
        }
        try {
            var chats = getChats(projectId);
            var chat = chats[cid];
            return (chat && chat.messages) ? chat.messages : [];
        } catch (e) { return []; }
    }

    var _messagesSyncTimer = null;
    function setMessages(projectId, msgs) {
        var cid = activeChatId || getActiveChatId(projectId);
        if (!cid) {
            cid = chatIdGen();
            setActiveChatId(projectId, cid);
            activeChatId = cid;
        }
        var raw = localStorage.getItem(STORAGE_MESSAGES);
        var all = raw ? JSON.parse(raw) : {};
        if (!all[projectId]) all[projectId] = {};
        if (!all[projectId][cid]) all[projectId][cid] = { name: 'New chat', messages: [], createdAt: Date.now() };
        all[projectId][cid].messages = msgs;
        localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(all));
        if (getAuthHeaders().Authorization && projectId) {
            clearTimeout(_messagesSyncTimer);
            _messagesSyncTimer = setTimeout(function () {
                syncMessagesToApi(projectId, msgs);
            }, 800);
        }
    }

    function createNewChat(projectId) {
        var cid = chatIdGen();
        var raw = localStorage.getItem(STORAGE_MESSAGES);
        var all = raw ? JSON.parse(raw) : {};
        if (!all[projectId]) all[projectId] = {};
        all[projectId][cid] = { name: 'New chat', messages: [], createdAt: Date.now() };
        localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(all));
        setActiveChatId(projectId, cid);
        activeChatId = cid;
        return cid;
    }

    function deleteChatThread(projectId, chatIdToDelete) {
        var raw = localStorage.getItem(STORAGE_MESSAGES);
        var all = raw ? JSON.parse(raw) : {};
        if (all[projectId] && all[projectId][chatIdToDelete]) {
            delete all[projectId][chatIdToDelete];
            localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(all));
        }
        if (getActiveChatId(projectId) === chatIdToDelete) {
            var keys = Object.keys(all[projectId] || {});
            var next = keys.length > 0 ? keys[0] : null;
            setActiveChatId(projectId, next);
            activeChatId = next;
        }
    }

    function renameChatThread(projectId, chatIdToRename, newName) {
        var raw = localStorage.getItem(STORAGE_MESSAGES);
        var all = raw ? JSON.parse(raw) : {};
        if (all[projectId] && all[projectId][chatIdToRename]) {
            all[projectId][chatIdToRename].name = newName;
            localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(all));
        }
    }

    function autoNameChat(projectId, text) {
        var cid = activeChatId || getActiveChatId(projectId);
        if (!cid) return;
        var chats = getChats(projectId);
        var chat = chats[cid];
        if (!chat || chat.name !== 'New chat') return;
        var name = text.length > 50 ? text.slice(0, 50).replace(/\s+\S*$/, '') + '…' : text;
        if (!name) name = 'Chat';
        renameChatThread(projectId, cid, name);
        renderChats();
    }

    function getUsage() {
        try {
            var raw = localStorage.getItem(STORAGE_USAGE);
            var data = raw ? JSON.parse(raw) : {};
            var today = new Date().toISOString().slice(0, 10);
            if (data.date !== today) return 0;
            return data.count || 0;
        } catch (e) { return 0; }
    }

    function incrementUsage() {
        var meta = arguments[0] || {};
        var today = new Date().toISOString().slice(0, 10);
        var applyLocalIncrement = function () {
            var raw = localStorage.getItem(STORAGE_USAGE);
            var data = raw ? JSON.parse(raw) : {};
            if (data.date !== today) data = { date: today, count: 0 };
            data.count = (data.count || 0) + 1;
            localStorage.setItem(STORAGE_USAGE, JSON.stringify(data));
            return data.count;
        };
        var isDesktopRuntime = isDesktopApp || isToolServerOrigin || (useDesktopApi && toolPort);
        var responseData = meta.responseData || {};
        var modelHint = meta.model || responseData.model_used || responseData.model || 'mud1';
        var usageTracked = !!responseData.usage_tracked;
        var canPostUsage = !!_authToken && isDesktopRuntime;
        if (!canPostUsage) {
            return Promise.resolve(applyLocalIncrement());
        }
        var shouldIncrement = !usageTracked && modelHint === 'mud1';

        var usagePayload = {
            model: 'mud1',
            request_type: 'chat',
            source: 'desktop',
            increment: shouldIncrement,
            input_tokens: Number(responseData.input_tokens || responseData.prompt_tokens || 0) || 0,
            output_tokens: Number(responseData.output_tokens || responseData.completion_tokens || 0) || 0,
        };

        return fetch(API_BASE + '/usage', {
            method: 'POST',
            headers: Object.assign({}, getAuthHeaders(), { 'X-openmud-Source': 'desktop' }),
            body: JSON.stringify(usagePayload),
        })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (data && data.used != null) {
                    localStorage.setItem(STORAGE_USAGE, JSON.stringify({ date: data.date || today, count: data.used }));
                    return data.used;
                }
                return applyLocalIncrement();
            })
            .catch(function () {
                return applyLocalIncrement();
            });
    }

    function getTierLimit() {
        var tier = localStorage.getItem(STORAGE_SUB_TIER) || 'free';
        return TIER_LIMITS[tier] != null ? TIER_LIMITS[tier] : TIER_LIMITS.free;
    }

    function isOverLimit() {
        if (/[?&]dev=1/.test(window.location.search || '')) {
            try { localStorage.setItem(STORAGE_USAGE, JSON.stringify({ date: new Date().toISOString().slice(0, 10), count: 0 })); } catch (e) {}
            return false;  // dev mode: reset usage and bypass
        }
        if (localStorage.getItem('mudrag_dev_unlimited') === 'true') return false;
        var limit = getTierLimit();
        if (limit === null) return false;
        return getUsage() >= limit;
    }

    function checkSubscriptionStatus(cb) {
        if (typeof mudragAuth !== 'undefined') {
            mudragAuth.getSession().then(function (r) {
                var session = r.data && r.data.session;
                if (session && session.access_token) {
                    syncAuthSession(session);
                    fetch(API_BASE + '/user', { method: 'GET', headers: getAuthHeaders() })
                        .then(function (res) { return res.json(); })
                        .then(function (data) {
                            if (data && data.user) {
                                var u = data.user;
                                var active = !!(u.subscription_active);
                                var tier = u.subscription_tier || 'free';
                                try {
                                    localStorage.setItem(STORAGE_SUB_ACTIVE, active ? 'true' : 'false');
                                    localStorage.setItem(STORAGE_SUB_TIER, tier);
                                } catch (e) {}
                                syncUsageFromApi();
                                loadProjectsFromApi(function (projects) {
                                    if (projects && projects.length > 0) {
                                        renderProjects();
                                        if (!activeProjectId || !getProjects().find(function (p) { return p.id === activeProjectId; })) {
                                            switchProject(projects[0].id);
                                        }
                                    }
                                });
                                if (cb) cb(active, tier);
                            } else {
                                runLegacySubscriptionCheck(cb);
                            }
                        })
                        .catch(function () { runLegacySubscriptionCheck(cb); });
                } else {
                    syncAuthSession(null);
                    runLegacySubscriptionCheck(cb);
                }
            }).catch(function () { runLegacySubscriptionCheck(cb); });
        } else {
            runLegacySubscriptionCheck(cb);
        }
    }

    function runLegacySubscriptionCheck(cb) {
        var email = localStorage.getItem(STORAGE_SUBSCRIBER_EMAIL);
        if (!email) {
            try { localStorage.setItem(STORAGE_SUB_ACTIVE, 'false'); localStorage.setItem(STORAGE_SUB_TIER, 'free'); } catch (e) {}
            if (cb) cb(false, 'free');
            return;
        }
        fetch(API_BASE + '/subscription-status', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ email: email })
        }).then(function (r) { return r.json(); }).then(function (data) {
            var active = !!(data && data.active);
            var tier = (data && data.tier) || 'free';
            try {
                localStorage.setItem(STORAGE_SUB_ACTIVE, active ? 'true' : 'false');
                localStorage.setItem(STORAGE_SUB_TIER, tier);
            } catch (e) {}
            syncUsageFromApi();
            loadProjectsFromApi(function (projects) {
                if (projects && projects.length > 0) {
                    renderProjects();
                    if (!activeProjectId || !getProjects().find(function (p) { return p.id === activeProjectId; })) {
                        switchProject(projects[0].id);
                    }
                }
            });
            if (cb) cb(active, tier);
        }).catch(function () {
            try { localStorage.setItem(STORAGE_SUB_ACTIVE, 'false'); localStorage.setItem(STORAGE_SUB_TIER, 'free'); } catch (e) {}
            if (cb) cb(false, 'free');
        });
    }

    function syncUsageFromApi() {
        if (!getAuthHeaders().Authorization) return;
        fetch(API_BASE + '/usage', { method: 'GET', headers: getAuthHeaders() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (data && data.used != null) {
                    var today = new Date().toISOString().slice(0, 10);
                    try {
                        localStorage.setItem(STORAGE_USAGE, JSON.stringify({ date: today, count: data.used }));
                    } catch (e) {}
                    var el = document.getElementById('chat-usage-indicator');
                    if (el) {
                        var limit = data.limit;
                        el.textContent = limit == null ? (data.used + ' today') : (data.used + ' / ' + limit);
                        el.title = 'Messages used today. View details in Settings.';
                    }
                }
            }).catch(function () {});
    }

    if (typeof mudragAuth !== 'undefined') {
        mudragAuth.getSession().then(function (r) {
            var session = r.data && r.data.session;
            syncAuthSession(session);
            checkSubscriptionStatus();
        });
        mudragAuth.onAuthStateChange(function (event, session) {
            syncAuthSession(session);
            checkSubscriptionStatus();
        });
        if (window.mudragDesktop && window.mudragDesktop.onAuthCallback) {
            window.mudragDesktop.onAuthCallback(function () {
                mudragAuth.getSession().then(function (r) {
                    var session = r.data && r.data.session;
                    syncAuthSession(session);
                    checkSubscriptionStatus();
                });
            });
        }
    } else {
        checkSubscriptionStatus();
    }

    var messagesEl = document.getElementById('chat-messages-inner') || document.getElementById('chat-messages');
    var form = document.getElementById('chat-form');
    var input = document.getElementById('chat-input');
    var sendBtn = document.getElementById('chat-send');
    var projectsList = document.getElementById('projects-list');
    var btnNewProject = document.getElementById('btn-new-project');
    var btnOpenFolder = document.getElementById('btn-open-folder');
    var modalNewProject = document.getElementById('modal-new-project');
    var formNewProject = document.getElementById('form-new-project');
    var inputProjectName = document.getElementById('input-project-name');
    var btnCancelProject = document.getElementById('btn-cancel-project');
    var activeProjectId = null;
    var lastEstimatePayload = null;
    var lastEstimateResult = null;
    var activeTools = [];
    var mainWrapper = document.getElementById('main-wrapper');
    var mainContentArea = document.querySelector('.main-content-area');
    var chatPanelWrapper = document.getElementById('chat-panel-wrapper');
    var activeToolsBar = document.getElementById('active-tools-bar');
    var PM_WORKFLOW_CONFIG = [
        { key: 'rfi', label: 'RFI', tool: 'manage_rfi_workflow', doc_type: 'rfi' },
        { key: 'change_order', label: 'Change Order', tool: 'manage_change_order_workflow', doc_type: 'change_order' },
        { key: 'daily_report', label: 'Daily Report', tool: 'autofill_daily_report', doc_type: 'daily_report' },
        { key: 'pay_application', label: 'Pay App', tool: 'manage_pay_app_workflow', doc_type: 'pay_application' },
        { key: 'submittal', label: 'Submittal', tool: 'manage_submittal_workflow', doc_type: 'submittal' }
    ];
    var PM_APPROVAL_READY = { submitted: true, under_review: true };
    var PM_DONE_STATUSES = { approved: true, closed: true };
    var PM_OPEN_STATUSES = { open: true, pending: true, submitted: true, under_review: true, overdue: true };
    var pmOpsRefreshTimer = null;
    var pmOpsState = {
        items: [],
        dueItems: [],
        loadedProjectId: null,
        desktopAvailable: false
    };

    function addMessage(role, content, projectId) {
        projectId = projectId || activeProjectId;
        if (!projectId) return;
        var msgs = getMessages(projectId);
        msgs.push({ role: role, content: content });
        setMessages(projectId, msgs);
        if (role === 'user') autoNameChat(projectId, content);
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

    function saveTextDocument(projectId, filename, textContent) {
        return getDocuments(projectId).then(function (docs) {
            var existing = docs.find(function (d) { return d.name === filename; });
            if (existing) return Promise.resolve(existing.id);
            var blob = new Blob([textContent], { type: 'text/markdown' });
            var file = new File([blob], filename, { type: 'text/markdown' });
            return saveDocument(projectId, file);
        });
    }

    /**
     * Convert mud1 proposal data into the chunk format used by the proposal generator,
     * store it in localStorage, then navigate to the proposal editor.
     */
    function openProposalInEditor(pData) {
        var chunks = [];
        var id = 1;
        var fmt = function (n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

        // Scope of Work
        if (pData.scope) {
            chunks.push({ id: String(id++), title: 'Scope of Work', content: pData.scope });
        }

        // Pricing table from bid_items
        var bidItems = pData.bid_items || [];
        if (bidItems.length > 0) {
            var rows = ['| # | Description | Qty | Unit | Unit Price | Total |', '|---|-------------|-----|------|------------|-------|'];
            bidItems.forEach(function (item, idx) {
                var qty   = item.qty != null ? item.qty : '';
                var unit  = item.unit || '';
                var up    = item.unit_price != null ? fmt(item.unit_price) : '';
                var amt   = item.amount != null ? fmt(item.amount) : '';
                rows.push('| ' + (idx + 1) + ' | ' + (item.description || '') + ' | ' + qty + ' | ' + unit + ' | ' + up + ' | ' + amt + ' |');
            });
            rows.push('| | | | | **Total:** | **' + fmt(pData.total || 0) + '** |');
            chunks.push({ id: String(id++), title: 'Pricing', content: rows.join('\n') });
        } else if (pData.total) {
            chunks.push({ id: String(id++), title: 'Pricing', content: '| # | Description | Total |\n|---|-------------|-------|\n| 1 | Project Total | **' + fmt(pData.total) + '** |\n| | | **' + fmt(pData.total) + '** |' });
        }

        // Standard inclusions
        chunks.push({ id: String(id++), title: 'Inclusions', content: '- All materials and labor required to complete the described scope\n- Permits and inspections as required by jurisdiction\n- Site cleanup and debris removal upon completion\n- Manufacturer-standard warranties on all installed materials\n- Project coordination and scheduling\n- Safety equipment and compliance with OSHA standards' });

        // Standard exclusions
        chunks.push({ id: String(id++), title: 'Exclusions', content: '- Work not specifically listed in this proposal\n- Engineering, design, or architectural services unless noted\n- Unforeseen site conditions or hazardous materials\n- Patch and paint beyond directly disturbed areas unless noted\n- Weekend or overtime work unless separately agreed upon\n- Temporary facilities or utilities unless specified' });

        // Assumptions
        chunks.push({ id: String(id++), title: 'Assumptions & Clarifications', content: '- Pricing is based on normal working hours (7 AM – 5 PM, Mon–Fri)\n- Site is accessible and clear for equipment and materials\n- Existing utilities are correctly marked prior to excavation\n- Owner is responsible for any required easements or right-of-way\n- Price is valid for 30 days from the date of this proposal' });

        var editorData = {
            projectTitle: pData.client ? ('Proposal — ' + pData.client) : 'PROPOSAL',
            preparedFor:  pData.client || '',
            preparedBy:   '',
            subtitle:     pData.duration ? ('Estimated duration: ' + pData.duration) : '',
            chunks:       chunks
        };

        localStorage.setItem('proposalFromBid', JSON.stringify(editorData));

        // Open the proposal generator — in desktop app use same window, in browser open new tab
        var editorUrl = '/tools/proposal-generator.html?fromBid=true';
        if (window.mudragDesktop && window.mudragDesktop.openExternal) {
            // Electron: navigate within the app by loading the page in the current window
            window.location.href = editorUrl;
        } else {
            window.open(editorUrl, '_blank');
        }
    }

    function base64ToArrayBuffer(base64) {
        var binary = atob(String(base64 || ''));
        var len = binary.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }

    function isExtractableBidDocName(name) {
        return /\.(csv|tsv|txt|md|markdown|json)$/i.test(String(name || ''));
    }

    // Classify an attachment into a smart folder name based on filename + email subject.
    function classifyAttachmentFolder(fileName, emailSubject) {
        var name = (fileName || '').toLowerCase();
        var subj = (emailSubject || '').toLowerCase();
        var combined = name + ' ' + subj;
        var ext = name.split('.').pop();

        // Images
        if (/\.(jpg|jpeg|png|gif|bmp|webp|heic|tiff?)$/i.test(name)) return 'Photos';
        // Video
        if (/\.(mp4|mov|avi|mkv)$/i.test(name)) return 'Photos';

        // Scope / project scope documents
        if (/\b(scope|sow|statement\s+of\s+work)\b/.test(combined)) return 'Scope';
        // Contracts / agreements
        if (/\b(contract|agreement|subcontract|nda|lien\s+waiver|bond)\b/.test(combined)) return 'Contracts';
        // Permits
        if (/\b(permit|permission|approval|license|encroachment)\b/.test(combined)) return 'Permits';
        // Plans / drawings / blueprints
        if (/\b(plan|plans|drawing|drawings|blueprint|blueprints|layout|site\s+plan|civil)\b/.test(combined) ||
            /\.(dwg|dxf|rvt|skp)$/i.test(name)) return 'Plans & Drawings';
        // Specs / specifications
        if (/\b(spec|specs|specification|specifications|technical\s+doc)\b/.test(combined)) return 'Specs';
        // Bids / proposals / quotes / estimates
        if (/\b(bid|proposal|quote|estimate|rfq|rfp|rfb|invitation\s+to\s+bid|itb)\b/.test(combined)) return 'Bids & Proposals';
        // Invoices / pay apps / pay requests
        if (/\b(invoice|pay\s+app|payment|application\s+for\s+payment|aia\s+g702|aia)\b/.test(combined)) return 'Invoices';
        // Submittals / shop drawings / cut sheets
        if (/\b(submittal|shop\s+drawing|cut\s+sheet|product\s+data|material\s+data)\b/.test(combined)) return 'Submittals';
        // RFIs
        if (/\b(rfi|request\s+for\s+information)\b/.test(combined)) return 'RFIs';
        // Change orders
        if (/\b(change\s+order|change\s+directive|cco|pco)\b/.test(combined)) return 'Change Orders';
        // Reports / daily reports
        if (/\b(daily\s+report|inspection\s+report|progress\s+report|soil\s+report|geotech)\b/.test(combined)) return 'Reports';
        // Spreadsheets / schedules
        if (/\.(xlsx?|csv|tsv|ods)$/i.test(name)) return 'Spreadsheets';
        // Misc PDFs / docs with no clear category
        if (/\.(pdf|docx?|pptx?)$/i.test(name)) return 'Documents';

        return 'Email Imports';
    }

    function inferSuggestedWorkflowFromAttachment(folderName, fileName, emailSubject) {
        var txt = String(folderName || '') + ' ' + String(fileName || '') + ' ' + String(emailSubject || '');
        var lower = txt.toLowerCase();
        if (/\b(rfi|request\s+for\s+information)\b/.test(lower)) {
            return { type: 'rfi', label: 'Create an RFI workflow' };
        }
        if (/\b(submittal|shop\s+drawing|cut\s+sheet|material\s+data|product\s+data|spec)\b/.test(lower)) {
            return { type: 'submittal', label: 'Create a submittal workflow' };
        }
        return { type: 'task', label: 'Create a follow-up task' };
    }

    function buildImportSuggestedActions(importedDocs, emailSubject) {
        var byType = {};
        (importedDocs || []).forEach(function (doc) {
            var suggestion = inferSuggestedWorkflowFromAttachment(doc.folder, doc.name, emailSubject);
            if (!byType[suggestion.type]) {
                byType[suggestion.type] = { type: suggestion.type, label: suggestion.label, count: 0 };
            }
            byType[suggestion.type].count += 1;
        });
        return Object.keys(byType).map(function (k) { return byType[k]; }).sort(function (a, b) { return b.count - a.count; });
    }

    // File type icon helper
    function getFileIcon(ext) {
        var e = (ext || '').toLowerCase();
        if (e === '.pdf') return '📄';
        if (['.docx', '.doc'].includes(e)) return '📝';
        if (['.xlsx', '.xls', '.csv'].includes(e)) return '📊';
        if (['.pptx', '.ppt'].includes(e)) return '📋';
        if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic'].includes(e)) return '🖼';
        if (['.dwg', '.dxf', '.skp'].includes(e)) return '📐';
        if (['.md', '.txt', '.rtf'].includes(e)) return '📃';
        return '📁';
    }

    // Import local files (from file scanner results) into the active project
    function importLocalFiles(files) {
        if (!activeProjectId) return Promise.reject(new Error('No active project.'));
        if (!window.mudragDesktop || !window.mudragDesktop.readLocalFile) {
            return Promise.reject(new Error('File import only available in the desktop app.'));
        }
        var imported = 0;
        var foldersUsed = new Set();

        var chain = Promise.resolve();
        (files || []).forEach(function (fileInfo) {
            chain = chain.then(function () {
                return window.mudragDesktop.readLocalFile(fileInfo.path).then(function (result) {
                    if (!result || !result.ok) return;
                    var folderName = classifyAttachmentFolder(fileInfo.name, '');
                    foldersUsed.add(folderName);
                    return getOrCreateFolder(activeProjectId, folderName).then(function (folderId) {
                        var bytes = Uint8Array.from(atob(result.base64), function (c) { return c.charCodeAt(0); });
                        var blob = new Blob([bytes], { type: result.mime || 'application/octet-stream' });
                        var file = new File([blob], result.name, { type: result.mime || 'application/octet-stream' });
                        return saveDocument(activeProjectId, file, folderId, {
                            source: 'local-file-import',
                            source_meta: { path: fileInfo.path || '', folder: folderName }
                        }).then(function () {
                            imported++;
                            renderDocuments();
                        });
                    });
                }).catch(function () { /* skip unreadable files */ });
            });
        });

        return chain.then(function () {
            return { count: imported, folders: Array.from(foldersUsed) };
        });
    }

    function importEmailAttachmentsToProject(emailData, options) {
        options = options || {};
        if (!activeProjectId) {
            return Promise.resolve({ ok: false, error: 'Open a project first.' });
        }
        if (!window.mudragDesktop || !window.mudragDesktop.importMailAttachments) {
            return Promise.resolve({ ok: false, error: 'Email import is only available in the desktop app.' });
        }

        var maxFiles = options.maxFiles || 12;
        var maxFileBytes = options.maxFileBytes || (20 * 1024 * 1024);
        var emailSubject = (emailData && emailData.subject) || '';
        var payload = {
            sender: (emailData && (emailData.sender || emailData.sender_address)) || '',
            subject: emailSubject,
            index: (emailData && emailData.index) || 0,
            message_id: (emailData && emailData.message_id) || null,
            max_files: maxFiles,
            max_file_bytes: maxFileBytes
        };

        return window.mudragDesktop.importMailAttachments(payload).then(function (result) {
            if (!result || !result.ok) {
                return { ok: false, error: (result && result.error) || 'Could not extract attachments from Mail.app.' };
            }
            var attachments = Array.isArray(result.attachments) ? result.attachments : [];
            if (attachments.length === 0) {
                return { ok: true, imported_count: 0, extracted_bid_items: 0, skipped: result.skipped || [], message: 'No attachments found on that email.' };
            }

            // Group attachments by their smart folder
            var folderGroups = {};
            attachments.forEach(function (att, idx) {
                if (!att || !att.base64) return;
                var safeName = String(att.name || ('attachment-' + (idx + 1))).replace(/[\\/]/g, '-');
                var folder = options.folderName || classifyAttachmentFolder(safeName, emailSubject);
                if (!folderGroups[folder]) folderGroups[folder] = [];
                folderGroups[folder].push({ att: att, safeName: safeName });
            });

            // Create all needed folders and save files into the right ones
            var importedMeta = [];
            var folderNames = Object.keys(folderGroups);
            return Promise.all(folderNames.map(function (fname) {
                return getOrCreateFolder(activeProjectId, fname);
            })).then(function (folderIds) {
                var folderIdMap = {};
                folderNames.forEach(function (fname, i) { folderIdMap[fname] = folderIds[i]; });

                var saveOps = [];
                folderNames.forEach(function (fname) {
                    var fid = folderIdMap[fname];
                    (folderGroups[fname] || []).forEach(function (item) {
                        var op = (function (att, safeName, folderId) {
                            try {
                                var fileData = base64ToArrayBuffer(att.base64);
                                var file = new File([fileData], safeName, { type: att.mime || 'application/octet-stream' });
                                return saveDocument(activeProjectId, file, folderId, {
                                    source: 'email-import',
                                    source_meta: {
                                        sender: payload.sender || '',
                                        subject: payload.subject || '',
                                        message_id: payload.message_id || null,
                                        folder: fname
                                    }
                                }).then(function (docId) {
                                    importedMeta.push({
                                        id: docId,
                                        name: safeName,
                                        folder: fname,
                                        suggested_action: inferSuggestedWorkflowFromAttachment(fname, safeName, emailSubject)
                                    });
                                    _lastCreatedDocId = docId;
                                    return docId;
                                }).catch(function () { return null; });
                            } catch (e) {
                                return Promise.resolve(null);
                            }
                        })(item.att, item.safeName, fid);
                        saveOps.push(op);
                    });
                });

                return Promise.all(saveOps).then(function () {
                    var importedIds = importedMeta.map(function (m) { return m.id; }).filter(Boolean);
                    if (importedIds.length === 0) {
                        return { ok: false, error: 'Could not save email attachments into project documents.' };
                    }
                    return getDocuments(activeProjectId).then(function (docs) {
                        var byId = {};
                        (docs || []).forEach(function (d) { byId[d.id] = d; });
                        var extractable = importedIds
                            .map(function (id) { return byId[id]; })
                            .filter(function (doc) { return doc && isExtractableBidDocName(doc.name); })
                            .slice(0, 8);
                        if (extractable.length === 0) {
                            return {
                                ok: true,
                                imported_count: importedIds.length,
                                extracted_bid_items: 0,
                                imported_docs: importedMeta,
                                folders_used: folderNames,
                                suggested_actions: buildImportSuggestedActions(importedMeta, emailSubject),
                                skipped: result.skipped || []
                            };
                        }
                        return Promise.all(extractable.map(function (doc) {
                            return extractBidItemsFromReferencedDocument(activeProjectId, doc).catch(function () { return []; });
                        })).then(function (itemLists) {
                            var mergedItems = [];
                            (itemLists || []).forEach(function (items) {
                                (items || []).forEach(function (item) { mergedItems.push(item); });
                            });
                            var extractedCount = mergedItems.length;
                            if (extractedCount > 0) {
                                var sourceNames = extractable.map(function (d) { return d.name; }).join(', ').slice(0, 240);
                                persistProjectBidItems(activeProjectId, mergedItems, {
                                    source: 'email_attachment_import',
                                    source_doc_name: sourceNames,
                                    parsed_rows: extractedCount,
                                    mapped_valid_bid_items: extractedCount
                                });
                            }
                            return {
                                ok: true,
                                imported_count: importedIds.length,
                                extracted_bid_items: extractedCount,
                                imported_docs: importedMeta,
                                folders_used: folderNames,
                                suggested_actions: buildImportSuggestedActions(importedMeta, emailSubject),
                                skipped: result.skipped || []
                            };
                        });
                    });
                });
            }).then(function (summary) {
                renderDocuments();
                if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
                return summary;
            }).catch(function (err) {
                return { ok: false, error: err.message || 'Email import failed.' };
            });
        }).catch(function (err) {
            return { ok: false, error: err.message || 'Email import failed.' };
        });
    }

    function importMultipleEmailAttachments(emails, options) {
        options = options || {};
        var queue = (emails || []).slice(0, Math.max(1, options.maxEmails || 5));
        var aggregate = {
            ok: true,
            processed: 0,
            failed: 0,
            imported_count: 0,
            extracted_bid_items: 0,
            errors: []
        };
        var chain = Promise.resolve();
        queue.forEach(function (emailData) {
            chain = chain.then(function () {
                return importEmailAttachmentsToProject(emailData, options).then(function (result) {
                    aggregate.processed += 1;
                    if (!result || !result.ok) {
                        aggregate.failed += 1;
                        if (result && result.error) aggregate.errors.push(result.error);
                        return;
                    }
                    aggregate.imported_count += result.imported_count || 0;
                    aggregate.extracted_bid_items += result.extracted_bid_items || 0;
                });
            });
        });
        return chain.then(function () {
            aggregate.ok = aggregate.failed < aggregate.processed || aggregate.imported_count > 0;
            return aggregate;
        });
    }

    function renderMessageContent(content, wrap) {
        var text = (content || '').trim();
        var scheduleMatch = text.match(/\[MUDRAG_SCHEDULE\]([\s\S]*?)\[\/MUDRAG_SCHEDULE\]/);
        var proposalMatch = text.match(/\[MUDRAG_PROPOSAL\]([\s\S]*?)\[\/MUDRAG_PROPOSAL\]/);
        var resumeMatch = text.match(/\[MUDRAG_RESUME\]([\s\S]*?)\[\/MUDRAG_RESUME\]/);
        var createProjectMatch = text.match(/\[MUDRAG_CREATE_PROJECT\]([\s\S]*?)\[\/MUDRAG_CREATE_PROJECT\]/);
        var chooseEmailMatch = text.match(/\[MUDRAG_CHOOSE_EMAIL_ACCOUNT\]([\s\S]*?)\[\/MUDRAG_CHOOSE_EMAIL_ACCOUNT\]/);
        var emailResultsMatch = text.match(/\[MUDRAG_EMAIL_RESULTS\]([\s\S]*?)\[\/MUDRAG_EMAIL_RESULTS\]/);
        var workResultsMatch = text.match(/\[MUDRAG_WORK_RESULTS\]([\s\S]*?)\[\/MUDRAG_WORK_RESULTS\]/);
        var fileResultsMatch = text.match(/\[MUDRAG_FILE_RESULTS\]([\s\S]*?)\[\/MUDRAG_FILE_RESULTS\]/);
        var bidDocMatch = text.match(/\[MUDRAG_BID_DOC\]([\s\S]*?)\[\/MUDRAG_BID_DOC\]/);
        var actionsMatch = text.match(/\[MUDRAG_ACTIONS\]([\s\S]*?)\[\/MUDRAG_ACTIONS\]/);
        var saveDocMatch = text.match(/\[MUDRAG_SAVE_DOC\]([\s\S]*?)\[\/MUDRAG_SAVE_DOC\]/);
        var createFolderMatch = text.match(/\[MUDRAG_CREATE_FOLDER\]([\s\S]*?)\[\/MUDRAG_CREATE_FOLDER\]/);
        var autoFolderMatch = text.match(/\[MUDRAG_AUTO_FOLDER\]([\s\S]*?)\[\/MUDRAG_AUTO_FOLDER\]/);
        var citationsMatch = text.match(/\[MUDRAG_CITATIONS\]([\s\S]*?)\[\/MUDRAG_CITATIONS\]/);
        var displayText = text;

        // Document created (template engine output card)
        var docMatch = text.match(/\[MUDRAG_DOCUMENT\]([\s\S]*?)\[\/MUDRAG_DOCUMENT\]/);
        if (docMatch) {
            displayText = displayText.replace(/\[MUDRAG_DOCUMENT\][\s\S]*?\[\/MUDRAG_DOCUMENT\]/, '').trim();
            try {
                var docData = JSON.parse(docMatch[1]);
                if (wrap && !wrap._mudragDocDone) {
                    wrap._mudragDocDone = true;
                    var docCard = document.createElement('div');
                    docCard.className = 'msg-doc-card';
                    var isDesktop = typeof window.mudragDesktop !== 'undefined';
                    var iconSvg = docData.type === 'diagram'
                        ? '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>'
                        : '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
                    docCard.innerHTML = '<div class="msg-doc-header">' + iconSvg +
                        '<span>' + (docData.doc_name || docData.type || 'Document') + '</span>' +
                        '</div>' +
                        '<div class="msg-doc-actions">' +
                        (isDesktop && docData.html_path ? '<button class="btn-doc btn-doc-open" data-path="' + (docData.html_path || '') + '">Open in Browser</button>' : '') +
                        (isDesktop && docData.pdf_path ? '<button class="btn-doc btn-doc-pdf" data-path="' + (docData.pdf_path || '') + '">Open PDF</button>' : '') +
                        (isDesktop ? '<button class="btn-doc btn-doc-folder" data-path="' + (docData.saved_to || '') + '">Show in Finder</button>' : '') +
                        (isDesktop ? '<button class="btn-doc btn-doc-edit" data-doc-type="' + (docData.doc_type || '') + '" data-html-path="' + (docData.html_path || '') + '">Edit Template</button>' : '') +
                        '</div>';
                    if (isDesktop) {
                        docCard.querySelector('.btn-doc-open') && docCard.querySelector('.btn-doc-open').addEventListener('click', function () {
                            window.mudragDesktop.openDocSource(this.dataset.path);
                        });
                        docCard.querySelector('.btn-doc-pdf') && docCard.querySelector('.btn-doc-pdf').addEventListener('click', function () {
                            window.mudragDesktop.openDocSource(this.dataset.path);
                        });
                        docCard.querySelector('.btn-doc-folder') && docCard.querySelector('.btn-doc-folder').addEventListener('click', function () {
                            window.mudragDesktop.openDocFolder(this.dataset.path);
                        });
                        docCard.querySelector('.btn-doc-edit') && docCard.querySelector('.btn-doc-edit').addEventListener('click', function () {
                            var btn = this;
                            var docType = btn.dataset.docType;
                            var htmlPath = btn.dataset.htmlPath;
                            var instruction = prompt('Describe your edit (e.g. "change header to dark blue", "add a notes column"):');
                            if (!instruction) return;
                            btn.disabled = true; btn.textContent = 'Editing…';
                            var token = window._authToken || '';
                            window.mudragDesktop.editDoc({ docType: docType, instruction: instruction, htmlPath: htmlPath, authToken: token })
                                .then(function (result) {
                                    btn.disabled = false; btn.textContent = 'Edit Template';
                                    if (result.ok) {
                                        var notice = document.createElement('div');
                                        notice.className = 'msg-doc-notice msg-doc-notice-ok';
                                        notice.textContent = result.message || 'Template updated.';
                                        docCard.appendChild(notice);
                                    } else {
                                        btn.textContent = 'Edit failed — retry';
                                        console.error('[doc edit]', result.error);
                                    }
                                });
                        });
                    }
                    wrap.appendChild(docCard);
                }
            } catch (e) { console.error('[MUDRAG_DOCUMENT parse]', e); }
        }

        // Doc edit intent block — trigger AI edit flow
        var editDocMatch = text.match(/\[MUDRAG_EDIT_DOC\]([\s\S]*?)\[\/MUDRAG_EDIT_DOC\]/);
        if (editDocMatch) {
            displayText = displayText.replace(/\[MUDRAG_EDIT_DOC\][\s\S]*?\[\/MUDRAG_EDIT_DOC\]/, '').trim();
            try {
                var editData = JSON.parse(editDocMatch[1]);
                if (wrap && !wrap._mudragEditDone) {
                    wrap._mudragEditDone = true;
                    var editCard = document.createElement('div');
                    editCard.className = 'msg-doc-card msg-doc-edit-card';
                    editCard.innerHTML = '<div class="msg-doc-header"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>Edit a Document</span></div>' +
                        '<div style="padding:10px 0 6px;font-size:0.83rem;color:var(--text-secondary)">Which document would you like to edit?</div>' +
                        '<select class="doc-edit-select" style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input,#1e293b);color:inherit;margin-bottom:8px">' +
                        '<option value="project_schedule">Project Schedule</option>' +
                        '<option value="change_order">Change Order</option>' +
                        '<option value="daily_report">Daily Report</option>' +
                        '<option value="rfi">RFI</option>' +
                        '<option value="pay_application">Pay Application</option>' +
                        '</select>' +
                        '<button class="btn-primary btn-sm btn-doc-apply-edit">Apply Edit</button>' +
                        '<div class="msg-doc-notice" style="display:none;margin-top:8px"></div>';
                    var applyBtn = editCard.querySelector('.btn-doc-apply-edit');
                    var selectEl = editCard.querySelector('.doc-edit-select');
                    var noticeEl = editCard.querySelector('.msg-doc-notice');
                    applyBtn.addEventListener('click', function () {
                        var docType = selectEl.value;
                        var instruction = editData.instruction || '';
                        applyBtn.disabled = true; applyBtn.textContent = 'Editing…';
                        var token = window._authToken || '';
                        window.mudragDesktop.editDoc({ docType: docType, instruction: instruction, authToken: token })
                            .then(function (result) {
                                applyBtn.disabled = false; applyBtn.textContent = 'Apply Edit';
                                noticeEl.style.display = 'block';
                                noticeEl.textContent = result.ok ? (result.message || 'Done.') : ('Error: ' + (result.error || 'Unknown error'));
                                noticeEl.className = 'msg-doc-notice ' + (result.ok ? 'msg-doc-notice-ok' : 'msg-doc-notice-err');
                            });
                    });
                    wrap.appendChild(editCard);
                }
            } catch (e) { console.error('[MUDRAG_EDIT_DOC parse]', e); }
        }

        // Extract bid items from PDF plans (plan sheet intelligence agent)
        var extractBidMatch = text.match(/\[MUDRAG_EXTRACT_BID_ITEMS\]([\s\S]*?)\[\/MUDRAG_EXTRACT_BID_ITEMS\]/);
        if (extractBidMatch) {
            displayText = displayText.replace(/\[MUDRAG_EXTRACT_BID_ITEMS\][\s\S]*?\[\/MUDRAG_EXTRACT_BID_ITEMS\]/, '').trim();
            if (wrap && !wrap._mudragExtractDone) {
                wrap._mudragExtractDone = true;
                // Show a file picker button for PDF selection
                var extractWrap = document.createElement('div');
                extractWrap.className = 'msg-extract-bid-items';
                extractWrap.innerHTML =
                    '<div class="msg-extract-header">Select a PDF from your project to extract bid items:</div>' +
                    '<button class="btn-primary btn-sm msg-extract-btn" id="btn-extract-pdf-' + Date.now() + '">Choose PDF</button>' +
                    '<div class="msg-extract-status" style="display:none"></div>';
                var btn = extractWrap.querySelector('button');
                var statusEl = extractWrap.querySelector('.msg-extract-status');
                btn.addEventListener('click', function () {
                    if (!activeProjectId) { statusEl.textContent = 'Open a project first.'; statusEl.style.display = 'block'; return; }
                    // Get PDFs from current project documents
                    getDocuments(activeProjectId).then(function (docs) {
                        var pdfs = docs.filter(function (d) { return /\.pdf$/i.test(d.name); });
                        if (pdfs.length === 0) { statusEl.textContent = 'No PDFs found in this project. Upload a plans PDF first.'; statusEl.style.display = 'block'; return; }
                        // If single PDF, use it; otherwise show picker
                        var targetPdf = pdfs[0];
                        btn.disabled = true;
                        btn.textContent = 'Extracting bid items…';
                        statusEl.textContent = 'Scanning ' + targetPdf.name + '…';
                        statusEl.style.display = 'block';
                        // Call the extraction API
                        var apiBase = window._mudragApiBase || '';
                        fetch(apiBase + '/run-tool', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ tool: 'extract_bid_items', params: { pdf_path: targetPdf.path || targetPdf.url || targetPdf.name } }),
                        }).then(function (r) { return r.json(); }).then(function (data) {
                            if (data.error) { statusEl.textContent = 'Error: ' + data.error; btn.disabled = false; btn.textContent = 'Try Again'; return; }
                            var items = data.items || [];
                            if (items.length === 0) { statusEl.textContent = 'No bid items found in this PDF.'; btn.disabled = false; btn.textContent = 'Try Again'; return; }
                            persistProjectBidItems(activeProjectId, items, {
                                source: 'pdf_extract',
                                source_doc_id: targetPdf.id || null,
                                source_doc_name: targetPdf.name || '',
                                parsed_rows: items.length,
                                mapped_valid_bid_items: items.length
                            });
                            statusEl.textContent = 'Found ' + items.length + ' bid items:';
                            var table = document.createElement('table');
                            table.className = 'msg-extract-table';
                            table.innerHTML = '<thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Unit</th><th>Spec</th></tr></thead>';
                            var tbody = document.createElement('tbody');
                            items.forEach(function (item, i) {
                                var tr = document.createElement('tr');
                                tr.innerHTML = '<td>' + (i + 1) + '</td><td>' + (item.description || '') + '</td><td>' + (item.quantity || '') + '</td><td>' + (item.unit || '') + '</td><td>' + (item.spec_section || '') + '</td>';
                                tbody.appendChild(tr);
                            });
                            table.appendChild(tbody);
                            extractWrap.appendChild(table);
                            btn.textContent = 'Run Estimate';
                            btn.disabled = false;
                            btn.onclick = function () {
                                if (window.__mudragSend) window.__mudragSend('estimate based on the extracted items');
                            };
                        }).catch(function (err) {
                            statusEl.textContent = 'Extraction failed: ' + err.message;
                            btn.disabled = false;
                            btn.textContent = 'Try Again';
                        });
                    });
                });
                wrap.appendChild(extractWrap);
            }
        }

        // Scan project docs for bid items → generate CSV
        var scanCSVMatch = text.match(/\[MUDRAG_SCAN_FOR_CSV\]([\s\S]*?)\[\/MUDRAG_SCAN_FOR_CSV\]/);
        if (scanCSVMatch && wrap && !wrap._mudragScanDone) {
            wrap._mudragScanDone = true;
            displayText = displayText.replace(/\[MUDRAG_SCAN_FOR_CSV\][\s\S]*?\[\/MUDRAG_SCAN_FOR_CSV\]/, '').trim();
            if (activeProjectId) {
                scanProjectForCSV(activeProjectId, wrap);
            }
        } else if (scanCSVMatch) {
            displayText = displayText.replace(/\[MUDRAG_SCAN_FOR_CSV\][\s\S]*?\[\/MUDRAG_SCAN_FOR_CSV\]/, '').trim();
        }

        // Export to HCSS HeavyBid format
        var exportHCSSMatch = text.match(/\[MUDRAG_EXPORT_HCSS\]([\s\S]*?)\[\/MUDRAG_EXPORT_HCSS\]/);
        if (exportHCSSMatch && wrap && !wrap._mudragHCSSDone) {
            wrap._mudragHCSSDone = true;
            displayText = displayText.replace(/\[MUDRAG_EXPORT_HCSS\][\s\S]*?\[\/MUDRAG_EXPORT_HCSS\]/, '').trim();
            if (activeProjectId) { exportToHCSS(activeProjectId, wrap); }
        } else if (exportHCSSMatch) {
            displayText = displayText.replace(/\[MUDRAG_EXPORT_HCSS\][\s\S]*?\[\/MUDRAG_EXPORT_HCSS\]/, '').trim();
        }

        // Export to Bid2Win format
        var exportBid2WinMatch = text.match(/\[MUDRAG_EXPORT_BID2WIN\]([\s\S]*?)\[\/MUDRAG_EXPORT_BID2WIN\]/);
        if (exportBid2WinMatch && wrap && !wrap._mudragBid2WinDone) {
            wrap._mudragBid2WinDone = true;
            displayText = displayText.replace(/\[MUDRAG_EXPORT_BID2WIN\][\s\S]*?\[\/MUDRAG_EXPORT_BID2WIN\]/, '').trim();
            if (activeProjectId) { exportToBid2Win(activeProjectId, wrap); }
        } else if (exportBid2WinMatch) {
            displayText = displayText.replace(/\[MUDRAG_EXPORT_BID2WIN\][\s\S]*?\[\/MUDRAG_EXPORT_BID2WIN\]/, '').trim();
        }

        // Save document to project (estimating plans, etc.)
        // Use a WeakSet-safe pattern: guard per wrap element to avoid double-saves on re-render
        if (saveDocMatch && wrap && !wrap._mudragDocSaved) {
            wrap._mudragDocSaved = true;
            displayText = displayText.replace(/\[MUDRAG_SAVE_DOC\][\s\S]*?\[\/MUDRAG_SAVE_DOC\]/, '').trim();
            try {
                var saveDocData = JSON.parse(saveDocMatch[1].trim());
                if (saveDocData && saveDocData.name && activeProjectId) {
                    var fileBlob;
                    if (saveDocData.base64) {
                        // Binary file from desktop (CSV, PDF, etc.)
                        var bytes = Uint8Array.from(atob(saveDocData.base64), function (c) { return c.charCodeAt(0); });
                        fileBlob = new Blob([bytes], { type: saveDocData.mime || 'application/octet-stream' });
                    } else if (saveDocData.content) {
                        fileBlob = new Blob([saveDocData.content], { type: saveDocData.type || 'text/markdown' });
                    }
                    if (fileBlob) {
                        var fileToSave = new File([fileBlob], saveDocData.name, { type: fileBlob.type });
                        var targetProjectId = saveDocData.project_id || activeProjectId;
                        var doSave = saveDocData.folder
                            ? getOrCreateFolder(targetProjectId, saveDocData.folder).then(function (fid) { return saveDocument(targetProjectId, fileToSave, fid); })
                            : saveDocument(targetProjectId, fileToSave);
                        doSave.then(function (savedId) {
                            _lastSavedDocId = savedId;
                            _lastCreatedDocId = savedId;
                            renderDocuments();
                            if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
                            showToast('"' + saveDocData.name + '" added to project');
                        }).catch(function () {});
                    }
                }
            } catch (e) { /* ignore */ }
        } else if (saveDocMatch) {
            displayText = displayText.replace(/\[MUDRAG_SAVE_DOC\][\s\S]*?\[\/MUDRAG_SAVE_DOC\]/, '').trim();
        }

        // Create folder (and optionally move last saved doc into it)
        if (createFolderMatch && wrap && !wrap._mudragFolderDone) {
            wrap._mudragFolderDone = true;
            displayText = displayText.replace(/\[MUDRAG_CREATE_FOLDER\][\s\S]*?\[\/MUDRAG_CREATE_FOLDER\]/, '').trim();
            try {
                var cfData = JSON.parse(createFolderMatch[1].trim());
                var folderNames = [];
                if (cfData && typeof cfData.name === 'string' && cfData.name.trim()) folderNames.push(cfData.name.trim());
                if (cfData && typeof cfData.folder === 'string' && cfData.folder.trim()) folderNames.push(cfData.folder.trim());
                if (cfData && typeof cfData.folder_name === 'string' && cfData.folder_name.trim()) folderNames.push(cfData.folder_name.trim());
                if (cfData && Array.isArray(cfData.folders)) {
                    cfData.folders.forEach(function (f) {
                        if (typeof f === 'string' && f.trim()) folderNames.push(f.trim());
                        if (f && typeof f.name === 'string' && f.name.trim()) folderNames.push(f.name.trim());
                    });
                }
                if (cfData && cfData.plan && Array.isArray(cfData.plan.folders)) {
                    cfData.plan.folders.forEach(function (f) {
                        if (typeof f === 'string' && f.trim()) folderNames.push(f.trim());
                        if (f && typeof f.name === 'string' && f.name.trim()) folderNames.push(f.name.trim());
                    });
                }
                folderNames = folderNames.filter(function (name, idx, arr) {
                    var norm = (name || '').toLowerCase();
                    return norm && arr.findIndex(function (n) { return (n || '').toLowerCase() === norm; }) === idx;
                });
                if (folderNames.length === 0) folderNames = ['New Folder'];
                var moveLast = cfData && cfData.move_last;
                if (activeProjectId) {
                    Promise.all(folderNames.map(function (name) { return getOrCreateFolder(activeProjectId, name); })).then(function (folderIds) {
                        var primaryFolderId = folderIds[0];
                        if (moveLast && _lastSavedDocId) {
                            moveDocToFolder(_lastSavedDocId, primaryFolderId).then(function () {
                                renderDocuments();
                                showToast('Created ' + folderNames.length + ' folder' + (folderNames.length !== 1 ? 's' : '') + ' and moved document into "' + folderNames[0] + '"');
                            }).catch(function () {
                                renderDocuments();
                                showToast('Created ' + folderNames.length + ' folder' + (folderNames.length !== 1 ? 's' : ''));
                            });
                        } else {
                            renderDocuments();
                            showToast('Created ' + folderNames.length + ' folder' + (folderNames.length !== 1 ? 's' : '') + ': ' + folderNames.join(', '));
                        }
                    }).catch(function () {});
                }
            } catch (e) { /* ignore */ }
        } else if (createFolderMatch) {
            displayText = displayText.replace(/\[MUDRAG_CREATE_FOLDER\][\s\S]*?\[\/MUDRAG_CREATE_FOLDER\]/, '').trim();
        }

        // Auto folder structure (preview/apply smart organization)
        if (autoFolderMatch && wrap && !wrap._mudragAutoFolderDone) {
            wrap._mudragAutoFolderDone = true;
            displayText = displayText.replace(/\[MUDRAG_AUTO_FOLDER\][\s\S]*?\[\/MUDRAG_AUTO_FOLDER\]/, '').trim();
            try {
                var autoData = JSON.parse(autoFolderMatch[1].trim());
                if (activeProjectId) {
                    if (autoData && autoData.mode === 'apply') {
                        applyAutoFolderStructure(activeProjectId, wrap);
                    } else {
                        previewAutoFolderStructure(activeProjectId, wrap);
                    }
                }
            } catch (e) { /* ignore */ }
        } else if (autoFolderMatch) {
            displayText = displayText.replace(/\[MUDRAG_AUTO_FOLDER\][\s\S]*?\[\/MUDRAG_AUTO_FOLDER\]/, '').trim();
        }

        var scheduleData = null;
        var proposalData = null;
        var resumeData = null;
        var createProjectData = null;
        var chooseEmailData = null;
        var emailResultsData = null;
        var workResultsData = null;
        var bidDocData = null;
        var actionsData = null;
        var citationsData = null;
        if (actionsMatch) {
            displayText = displayText.replace(/\[MUDRAG_ACTIONS\][\s\S]*?\[\/MUDRAG_ACTIONS\]/, '').trim();
            try { actionsData = JSON.parse(actionsMatch[1].trim()); } catch (e) { /* ignore */ }
        }
        if (citationsMatch) {
            displayText = displayText.replace(/\[MUDRAG_CITATIONS\][\s\S]*?\[\/MUDRAG_CITATIONS\]/, '').trim();
            try { citationsData = JSON.parse(citationsMatch[1].trim()); } catch (e) { /* ignore */ }
        }
        if (bidDocMatch) {
            displayText = displayText.replace(/\[MUDRAG_BID_DOC\][\s\S]*?\[\/MUDRAG_BID_DOC\]/, '').trim();
            try {
                bidDocData = JSON.parse(bidDocMatch[1].trim());
            } catch (e) { /* ignore */ }
        }
        if (emailResultsMatch) {
            displayText = displayText.replace(/\[MUDRAG_EMAIL_RESULTS\][\s\S]*?\[\/MUDRAG_EMAIL_RESULTS\]/, '').trim();
            try {
                emailResultsData = JSON.parse(emailResultsMatch[1].trim());
            } catch (e) { /* ignore */ }
        }
        if (workResultsMatch) {
            displayText = displayText.replace(/\[MUDRAG_WORK_RESULTS\][\s\S]*?\[\/MUDRAG_WORK_RESULTS\]/, '').trim();
            try {
                workResultsData = JSON.parse(workResultsMatch[1].trim());
            } catch (e) { /* ignore */ }
        }
        var fileResultsData = null;
        if (fileResultsMatch) {
            displayText = displayText.replace(/\[MUDRAG_FILE_RESULTS\][\s\S]*?\[\/MUDRAG_FILE_RESULTS\]/, '').trim();
            try {
                fileResultsData = JSON.parse(fileResultsMatch[1].trim());
            } catch (e) { /* ignore */ }
        }
        if (chooseEmailMatch) {
            displayText = displayText.replace(/\[MUDRAG_CHOOSE_EMAIL_ACCOUNT\][\s\S]*?\[\/MUDRAG_CHOOSE_EMAIL_ACCOUNT\]/, '').trim();
            try {
                chooseEmailData = JSON.parse(chooseEmailMatch[1].trim());
            } catch (e) { /* ignore */ }
        }
        if (scheduleMatch) {
            displayText = displayText.replace(/\[MUDRAG_SCHEDULE\][\s\S]*?\[\/MUDRAG_SCHEDULE\]/, '').trim();
            try {
                scheduleData = JSON.parse(scheduleMatch[1].trim());
            } catch (e) { /* ignore */ }
        }
        if (proposalMatch) {
            displayText = displayText.replace(/\[MUDRAG_PROPOSAL\][\s\S]*?\[\/MUDRAG_PROPOSAL\]/, '').trim();
            try {
                proposalData = JSON.parse(proposalMatch[1].trim());
            } catch (e) { /* ignore */ }
        }
        if (resumeMatch) {
            displayText = displayText.replace(/\[MUDRAG_RESUME\][\s\S]*?\[\/MUDRAG_RESUME\]/, '').trim();
            try {
                resumeData = JSON.parse(resumeMatch[1].trim());
            } catch (e) { /* ignore */ }
        }
        if (createProjectMatch) {
            displayText = displayText.replace(/\[MUDRAG_CREATE_PROJECT\][\s\S]*?\[\/MUDRAG_CREATE_PROJECT\]/, '').trim();
            try {
                createProjectData = JSON.parse(createProjectMatch[1].trim());
            } catch (e) { /* ignore */ }
        }
        displayText = sanitizeResponse(displayText);
        var lines = displayText.split(/\n/);
        var bulletLines = lines.filter(function (line) {
            return /^[\s]*[-•]\s+/.test(line) || /^[\s]*\*\s+/.test(line);
        });
        if (bulletLines.length > 0) {
            var firstBulletIdx = lines.indexOf(bulletLines[0]);
            var lastBulletIdx = lines.indexOf(bulletLines[bulletLines.length - 1]);
            var intro = lines.slice(0, firstBulletIdx).join('\n').trim();
            var outro = lines.slice(lastBulletIdx + 1).join('\n').trim();
            if (intro) {
                var pIntro = document.createElement('p');
                pIntro.textContent = intro;
                wrap.appendChild(pIntro);
            }
            var ul = document.createElement('ul');
            ul.className = 'msg-bullet-list';
            bulletLines.forEach(function (line) {
                var li = document.createElement('li');
                li.textContent = line.replace(/^[\s]*[-•*]\s+/, '').trim();
                ul.appendChild(li);
            });
            wrap.appendChild(ul);
            if (outro) {
                var pOutro = document.createElement('p');
                pOutro.textContent = outro;
                wrap.appendChild(pOutro);
            }
        } else if (displayText || !chooseEmailData) {
            var p = document.createElement('p');
            p.textContent = displayText;
            wrap.appendChild(p);
        }
        if (citationsData && citationsData.sources && Array.isArray(citationsData.sources) && citationsData.sources.length > 0) {
            var sourcesWrap = document.createElement('div');
            sourcesWrap.className = 'msg-inline-sources';

            var label = document.createElement('span');
            label.className = 'msg-inline-sources-label';
            label.textContent = 'Sources:';
            sourcesWrap.appendChild(label);

            var visibleSources = citationsData.sources.slice(0, 3);
            visibleSources.forEach(function (source, i) {
                var title = String(source.title || source.source || source.id || ('Source ' + (i + 1))).trim();
                var link = document.createElement('a');
                link.className = 'msg-inline-source-link';
                link.textContent = title.length > 56 ? (title.slice(0, 53) + '...') : title;

                var url = typeof source.url === 'string' ? source.url.trim() : '';
                if (/^https?:\/\//i.test(url)) {
                    link.href = url;
                    link.target = '_blank';
                    link.rel = 'noopener';
                } else {
                    link.href = '#';
                    link.addEventListener('click', function (e) {
                        e.preventDefault();
                        doSend('Show the exact source passage for: "' + title + '"');
                    });
                }
                sourcesWrap.appendChild(link);
            });

            if (citationsData.sources.length > visibleSources.length) {
                var moreLink = document.createElement('a');
                moreLink.href = '#';
                moreLink.className = 'msg-inline-source-link msg-inline-source-link-more';
                moreLink.textContent = '+' + (citationsData.sources.length - visibleSources.length) + ' more';
                moreLink.addEventListener('click', function (e) {
                    e.preventDefault();
                    doSend('List all grounded sources you used for your previous answer.');
                });
                sourcesWrap.appendChild(moreLink);
            }

            wrap.appendChild(sourcesWrap);
        }
        if (chooseEmailData && chooseEmailData.accounts && Array.isArray(chooseEmailData.accounts) && chooseEmailData.text) {
            var chooseWrap = document.createElement('div');
            chooseWrap.className = 'msg-choose-email';
            var chooseP = document.createElement('p');
            chooseP.textContent = chooseEmailData.message || 'Which account do you want to send from?';
            chooseWrap.appendChild(chooseP);
            var btnRow = document.createElement('div');
            btnRow.className = 'msg-choose-email-buttons';
            chooseEmailData.accounts.forEach(function (acct) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn-secondary btn-sm msg-choose-email-btn';
                btn.textContent = acct.name + ' (' + acct.email + ')';
                btn.addEventListener('click', function () {
                    if (window.__mudragRunTool) {
                        window.__mudragRunTool('send_email', { text: chooseEmailData.text, from_account: acct.email }, null);
                    } else {
                        addMessage('assistant', 'Desktop mail tools are not available in this browser session. Open openmud desktop app to send through Apple Mail.');
                        renderMessages();
                        scrollToLatest();
                    }
                });
                btnRow.appendChild(btn);
            });
            chooseWrap.appendChild(btnRow);
            wrap.appendChild(chooseWrap);
        }
        if (actionsData && Array.isArray(actionsData) && actionsData.length > 0) {
            var actionsWrap = document.createElement('div');
            actionsWrap.className = 'msg-suggested-actions';
            actionsData.forEach(function (action) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'msg-action-pill';
                btn.textContent = action.label || action.text || action;
                btn.addEventListener('click', function () {
                    if (action.url) {
                        // URL action: navigate to a tool page or external link
                        var isExternal = /^https?:\/\//i.test(action.url);
                        if (isExternal) {
                            if (window.mudragDesktop && window.mudragDesktop.openExternal) {
                                window.mudragDesktop.openExternal(action.url);
                            } else {
                                window.open(action.url, '_blank', 'noopener');
                            }
                        } else {
                            // Internal page — navigate in the same tool port context
                            var toolPortParam = toolPort ? '?toolPort=' + toolPort : '';
                            window.location.href = action.url + (action.url.includes('?') ? '&' : '?') + 'toolPort=' + (toolPort || '');
                        }
                    } else {
                        var sendText = action.text || action.label || action;
                        // Handle special internal commands
                        if (sendText === '__find_duplicates__') {
                            findAndShowDuplicates();
                        } else if (sendText === '__clean_duplicates__') {
                            findAndShowDuplicates();
                        } else if (sendText === '__undo_duplicate_delete__') {
                            undoDuplicateDeletionBatch();
                        } else if (sendText === '__new_folder__') {
                            var btnNewFolderEl = document.getElementById('btn-new-folder');
                            if (btnNewFolderEl) btnNewFolderEl.click();
                        } else if (sendText === '__open_last_csv__') {
                            if (_lastCreatedCSVDocId && activeProjectId) {
                                getDocuments(activeProjectId).then(function (docs) {
                                    var d = docs.find(function (x) { return x.id === _lastCreatedCSVDocId; });
                                    if (d && window.mudrag && window.mudrag.openDocument) window.mudrag.openDocument(d);
                                });
                            }
                        } else if (window.__mudragSend) {
                            window.__mudragSend(sendText);
                        }
                    }
                });
                actionsWrap.appendChild(btn);
            });
            wrap.appendChild(actionsWrap);
        }
        if (emailResultsData && emailResultsData.emails && Array.isArray(emailResultsData.emails)) {
            var emailWrap = document.createElement('div');
            emailWrap.className = 'msg-email-results';
            var projectEmailMode = emailResultsData.mode === 'project_doc_import';
            var canImportEmailDocs = !!(window.mudragDesktop && window.mudragDesktop.importMailAttachments);
            // Header row showing count
            var emailHeader = document.createElement('div');
            emailHeader.style.cssText = 'padding:6px 10px;font-size:0.72rem;color:var(--text-secondary);border-bottom:1px solid var(--border,#2a2a2a);display:flex;justify-content:space-between;align-items:center;';
            emailHeader.innerHTML = '<span>' + emailResultsData.emails.length + ' email' + (emailResultsData.emails.length !== 1 ? 's' : '') + ' found</span>';
            emailWrap.appendChild(emailHeader);

            if (projectEmailMode && canImportEmailDocs) {
                var importPanel = document.createElement('div');
                importPanel.className = 'msg-email-import-panel';
                var importHint = document.createElement('div');
                importHint.className = 'msg-email-import-hint';
                importHint.textContent = 'Project mode: extract attachments from matching emails and import them into this project.';
                var importTopBtn = document.createElement('button');
                importTopBtn.type = 'button';
                importTopBtn.className = 'btn-primary btn-sm msg-email-import-top-btn';
                importTopBtn.textContent = 'Import top relevant docs';
                var importTopStatus = document.createElement('div');
                importTopStatus.className = 'msg-email-import-top-status';
                importTopBtn.addEventListener('click', function () {
                    if (!activeProjectId) {
                        importTopStatus.textContent = 'Open a project first, then import.';
                        return;
                    }
                    importTopBtn.disabled = true;
                    importTopBtn.textContent = 'Importing…';
                    importTopStatus.textContent = '';
                    var preferred = emailResultsData.emails.filter(function (e) { return e.relevant_document; });
                    var selected = (preferred.length ? preferred : emailResultsData.emails).slice(0, 5);
                    importMultipleEmailAttachments(selected, { maxEmails: selected.length }).then(function (summary) {
                        if (!summary || !summary.ok || !summary.imported_count) {
                            importTopStatus.textContent = 'No documents imported.';
                            return;
                        }
                        var msg = 'Imported ' + (summary.imported_count || 0) + ' document' + ((summary.imported_count || 0) === 1 ? '' : 's');
                        if (summary.extracted_bid_items) msg += ' and extracted ' + summary.extracted_bid_items + ' bid item' + (summary.extracted_bid_items === 1 ? '' : 's');
                        if (summary.folders_used && summary.folders_used.length) msg += ' into ' + summary.folders_used.join(', ');
                        if (summary.suggested_actions && summary.suggested_actions.length) {
                            msg += '. Suggested next: ' + summary.suggested_actions.slice(0, 2).map(function (s) { return s.label; }).join(' • ');
                        }
                        importTopStatus.textContent = msg + '.';
                        showToast(msg);
                    }).catch(function (err) {
                        importTopStatus.textContent = 'Import failed: ' + (err.message || 'Unknown error');
                    }).then(function () {
                        importTopBtn.disabled = false;
                        importTopBtn.textContent = 'Import top relevant docs';
                    });
                });
                importPanel.appendChild(importHint);
                importPanel.appendChild(importTopBtn);
                importPanel.appendChild(importTopStatus);
                emailWrap.appendChild(importPanel);
            }
            // "Open in Mail" button in header for non-project mode
            if (!projectEmailMode && emailResultsData.emails.length > 0) {
                emailHeader.innerHTML += '<span style="font-size:0.7rem;opacity:0.5;">↑ scroll to see all</span>';
            }

            // Scrollable list container
            var emailList = document.createElement('div');
            emailList.className = 'msg-email-results-list';

            emailResultsData.emails.forEach(function (em) {
                var row = document.createElement('div');
                var isUnread = em.read === false;
                row.className = 'msg-email-result-row' + (isUnread ? ' msg-email-unread' : '');

                // Compact info: sender | subject | date (grid layout via CSS)
                var info = document.createElement('div');
                info.className = 'msg-email-result-info';

                // Date formatting: show time if today, date otherwise
                var dateStr = em.date || '';
                try {
                    var d = new Date(em.date);
                    var now = new Date();
                    var isToday = d.toDateString() === now.toDateString();
                    dateStr = isToday
                        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                } catch (_) {}

                // Unread dot indicator
                var unreadDot = isUnread ? '<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--accent,#e8d5b7);margin-right:4px;flex-shrink:0;vertical-align:middle;"></span>' : '';
                info.innerHTML =
                    '<strong class="msg-email-sender">' + unreadDot + (em.sender || em.sender_address || 'Unknown').slice(0, 28) + '</strong>' +
                    '<span class="msg-email-result-subject">' + (em.subject || '(no subject)').slice(0, 60) + '</span>' +
                    '<span class="msg-email-result-date">' + dateStr + '</span>';

                var importStatus = document.createElement('div');
                importStatus.className = 'msg-email-import-status';
                info.appendChild(importStatus);

                // Right: icon-only action buttons
                var actionWrap = document.createElement('div');
                actionWrap.className = 'msg-email-result-actions';

                // Open in Mail — envelope icon
                var openSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2 4 12 14 22 4"/></svg>';
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'msg-email-icon-btn';
                btn.title = 'Open in Mail';
                btn.innerHTML = openSvg;
                btn.addEventListener('click', (function (emailData) {
                    return function () {
                        if (window.mudragDesktop && window.mudragDesktop.openMail) {
                            window.mudragDesktop.openMail({
                                sender: emailData.sender || emailData.sender_address,
                                subject: emailData.subject,
                                index: emailData.index
                            }).catch(function () {});
                        }
                    };
                })(em));
                actionWrap.appendChild(btn);

                if (canImportEmailDocs) {
                    // Import docs — download icon
                    var importSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
                    var importBtn = document.createElement('button');
                    importBtn.type = 'button';
                    importBtn.className = 'msg-email-icon-btn msg-email-icon-btn--import';
                    importBtn.title = 'Import attachments into project';
                    importBtn.innerHTML = importSvg;
                    importBtn.addEventListener('click', (function (emailData) {
                        return function () {
                            if (!activeProjectId) { importStatus.textContent = 'Open a project first.'; return; }
                            importBtn.disabled = true;
                            importBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
                            importStatus.textContent = '';
                            importEmailAttachmentsToProject(emailData, {}).then(function (summary) {
                                if (!summary || !summary.ok) {
                                    importStatus.textContent = (summary && summary.error) ? summary.error : 'No attachments.';
                                    return;
                                }
                                if (!summary.imported_count) {
                                    importStatus.textContent = 'No attachments.';
                                    return;
                                }
                                importBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
                                var line = summary.imported_count + ' doc' + (summary.imported_count === 1 ? '' : 's') + ' saved';
                                if (summary.folders_used && summary.folders_used.length) line += ' → ' + summary.folders_used[0];
                                if (summary.suggested_actions && summary.suggested_actions.length) {
                                    line += ' · Next: ' + summary.suggested_actions[0].label;
                                }
                                importStatus.textContent = line;
                                showToast(line);
                                return;
                            }).catch(function (err) {
                                importStatus.textContent = 'Failed.';
                            }).then(function () {
                                if (importBtn.disabled) {
                                    setTimeout(function () {
                                        importBtn.disabled = false;
                                        importBtn.innerHTML = importSvg;
                                    }, 2000);
                                }
                            });
                        };
                    })(em));
                    actionWrap.appendChild(importBtn);
                }

                row.appendChild(info);
                row.appendChild(actionWrap);
                emailList.appendChild(row);
            });
            emailWrap.appendChild(emailList);
            wrap.appendChild(emailWrap);
        }
        if (workResultsData) {
            var workCard = document.createElement('div');
            workCard.className = 'msg-work-card';

            var tradeLabel = workResultsData.trade ? workResultsData.trade.charAt(0).toUpperCase() + workResultsData.trade.slice(1) : 'Construction';
            var header = document.createElement('div');
            header.className = 'msg-work-header';
            header.innerHTML = '<span class="msg-work-title">Work Finder — ' + tradeLabel + '</span>';
            workCard.appendChild(header);

            // Tabs
            var tabBar = document.createElement('div');
            tabBar.className = 'msg-work-tabs';
            var emailBids = workResultsData.email_bids || [];
            var webBids = workResultsData.web_bids || [];
            var allBids = webBids;
            var fedBids = webBids.filter(function (b) { return b.source_type === 'federal'; });
            var stateBids = webBids.filter(function (b) { return b.source_type === 'state'; });

            var tabs = [
                { key: 'email', label: 'Email (' + emailBids.length + ')', items: emailBids },
                { key: 'federal', label: 'Federal — SAM.gov (' + fedBids.length + ')', items: fedBids },
                { key: 'state', label: 'State — Utah (' + stateBids.length + ')', items: stateBids },
            ];

            var panels = [];
            tabs.forEach(function (tab, idx) {
                var tabBtn = document.createElement('button');
                tabBtn.type = 'button';
                tabBtn.className = 'msg-work-tab' + (idx === 0 ? ' active' : '');
                tabBtn.textContent = tab.label;
                tabBtn.setAttribute('data-tab', tab.key);
                tabBar.appendChild(tabBtn);

                var panel = document.createElement('div');
                panel.className = 'msg-work-panel' + (idx === 0 ? ' active' : '');
                panel.setAttribute('data-panel', tab.key);

                if (tab.items.length === 0) {
                    var empty = document.createElement('p');
                    empty.className = 'msg-work-empty';
                    empty.textContent = idx === 0
                        ? 'No bid emails found. Make sure Mail.app has your accounts set up.'
                        : 'No public bids found for this trade right now.';
                    panel.appendChild(empty);
                } else {
                    tab.items.forEach(function (item) {
                        var row = document.createElement('div');
                        row.className = 'msg-work-result-row';

                        var info = document.createElement('div');
                        info.className = 'msg-work-result-info';

                        if (tab.key === 'email') {
                            var isBid = item.is_bid;
                            info.innerHTML =
                                (isBid ? '<span class="msg-work-badge">BID</span> ' : '') +
                                '<strong>' + (item.subject || 'No subject').slice(0, 70) + (item.subject && item.subject.length > 70 ? '…' : '') + '</strong>' +
                                '<br><span class="msg-work-meta">' + (item.sender || item.sender_address || 'Unknown') + ' &middot; ' + (item.date || '') + '</span>';
                        } else {
                            var dueLine = item.due_date ? ' &middot; Due ' + item.due_date : '';
                            info.innerHTML =
                                '<strong>' + (item.title || 'Untitled').slice(0, 80) + (item.title && item.title.length > 80 ? '…' : '') + '</strong>' +
                                '<br><span class="msg-work-meta">' + (item.agency || '') + ' &middot; ' + (item.location || '') + dueLine + '</span>';
                        }

                        var btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'btn-secondary btn-sm msg-work-action-btn';

                        if (tab.key === 'email') {
                            btn.textContent = 'Open in Mail';
                            btn.addEventListener('click', (function (em) {
                                return function () {
                                    if (window.mudragDesktop && window.mudragDesktop.openMail) {
                                        window.mudragDesktop.openMail({ sender: em.sender || em.sender_address, subject: em.subject, index: em.index });
                                    }
                                };
                            })(item));
                        } else {
                            btn.textContent = 'View Bid';
                            btn.addEventListener('click', (function (url) {
                                return function () {
                                    if (window.mudragDesktop && window.mudragDesktop.openExternal) {
                                        window.mudragDesktop.openExternal(url);
                                    } else {
                                        window.open(url, '_blank', 'noopener');
                                    }
                                };
                            })(item.url));
                        }

                        row.appendChild(info);
                        row.appendChild(btn);
                        panel.appendChild(row);
                    });
                }

                panels.push(panel);
            });

            workCard.appendChild(tabBar);
            tabs.forEach(function (_, idx) { workCard.appendChild(panels[idx]); });

            // Tab switching
            tabBar.addEventListener('click', function (e) {
                var btn = e.target.closest('.msg-work-tab');
                if (!btn) return;
                var key = btn.getAttribute('data-tab');
                tabBar.querySelectorAll('.msg-work-tab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === key); });
                workCard.querySelectorAll('.msg-work-panel').forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-panel') === key); });
            });

            // Footer note
            var footer = document.createElement('div');
            footer.className = 'msg-work-footer';
            footer.innerHTML = 'Sources: Mac Mail.app · SAM.gov (federal) · Utah Division of Purchasing &nbsp;·&nbsp; <a href="https://sam.gov" target="_blank" rel="noopener">sam.gov</a>';
            workCard.appendChild(footer);

            wrap.appendChild(workCard);
        }
        // ── Local file results ────────────────────────────────────────────────
        if (fileResultsData && Array.isArray(fileResultsData.files) && fileResultsData.files.length > 0) {
            var canImportLocal = !!(window.mudragDesktop && window.mudragDesktop.readLocalFile);
            var fileCard = document.createElement('div');
            fileCard.className = 'msg-file-results';

            var highRelevant = fileResultsData.files.filter(function (f) { return f.score >= 10; });

            // "Import all relevant" panel
            if (canImportLocal && highRelevant.length > 0) {
                var importPanel = document.createElement('div');
                importPanel.className = 'msg-email-import-panel';
                var importHint = document.createElement('div');
                importHint.className = 'msg-email-import-hint';
                importHint.textContent = highRelevant.length + ' highly relevant file' + (highRelevant.length !== 1 ? 's' : '') + ' found — import them all at once.';
                var importTopBtn = document.createElement('button');
                importTopBtn.type = 'button';
                importTopBtn.className = 'btn-primary btn-sm msg-email-import-top-btn';
                importTopBtn.textContent = 'Import ' + highRelevant.length + ' relevant file' + (highRelevant.length !== 1 ? 's' : '');
                var importTopStatus = document.createElement('div');
                importTopStatus.className = 'msg-email-import-top-status';

                importTopBtn.addEventListener('click', function () {
                    if (!activeProjectId) { importTopStatus.textContent = 'Open a project first.'; return; }
                    importTopBtn.disabled = true;
                    importTopBtn.textContent = 'Importing…';
                    importTopStatus.textContent = '';
                    importLocalFiles(highRelevant).then(function (summary) {
                        importTopBtn.textContent = 'Imported ' + summary.count + ' file' + (summary.count !== 1 ? 's' : '');
                        importTopStatus.textContent = summary.folders.length ? '→ ' + summary.folders.join(', ') : '';
                        showToast('Imported ' + summary.count + ' file' + (summary.count !== 1 ? 's' : ''));
                    }).catch(function (err) {
                        importTopBtn.disabled = false;
                        importTopBtn.textContent = 'Retry';
                        importTopStatus.textContent = err.message || 'Import failed.';
                    });
                });
                importPanel.appendChild(importHint);
                importPanel.appendChild(importTopBtn);
                importPanel.appendChild(importTopStatus);
                fileCard.appendChild(importPanel);
            }

            // Individual file rows
            fileResultsData.files.forEach(function (file) {
                var row = document.createElement('div');
                row.className = 'msg-file-result-row' + (file.score >= 10 ? ' msg-file-result-row--relevant' : '');

                var extIcon = getFileIcon(file.ext || '');
                var info = document.createElement('div');
                info.className = 'msg-file-result-info';
                info.innerHTML =
                    '<span class="msg-file-ext-icon">' + extIcon + '</span>' +
                    '<strong class="msg-file-result-name">' + file.name.slice(0, 60) + (file.name.length > 60 ? '…' : '') + '</strong>' +
                    '<div class="msg-file-result-meta">' + file.sizeFormatted + ' &middot; ' + (file.displayPath || '').slice(0, 60) + '</div>';

                var actions = document.createElement('div');
                actions.className = 'msg-email-result-actions';

                if (canImportLocal) {
                    var importBtn = document.createElement('button');
                    importBtn.type = 'button';
                    importBtn.className = 'btn-secondary btn-sm msg-email-import-btn';
                    importBtn.textContent = 'Import';
                    var importStatus = document.createElement('div');
                    importStatus.className = 'msg-email-import-status';
                    importBtn.addEventListener('click', (function (f) {
                        return function () {
                            if (!activeProjectId) { importStatus.textContent = 'Open a project first.'; return; }
                            importBtn.disabled = true;
                            importBtn.textContent = 'Importing…';
                            importLocalFiles([f]).then(function (summary) {
                                importBtn.textContent = 'Imported';
                                importStatus.textContent = summary.folders.length ? '→ ' + summary.folders[0] : '';
                                showToast(f.name + ' imported.');
                            }).catch(function (err) {
                                importBtn.disabled = false;
                                importBtn.textContent = 'Retry';
                                importStatus.textContent = err.message || 'Failed.';
                            });
                        };
                    })(file));
                    actions.appendChild(importBtn);
                    actions.appendChild(importStatus);
                }

                row.appendChild(info);
                row.appendChild(actions);
                fileCard.appendChild(row);
            });

            wrap.appendChild(fileCard);
        }

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
            var propDocWrap = document.createElement('div');
            propDocWrap.className = 'msg-proposal-doc';

            // Build the paper document inline (no API call needed)
            (function () {
                var fmtMoney = function (n) { return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
                var client = proposalData.client || 'Project';
                var today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

                // Pull saved company settings if any
                var companySettings = {};
                try { var _s = JSON.parse(localStorage.getItem('mudragProposalGenerator') || '{}'); companySettings = _s.companyInfo || {}; } catch (_) {}

                var paper = document.createElement('div');
                paper.className = 'proposal-paper';

                // ── Header ──────────────────────────────────────────────
                var hdr = document.createElement('div');
                hdr.className = 'proposal-paper-header';
                var hdrLeft = document.createElement('div');
                var hTitle = document.createElement('div');
                hTitle.className = 'proposal-paper-title';
                hTitle.textContent = 'PROPOSAL';
                var hFor = document.createElement('div');
                hFor.className = 'proposal-paper-for';
                hFor.innerHTML = 'Prepared for: <strong>' + client + '</strong>';
                var hMeta = document.createElement('div');
                hMeta.className = 'proposal-paper-meta';
                hMeta.textContent = 'Date: ' + today + (proposalData.duration ? '  ·  Est. Duration: ' + proposalData.duration : '');
                hdrLeft.appendChild(hTitle);
                hdrLeft.appendChild(hFor);
                hdrLeft.appendChild(hMeta);
                hdr.appendChild(hdrLeft);
                paper.appendChild(hdr);

                // Helper to create a section
                function addSection(label, bodyEl) {
                    var sec = document.createElement('div');
                    sec.className = 'proposal-section';
                    var titleBar = document.createElement('div');
                    titleBar.className = 'proposal-section-title';
                    titleBar.textContent = label;
                    sec.appendChild(titleBar);
                    sec.appendChild(bodyEl);
                    paper.appendChild(sec);
                }

                // Helper to create a bullet list body
                function bulletBody(items) {
                    var body = document.createElement('div');
                    body.className = 'proposal-section-body';
                    var ul = document.createElement('ul');
                    items.forEach(function (item) { var li = document.createElement('li'); li.textContent = item; ul.appendChild(li); });
                    body.appendChild(ul);
                    return body;
                }

                // ── Scope ────────────────────────────────────────────────
                if (proposalData.scope) {
                    var scopeBody = document.createElement('div');
                    scopeBody.className = 'proposal-section-body';
                    var scopeP = document.createElement('p');
                    scopeP.textContent = proposalData.scope;
                    scopeBody.appendChild(scopeP);
                    addSection('Scope of Work', scopeBody);
                }

                // ── Pricing ──────────────────────────────────────────────
                var bidItems = proposalData.bid_items || [];
                var pricingBody = document.createElement('div');
                pricingBody.className = 'proposal-section-body';
                var tbl = document.createElement('table');
                tbl.className = 'proposal-table';
                if (bidItems.length > 0) {
                    var thead = tbl.createTHead();
                    var hr = thead.insertRow();
                    ['#', 'Description', 'Qty', 'Unit', 'Unit Price', 'Total'].forEach(function (h) {
                        var th = document.createElement('th'); th.textContent = h; hr.appendChild(th);
                    });
                    var tbody = tbl.createTBody();
                    bidItems.forEach(function (item, idx) {
                        var tr = tbody.insertRow();
                        [idx + 1, item.description || '', item.qty != null ? item.qty : '', item.unit || '',
                            item.unit_price != null ? fmtMoney(item.unit_price) : '',
                            item.amount != null ? fmtMoney(item.amount) : ''].forEach(function (val) {
                            var td = tr.insertCell(); td.textContent = val;
                        });
                    });
                    if (proposalData.total) {
                        var totRow = tbody.insertRow();
                        totRow.className = 'proposal-total-row';
                        ['', '', '', '', 'TOTAL', fmtMoney(proposalData.total)].forEach(function (val) {
                            var td = totRow.insertCell(); td.textContent = val;
                        });
                    }
                } else if (proposalData.total) {
                    var thead2 = tbl.createTHead();
                    var hr2 = thead2.insertRow();
                    ['Description', 'Total'].forEach(function (h) { var th = document.createElement('th'); th.textContent = h; hr2.appendChild(th); });
                    var tbody2 = tbl.createTBody();
                    var totOnly = tbody2.insertRow();
                    totOnly.className = 'proposal-total-row';
                    ['Project Total', fmtMoney(proposalData.total)].forEach(function (v) { var td = totOnly.insertCell(); td.textContent = v; });
                }
                pricingBody.appendChild(tbl);
                addSection('Pricing', pricingBody);

                // ── Inclusions ───────────────────────────────────────────
                addSection('Inclusions', bulletBody([
                    'All materials and labor required to complete the described scope',
                    'Permits and inspections as required by jurisdiction',
                    'Site cleanup and debris removal upon completion',
                    'Manufacturer-standard warranties on all installed materials',
                    'Project coordination and scheduling',
                    'Safety equipment and compliance with OSHA standards',
                ]));

                // ── Exclusions ───────────────────────────────────────────
                addSection('Exclusions', bulletBody([
                    'Work not specifically listed in this proposal',
                    'Engineering, design, or architectural services unless noted',
                    'Unforeseen site conditions or hazardous materials',
                    'Patch and paint beyond directly disturbed areas unless noted',
                    'Weekend or overtime work unless separately agreed upon',
                    'Temporary facilities or utilities unless specified',
                ]));

                // ── Assumptions ──────────────────────────────────────────
                addSection('Assumptions & Clarifications', bulletBody([
                    'Pricing is based on normal working hours (7 AM – 5 PM, Mon–Fri)',
                    'Site is accessible and clear for equipment and materials',
                    'Existing utilities are correctly marked prior to excavation',
                    'Owner is responsible for any required easements or right-of-way',
                    'Price is valid for 30 days from the date of this proposal',
                ]));

                // ── Footer ───────────────────────────────────────────────
                var footerDiv = document.createElement('div');
                footerDiv.className = 'proposal-footer';
                var footerBox = document.createElement('div');
                footerBox.className = 'proposal-footer-box';
                var fName = document.createElement('div');
                fName.className = 'proposal-footer-name';
                fName.textContent = companySettings.company || 'openmud';
                footerBox.appendChild(fName);
                if (companySettings.phone || companySettings.email) {
                    var fContact = document.createElement('div');
                    fContact.className = 'proposal-footer-contact';
                    fContact.textContent = [companySettings.phone, companySettings.email].filter(Boolean).join(' · ');
                    footerBox.appendChild(fContact);
                }
                footerDiv.appendChild(footerBox);
                paper.appendChild(footerDiv);

                propDocWrap.appendChild(paper);

                // ── Action buttons ───────────────────────────────────────
                var btnWrap = document.createElement('div');
                btnWrap.className = 'msg-schedule-actions';

                // Download PDF
                var pdfBtn = document.createElement('button');
                pdfBtn.type = 'button';
                pdfBtn.className = 'btn-primary btn-sm';
                pdfBtn.textContent = 'Download PDF';
                pdfBtn.addEventListener('click', function () {
                    var clone = paper.cloneNode(true);
                    clone.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
                    document.body.appendChild(clone);
                    var filename = 'Proposal-' + client.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-').slice(0, 40) + '-' + new Date().toISOString().slice(0, 10) + '.pdf';
                    if (typeof html2pdf !== 'undefined') {
                        html2pdf().set({ filename: filename, margin: [10, 10, 10, 10], html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(clone).save().then(function () { document.body.removeChild(clone); });
                    } else {
                        var w = window.open('', '_blank');
                        if (w) { w.document.write('<html><head><title>Proposal</title><style>body{margin:0;font-family:Inter,sans-serif}</style></head><body>' + clone.outerHTML + '</body></html>'); w.document.close(); }
                        document.body.removeChild(clone);
                    }
                });

                // Add to project
                var addToProjectBtn = document.createElement('button');
                addToProjectBtn.type = 'button';
                addToProjectBtn.className = 'btn-text btn-sm';
                addToProjectBtn.textContent = 'Add to project';
                addToProjectBtn.addEventListener('click', function () {
                    if (!activeProjectId) { addMessage('assistant', 'Select a project first, then click Add to project.'); return; }
                    addToProjectBtn.disabled = true;
                    addToProjectBtn.textContent = 'Adding…';
                    var clone = paper.cloneNode(true);
                    clone.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
                    document.body.appendChild(clone);
                    var filename = 'Proposal-' + client.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '-').slice(0, 40) + '-' + new Date().toISOString().slice(0, 10) + '.pdf';
                    if (typeof html2pdf !== 'undefined') {
                        html2pdf().set({ margin: 10, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(clone).toPdf().get('pdf').then(function (pdf) {
                            return pdf.output('blob');
                        }).then(function (blob) {
                            document.body.removeChild(clone);
                            var file = new File([blob], filename, { type: 'application/pdf' });
                            getOrCreateFolder(activeProjectId, 'Proposals').then(function (folderId) {
                                return saveDocument(activeProjectId, file, folderId);
                            }).then(function () {
                                addToProjectBtn.disabled = false;
                                addToProjectBtn.textContent = 'Added ✓';
                                renderDocuments();
                                if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
                            }).catch(function () { addToProjectBtn.disabled = false; addToProjectBtn.textContent = 'Add to project'; });
                        }).catch(function () { document.body.removeChild(clone); addToProjectBtn.disabled = false; addToProjectBtn.textContent = 'Add to project'; });
                    } else {
                        document.body.removeChild(clone);
                        addToProjectBtn.disabled = false;
                        addToProjectBtn.textContent = 'Add to project';
                    }
                });

                btnWrap.appendChild(pdfBtn);
                btnWrap.appendChild(addToProjectBtn);
                propDocWrap.appendChild(btnWrap);
            })();

            wrap.appendChild(propDocWrap);

        }
        if (resumeData && resumeData.filename) {
            var resumeCard = document.createElement('div');
            resumeCard.className = 'msg-resume-card';
            var fn = resumeData.filename || 'Resume.pdf';
            resumeCard.innerHTML = '<div class="msg-resume-preview"><span class="msg-resume-icon" aria-hidden="true">📄</span><span class="msg-resume-filename">' + fn.replace(/"/g, '&quot;') + '</span></div><div class="msg-resume-actions"></div>';
            var btnWrap = resumeCard.querySelector('.msg-resume-actions');
            var dlBtn = document.createElement('button');
            dlBtn.type = 'button';
            dlBtn.className = 'btn-primary btn-sm';
            dlBtn.textContent = 'Download';
            dlBtn.addEventListener('click', function () {
                fetch(API_BASE + '/resume/latest').then(function (r) {
                    if (!r.ok) throw new Error('Resume not found');
                    return r.blob();
                }).then(function (blob) {
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    a.href = url;
                    a.download = fn;
                    a.click();
                    URL.revokeObjectURL(url);
                }).catch(function () {
                    addMessage('assistant', 'Could not download resume. Try generating it again.');
                });
            });
            var upBtn = document.createElement('button');
            upBtn.type = 'button';
            upBtn.className = 'btn-secondary btn-sm';
            upBtn.textContent = 'Update';
            upBtn.title = 'Regenerate with latest profile';
            upBtn.addEventListener('click', function () {
                if (input && typeof doSend === 'function') {
                    input.value = 'create my resume';
                    if (input.style) input.style.height = 'auto';
                    doSend();
                } else {
                    addMessage('assistant', 'Edit your profile in Settings → Profile, then say "create my resume" again.');
                }
            });
            btnWrap.appendChild(dlBtn);
            btnWrap.appendChild(upBtn);
            wrap.appendChild(resumeCard);
        }
        if (bidDocData && bidDocData.filename && bidDocData.content) {
            var bidCard = document.createElement('div');
            bidCard.className = 'bid-doc-card';
            bidCard.innerHTML = '<div class="bid-doc-card-header">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' +
                '<span class="bid-doc-card-name">' + (bidDocData.filename || 'Bid Worksheet.md') + '</span>' +
                '</div>' +
                '<p class="bid-doc-card-desc">Bid worksheet saved to project documents</p>';
            wrap.appendChild(bidCard);
            if (activeProjectId) {
                saveTextDocument(activeProjectId, bidDocData.filename, bidDocData.content).then(function () {
                    renderDocuments();
                    if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
                }).catch(function () {});
            }
        }
        if (createProjectData && createProjectData.name) {
            var projName = (createProjectData.name || '').trim();
            if (projName) {
                createProject(projName);
                var ctx = 'Project "' + projName + '" created.';
                if (createProjectData.client) ctx += '\nClient: ' + createProjectData.client;
                if (createProjectData.scope) ctx += '\nScope: ' + createProjectData.scope;
                if (createProjectData.total) ctx += '\nBid: $' + Number(createProjectData.total).toLocaleString();
                addMessage('assistant', ctx);
            }
        }
    }

    var CHAT_SUGGESTIONS_BASE = [
        'Estimate 1500 LF of 8" sewer in clay soil',
        'Help me bid a commercial excavation project',
        'Generate a proposal for a waterline replacement',
        'What does an excavator cost per day?',
    ];
    var CHAT_SUGGESTIONS_DESKTOP = [
        'Estimate 1500 LF of 8" sewer in clay soil',
        'Help me bid a job',
        'Find the email from Granite about material pricing',
        'Organize my desktop',
    ];

    // ── Typewriter effect ──────────────────────────────────────────────────────
    // Animates only the last assistant message at ~800 chars/sec.
    // History messages render instantly; only the newest response types out.
    var _typingTimer = null;
    var _doTypewriter = false;   // set true only after a fresh AI response

    function typewriterMessage(msgEl) {
        if (!msgEl) return;
        // Collect all text-bearing children (p, li, h1-h4, blockquote, pre)
        var nodes = Array.from(msgEl.querySelectorAll(
            '.msg-content > p, .msg-content > ul > li, .msg-content > ol > li, ' +
            '.msg-content > h1, .msg-content > h2, .msg-content > h3, .msg-content > h4, ' +
            '.msg-content > blockquote, .msg-content > pre'
        ));
        if (nodes.length === 0) {
            // Fallback: animate the content wrapper itself
            var cw = msgEl.querySelector('.msg-content');
            if (cw) nodes = [cw];
        }

        // Save final HTML; initially hide all nodes
        var saved = nodes.map(function (n) { return n.innerHTML; });
        nodes.forEach(function (n) { n.style.visibility = 'hidden'; });

        var CHARS_PER_TICK = 14;   // ~840 chars/sec at 60fps — fast but visible
        var TICK_MS = 16;          // ~60fps

        var nodeIdx = 0;
        if (_typingTimer) { clearTimeout(_typingTimer); _typingTimer = null; }

        function revealNode() {
            if (nodeIdx >= nodes.length) return;
            var n = nodes[nodeIdx];
            var finalHtml = saved[nodeIdx];
            var text = (n.textContent || '').trim();
            nodeIdx++;

            n.style.visibility = 'visible';
            n.textContent = '';

            var charPos = 0;
            function tick() {
                if (charPos >= text.length) {
                    // Restore formatted HTML (bold, links, etc.)
                    n.innerHTML = finalHtml;
                    scrollToLatest();
                    // Brief pause between paragraphs, then continue
                    _typingTimer = setTimeout(revealNode, 20);
                    return;
                }
                var end = Math.min(charPos + CHARS_PER_TICK, text.length);
                n.textContent += text.slice(charPos, end);
                charPos = end;
                scrollToLatest();
                _typingTimer = setTimeout(tick, TICK_MS);
            }
            tick();
        }

        revealNode();
    }

    /**
     * Render contact selection buttons after an ambiguity response.
     * choices = [{ label: 'Emma 🐻', message: 'Text Emma 🐻 back' }, ...]
     * When clicked, auto-sends the choice.message as a new user message.
     */
    function renderContactChoices(choices) {
        // Remove any existing choice row first
        var existing = document.getElementById('contact-choices-row');
        if (existing) existing.remove();

        var row = document.createElement('div');
        row.id = 'contact-choices-row';
        row.className = 'contact-choices-row';

        choices.forEach(function (choice) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'contact-choice-btn';
            btn.textContent = choice.label;
            btn.addEventListener('click', function () {
                row.remove();
                // Auto-send as a new user message
                var input = document.getElementById('chat-input');
                if (input) {
                    input.value = choice.message;
                    var sendBtn = document.getElementById('send-btn');
                    if (sendBtn) sendBtn.click();
                    else {
                        // Fallback: dispatch Enter keypress
                        var e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
                        input.dispatchEvent(e);
                    }
                }
            });
            row.appendChild(btn);
        });

        messagesEl.appendChild(row);
        scrollToLatest();
    }

    function renderMessages() {
        messagesEl.innerHTML = '';
        var msgs = activeProjectId ? getMessages(activeProjectId) : [];
        if (_typingTimer) { clearTimeout(_typingTimer); _typingTimer = null; }
        if (msgs.length === 0) {
            var emptyWrap = document.createElement('div');
            emptyWrap.className = 'chat-empty-state';
            var emptyTitle = document.createElement('p');
            emptyTitle.className = 'chat-empty-title';
            emptyTitle.textContent = 'What can I help with?';
            emptyWrap.appendChild(emptyTitle);
            var chipsWrap = document.createElement('div');
            chipsWrap.className = 'chat-suggestions';
            var suggestions = isDesktopApp ? CHAT_SUGGESTIONS_DESKTOP : CHAT_SUGGESTIONS_BASE;
            suggestions.forEach(function (text) {
                var chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'chat-suggestion-chip';
                chip.textContent = text;
                chip.addEventListener('click', function () {
                    if (input) {
                        input.value = text;
                        input.dispatchEvent(new Event('input'));
                        input.focus();
                        if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                    }
                });
                chipsWrap.appendChild(chip);
            });
            emptyWrap.appendChild(chipsWrap);
            messagesEl.appendChild(emptyWrap);
            return;
        }
        var firstAssistantSeen = false;
        // Detect the last assistant message index — only it gets the typewriter
        var lastAssistantIdx = -1;
        msgs.forEach(function (m, idx) { if (m.role === 'assistant') lastAssistantIdx = idx; });
        var _newResponseEl = null;

        msgs.forEach(function (m, idx) {
            var wrap = document.createElement('div');
            wrap.className = 'msg msg-' + m.role;
            var contentWrap = document.createElement('div');
            contentWrap.className = 'msg-content';
            renderMessageContent(m.content, contentWrap);
            wrap.appendChild(contentWrap);
            var contentEl = contentWrap.querySelector('p');
            var isFirstAssistant = m.role === 'assistant' && !firstAssistantSeen;
            var isLastMessage = idx === msgs.length - 1;
            if (m.role === 'assistant') firstAssistantSeen = true;
            if (contentEl && contentEl.textContent.length > MSG_COLLAPSE_THRESHOLD && !isFirstAssistant && !isLastMessage) {
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
            // Right-click context menu on assistant messages
            if (m.role === 'assistant') {
                (function (message, el) {
                    el.addEventListener('contextmenu', function (e) {
                        e.preventDefault();
                        var existing = document.getElementById('msg-context-menu');
                        if (existing) existing.remove();

                        var rawMd = typeof message.content === 'string' ? message.content : '';
                        var plainText = (el.querySelector('.msg-content') || el).textContent || rawMd;
                        var hasProject = !!(window.mudrag && window.mudrag.getActiveProjectId());

                        var menu = document.createElement('div');
                        menu.id = 'msg-context-menu';
                        menu.className = 'project-context-menu';
                        menu.innerHTML =
                            '<button type="button" class="project-context-item" data-action="copy-text">Copy message</button>' +
                            '<button type="button" class="project-context-item" data-action="copy-md">Copy as markdown</button>' +
                            '<div class="project-context-divider"></div>' +
                            '<button type="button" class="project-context-item" data-action="add-to-chat">Add to chat</button>' +
                            (hasProject
                                ? '<button type="button" class="project-context-item" data-action="add-to-docs">Add to documents</button>'
                                : '');

                        // Copy plain text
                        menu.querySelector('[data-action="copy-text"]').addEventListener('click', function () {
                            navigator.clipboard.writeText(plainText).catch(function () {});
                            menu.remove();
                        });

                        // Copy raw markdown
                        menu.querySelector('[data-action="copy-md"]').addEventListener('click', function () {
                            navigator.clipboard.writeText(rawMd).catch(function () {});
                            menu.remove();
                        });

                        // Add to chat input
                        menu.querySelector('[data-action="add-to-chat"]').addEventListener('click', function () {
                            var chatInput = document.getElementById('chat-input');
                            if (chatInput) {
                                chatInput.value = (chatInput.value ? chatInput.value + '\n\n' : '') + rawMd;
                                chatInput.dispatchEvent(new Event('input'));
                                chatInput.focus();
                                chatInput.selectionStart = chatInput.selectionEnd = chatInput.value.length;
                            }
                            menu.remove();
                        });

                        // Save as markdown document in active project
                        var addDocsBtn = menu.querySelector('[data-action="add-to-docs"]');
                        if (addDocsBtn) {
                            addDocsBtn.addEventListener('click', function () {
                                var projectId = window.mudrag && window.mudrag.getActiveProjectId();
                                if (!projectId) { menu.remove(); return; }
                                var ts = new Date();
                                var pad = function (n) { return String(n).padStart(2, '0'); };
                                var docName = 'AI response ' + ts.getFullYear() + '-' + pad(ts.getMonth() + 1) + '-' + pad(ts.getDate()) + ' ' + pad(ts.getHours()) + pad(ts.getMinutes()) + '.md';
                                var blob = new Blob([rawMd], { type: 'text/markdown' });
                                var file = new File([blob], docName, { type: 'text/markdown' });
                                window.mudrag.saveDocument(projectId, file, null, { source: 'ai-message' }).then(function () {
                                    if (window.mudrag.renderDocuments) window.mudrag.renderDocuments();
                                    showToast('"' + docName + '" added to project');
                                }).catch(function () {
                                    showToast('Could not save document.');
                                });
                                menu.remove();
                            });
                        }

                        menu.style.left = Math.min(e.clientX, window.innerWidth - 210) + 'px';
                        menu.style.top = Math.min(e.clientY, window.innerHeight - 120) + 'px';
                        document.body.appendChild(menu);

                        function dismiss(ev) {
                            if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss); }
                        }
                        setTimeout(function () { document.addEventListener('mousedown', dismiss); }, 0);
                    });
                }(m, wrap));
            }
            // Mark the last assistant message for typewriter animation
            if (idx === lastAssistantIdx) {
                wrap.setAttribute('data-typewriter', '1');
                _newResponseEl = wrap;
            }
            messagesEl.appendChild(wrap);
        });
        scrollToLatest();
        // Only animate after a fresh AI response, not on history re-renders
        if (_newResponseEl && _doTypewriter) {
            _doTypewriter = false;
            typewriterMessage(_newResponseEl);
        }
    }

    function scrollToLatest() {
        var container = document.getElementById('chat-messages');
        if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }

    function renderProjects() {
        if (_renamingProject) return;
        var projects = getProjects();
        projectsList.innerHTML = '';
        if (projects.length === 0) {
            projectsList.innerHTML = '<li class="projects-empty">No projects yet.<br>Click + to create one.</li>';
            return;
        }
        var clickTimeout;
        projects.forEach(function (p) {
            var li = document.createElement('li');
            var a = document.createElement('button');
            a.type = 'button';
            a.className = 'project-item' + (p.id === activeProjectId ? ' active' : '');
            a.textContent = p.name;
            a.setAttribute('data-project-id', p.id);
            a.addEventListener('click', function (e) {
                if (_renamingProject || e.target.classList.contains('project-rename-input')) return;
                clearTimeout(clickTimeout);
                clickTimeout = setTimeout(function () { if (!_renamingProject) switchProject(p.id); }, 200);
            });
            a.addEventListener('dblclick', function (e) {
                e.preventDefault();
                e.stopPropagation();
                clearTimeout(clickTimeout);
                startRenameProject(p.id, a);
            });
            a.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                showProjectContextMenu(e, p.id, a);
            });
            a.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.target.classList.contains('project-rename-input')) {
                    e.preventDefault();
                    startRenameProject(p.id, a);
                }
            });
            li.appendChild(a);
            projectsList.appendChild(li);
        });
    }

    function deleteProject(projectId) {
        var projects = getProjects();
        var p = projects.find(function (x) { return x.id === projectId; });
        if (!p) return;
        projects = projects.filter(function (x) { return x.id !== projectId; });
        setProjects(projects);
        // Remove chats for this project from localStorage
        try {
            var allChatsRaw = localStorage.getItem('mudrag_chats');
            var allChats = allChatsRaw ? JSON.parse(allChatsRaw) : {};
            delete allChats[projectId];
            localStorage.setItem('mudrag_chats', JSON.stringify(allChats));
        } catch (_) {}
        removeProjectData(projectId);
        // Sync deletion to desktop API
        if (isToolServerOrigin && API_BASE) {
            fetch(API_BASE + '/storage/projects/' + encodeURIComponent(projectId), { method: 'DELETE' }).catch(function () {});
        }
        // If deleted project was active, switch to another
        if (activeProjectId === projectId) {
            var remaining = getProjects();
            if (remaining.length > 0) {
                switchProject(remaining[0].id);
            } else {
                activeProjectId = null;
                try { localStorage.removeItem(STORAGE_ACTIVE); } catch (_) {}
                renderChats();
            }
        }
        renderProjects();
    }

    function confirmDeleteProject(projectId) {
        var projects = getProjects();
        var p = projects.find(function (x) { return x.id === projectId; });
        if (!p) return;
        var modal = document.getElementById('modal-confirm-delete');
        var title = document.getElementById('confirm-delete-title');
        var desc = document.getElementById('confirm-delete-desc');
        var btnOk = document.getElementById('btn-confirm-delete-ok');
        var btnCancel = document.getElementById('btn-confirm-delete-cancel');
        if (!modal) { deleteProject(projectId); return; }
        if (title) title.textContent = 'Delete project "' + (p.name || 'this project') + '"?';
        if (desc) desc.textContent = 'This will permanently remove the project and all its chats. Documents stored in the cloud are not affected. This cannot be undone.';
        modal.hidden = false;
        function cleanup() { modal.hidden = true; btnOk.removeEventListener('click', doOk); btnCancel.removeEventListener('click', doCancel); }
        function doOk() { cleanup(); deleteProject(projectId); }
        function doCancel() { cleanup(); }
        btnOk.addEventListener('click', doOk);
        btnCancel.addEventListener('click', doCancel);
    }

    function showProjectContextMenu(e, projectId, buttonEl) {
        var existing = document.getElementById('project-context-menu');
        if (existing) existing.remove();
        var menu = document.createElement('div');
        menu.id = 'project-context-menu';
        menu.className = 'project-context-menu';
        menu.innerHTML =
            '<button type="button" class="project-context-item">Rename</button>' +
            '<button type="button" class="project-context-item project-context-item-danger">Delete</button>';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        document.body.appendChild(menu);
        var items = menu.querySelectorAll('.project-context-item');
        items[0].addEventListener('click', function () {
            menu.remove();
            startRenameProject(projectId, buttonEl);
        });
        items[1].addEventListener('click', function () {
            menu.remove();
            confirmDeleteProject(projectId);
        });
        function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
        setTimeout(function () { document.addEventListener('click', closeMenu); }, 0);
    }

    function renderChats() {
        var chatsList = document.getElementById('chats-list');
        if (!chatsList) return;
        chatsList.innerHTML = '';
        if (!activeProjectId) return;
        var chats = getChats(activeProjectId);
        var keys = Object.keys(chats);
        if (keys.length === 0) return;
        keys.sort(function (a, b) { return (chats[b].createdAt || 0) - (chats[a].createdAt || 0); });
        var currentChatId = activeChatId || getActiveChatId(activeProjectId);
        keys.forEach(function (cid) {
            var chat = chats[cid];
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chat-thread-item' + (cid === currentChatId ? ' active' : '');
            btn.textContent = chat.name || 'Chat';
            btn.setAttribute('data-chat-id', cid);
            btn.addEventListener('click', function () { switchChat(activeProjectId, cid); });
            btn.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                showChatContextMenu(e, activeProjectId, cid, btn);
            });
            if (window.mudragDesktop && window.mudragDesktop.openChatWindow) {
                (function (pid, chatId) {
                    btn.addEventListener('dblclick', function (e) {
                        e.preventDefault();
                        window.mudragDesktop.openChatWindow(pid, chatId);
                    });
                }(activeProjectId, cid));
            }
            chatsList.appendChild(btn);
        });
    }

    function switchChat(projectId, newChatId) {
        activeChatId = newChatId;
        setActiveChatId(projectId, newChatId);
        renderMessages();
        renderChats();
        scrollToLatest();
    }

    function showChatContextMenu(e, projectId, cid, buttonEl) {
        var existing = document.getElementById('chat-context-menu');
        if (existing) existing.remove();
        var menu = document.createElement('div');
        menu.id = 'chat-context-menu';
        menu.className = 'project-context-menu';
        menu.innerHTML = '<button type="button" class="project-context-item" data-action="rename">Rename</button>' +
            '<button type="button" class="project-context-item" data-action="delete">Delete</button>';
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        document.body.appendChild(menu);
        menu.querySelector('[data-action="rename"]').addEventListener('click', function () {
            menu.remove();
            startRenameChat(projectId, cid, buttonEl);
        });
        menu.querySelector('[data-action="delete"]').addEventListener('click', function () {
            menu.remove();
            deleteChatThread(projectId, cid);
            renderChats();
            renderMessages();
        });
        function closeMenu() {
            if (menu.parentNode) menu.remove();
            document.removeEventListener('click', closeMenu);
        }
        setTimeout(function () { document.addEventListener('click', closeMenu); }, 0);
    }

    function startRenameChat(projectId, cid, buttonEl) {
        if (!buttonEl || !cid) return;
        var chats = getChats(projectId);
        var chat = chats[cid];
        if (!chat) return;
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'project-rename-input';
        inp.value = chat.name || '';
        buttonEl.textContent = '';
        buttonEl.appendChild(inp);
        inp.focus();
        inp.select();
        function finish() {
            var newName = inp.value.trim();
            if (inp.parentNode === buttonEl) buttonEl.removeChild(inp);
            if (newName && newName !== chat.name) {
                renameChatThread(projectId, cid, newName);
                renderChats();
            } else {
                buttonEl.textContent = chat.name || 'Chat';
            }
        }
        inp.addEventListener('blur', finish);
        inp.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') { ev.preventDefault(); finish(); }
            if (ev.key === 'Escape') { ev.preventDefault(); if (inp.parentNode === buttonEl) buttonEl.removeChild(inp); buttonEl.textContent = chat.name || 'Chat'; }
        });
    }

    function updateActiveToolPills(toolsUsed) {
        activeTools = toolsUsed || [];
        if (!activeToolsBar) return;
        if (activeTools.length === 0) { activeToolsBar.hidden = true; activeToolsBar.innerHTML = ''; return; }
        var labels = {
            estimate_project_cost: 'Estimating',
            generate_proposal: 'Proposal',
            build_schedule: 'Schedule',
            search_mail: 'Email search',
            cleanup_desktop: 'Desktop',
            cleanup_downloads: 'Downloads',
            export_estimate_csv: 'CSV export',
            export_estimate_pdf: 'PDF export',
            export_bid_pdf: 'Bid PDF',
            find_work: 'Work finder',
            manage_rfi_workflow: 'RFI workflow',
            manage_submittal_workflow: 'Submittal workflow',
            autofill_daily_report: 'Daily report',
            manage_change_order_workflow: 'Change order',
            manage_pay_app_workflow: 'Pay app',
            add_to_calendar: 'Calendar',
            add_reminder: 'Reminder',
            quick_note: 'Note',
            weather: 'Weather'
        };
        activeToolsBar.innerHTML = '';
        activeTools.forEach(function (t) {
            var pill = document.createElement('span');
            pill.className = 'tool-active-pill';
            pill.textContent = labels[t] || t;
            activeToolsBar.appendChild(pill);
        });
        activeToolsBar.hidden = false;
        setTimeout(function () { activeToolsBar.hidden = true; activeToolsBar.innerHTML = ''; activeTools = []; }, 5000);
    }

    var DB_NAME = 'mudrag_docs';
    var DB_VERSION = 2;
    var DOC_STORE = 'documents';
    var FOLDERS_STORE = 'folders';
    var MAX_FILE_SIZE = 500 * 1024 * 1024;

    // In-memory clipboard for copy/paste between projects
    var docClipboard = null; // { type: 'doc'|'folder', doc?, folder?, folderDocs? }

    function openDB() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = function () { reject(req.error); };
            req.onsuccess = function () { resolve(req.result); };
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(DOC_STORE)) {
                    var docStore = db.createObjectStore(DOC_STORE, { keyPath: 'id' });
                    docStore.createIndex('projectId', 'projectId', { unique: false });
                }
                if (e.oldVersion < 2 && db.objectStoreNames.contains(DOC_STORE)) {
                    try {
                        var docStore = e.target.transaction.objectStore(DOC_STORE);
                        if (!docStore.indexNames.contains('folderId')) {
                            docStore.createIndex('folderId', 'folderId', { unique: false });
                        }
                    } catch (err) { /* ignore */ }
                }
                if (!db.objectStoreNames.contains(FOLDERS_STORE)) {
                    var folderStore = db.createObjectStore(FOLDERS_STORE, { keyPath: 'id' });
                    folderStore.createIndex('projectId', 'projectId', { unique: false });
                }
            };
        });
    }

    function decodeArrayBufferForIndex(arrayBuffer, maxChars) {
        try {
            var text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(arrayBuffer || new ArrayBuffer(0)));
            return (text || '').replace(/\u0000/g, ' ').slice(0, maxChars || 18000);
        } catch (e) {
            return '';
        }
    }

    function summarizeCsvForIndex(csvText) {
        if (!csvText) return '';
        try {
            if (typeof Papa !== 'undefined') {
                var parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
                var rows = parsed.data || [];
                var fields = (parsed.meta && parsed.meta.fields) || [];
                var sample = rows.slice(0, 120).map(function (row) { return JSON.stringify(row); }).join('\n');
                return ('CSV columns: ' + fields.join(', ') + '\n' + sample).slice(0, 18000);
            }
        } catch (e) { /* fall through */ }
        return csvText.slice(0, 18000);
    }

    function extractIndexableTextFromArrayBuffer(name, mimeType, arrayBuffer) {
        var fileName = String(name || '');
        var lower = fileName.toLowerCase();
        var ext = (lower.split('.').pop() || '').toLowerCase();

        if (/^(txt|md|markdown|json|csv|tsv|log|xml|html|htm|js|ts|py|rb|sh|yml|yaml|ini|cfg|conf|env)$/i.test(ext)) {
            var plain = decodeArrayBufferForIndex(arrayBuffer, 20000);
            if (ext === 'csv' || ext === 'tsv') return Promise.resolve(summarizeCsvForIndex(plain));
            return Promise.resolve(plain);
        }

        if (ext === 'xlsx' || ext === 'xls') {
            try {
                if (typeof XLSX !== 'undefined') {
                    var wb = XLSX.read(arrayBuffer, { type: 'array' });
                    var parts = [];
                    (wb.SheetNames || []).slice(0, 5).forEach(function (sheetName) {
                        var ws = wb.Sheets[sheetName];
                        var rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
                        parts.push('Sheet: ' + sheetName);
                        rows.slice(0, 120).forEach(function (row) { parts.push((row || []).join('\t')); });
                    });
                    return Promise.resolve(parts.join('\n').slice(0, 20000));
                }
            } catch (e) { /* ignore */ }
            return Promise.resolve('');
        }

        if (ext === 'docx' && typeof mammoth !== 'undefined') {
            return mammoth.extractRawText({ arrayBuffer: arrayBuffer }).then(function (result) {
                return String((result && result.value) || '').slice(0, 20000);
            }).catch(function () { return ''; });
        }

        if (ext === 'pdf' || /pdf/i.test(String(mimeType || ''))) {
            return Promise.resolve('PDF document: ' + fileName);
        }

        return Promise.resolve('');
    }

    function queueProjectRagIndex(projectId, payload) {
        if (!projectId || !payload || !payload.text) return Promise.resolve(false);
        if (!getAuthHeaders().Authorization) return Promise.resolve(false);
        return fetch(API_BASE + '/rag-index', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        }).then(function (r) {
            return !!r.ok;
        }).catch(function () {
            return false;
        });
    }

    function indexDocumentForProjectRag(projectId, doc, meta) {
        if (!projectId || !doc || !doc.id || !doc.data) return Promise.resolve(false);
        return extractIndexableTextFromArrayBuffer(doc.name, doc.type, doc.data).then(function (rawText) {
            var txt = String(rawText || '').trim();
            if (!txt) return false;
            return queueProjectRagIndex(projectId, {
                project_id: projectId,
                document_id: doc.id,
                title: doc.name || 'Project document',
                source: (meta && meta.source) || doc.source || 'project-upload',
                source_meta: (meta && meta.source_meta) || doc.source_meta || {},
                text: txt
            });
        }).catch(function () { return false; });
    }

    function saveDocument(projectId, file, folderId, meta) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var reader = new FileReader();
                reader.onload = function () {
                    var doc = {
                        id: 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
                        projectId: projectId,
                        folderId: folderId || null,
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        data: reader.result,
                        source: (meta && meta.source) || null,
                        source_meta: (meta && meta.source_meta) || null,
                        createdAt: Date.now()
                    };
                    var tx = db.transaction(DOC_STORE, 'readwrite');
                    tx.objectStore(DOC_STORE).add(doc);
                    tx.oncomplete = function () {
                        indexDocumentForProjectRag(projectId, doc, meta || {});
                        resolve(doc.id);
                    };
                    tx.onerror = function () { reject(tx.error); };
                };
                reader.onerror = function () { reject(reader.error); };
                reader.readAsArrayBuffer(file);
            });
        });
    }

    function createFolder(projectId, name) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var folder = {
                    id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
                    projectId: projectId,
                    name: (name || 'New folder').trim() || 'New folder',
                    createdAt: Date.now()
                };
                var tx = db.transaction(FOLDERS_STORE, 'readwrite');
                tx.objectStore(FOLDERS_STORE).add(folder);
                tx.oncomplete = function () { resolve(folder.id); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function getOrCreateFolder(projectId, name) {
        return getFolders(projectId).then(function (folders) {
            var existing = folders.find(function (f) { return (f.name || '').toLowerCase() === (name || '').toLowerCase(); });
            if (existing) return Promise.resolve(existing.id);
            return createFolder(projectId, name);
        });
    }

    function getFolders(projectId) {
        return openDB().then(function (db) {
            return new Promise(function (resolve) {
                if (!db.objectStoreNames.contains(FOLDERS_STORE)) { resolve([]); return; }
                var tx = db.transaction(FOLDERS_STORE, 'readonly');
                var index = tx.objectStore(FOLDERS_STORE).index('projectId');
                var req = index.getAll(projectId);
                req.onsuccess = function () { resolve((req.result || []).sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); })); };
                req.onerror = function () { resolve([]); };
            });
        });
    }

    function renameFolder(folderId, newName) {
        var trimmed = (newName || '').trim();
        if (!trimmed) return Promise.resolve();
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(FOLDERS_STORE, 'readwrite');
                var req = tx.objectStore(FOLDERS_STORE).get(folderId);
                req.onsuccess = function () {
                    var folder = req.result;
                    if (!folder) { resolve(); return; }
                    folder.name = trimmed;
                    tx.objectStore(FOLDERS_STORE).put(folder);
                };
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function renameDocument(docId, newName) {
        var trimmed = (newName || '').trim();
        if (!trimmed) return Promise.resolve();
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(DOC_STORE, 'readwrite');
                var req = tx.objectStore(DOC_STORE).get(docId);
                req.onsuccess = function () {
                    var doc = req.result;
                    if (!doc) { resolve(); return; }
                    doc.name = trimmed;
                    tx.objectStore(DOC_STORE).put(doc);
                };
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function deleteFolder(folderId) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction([FOLDERS_STORE, DOC_STORE], 'readwrite');
                tx.objectStore(FOLDERS_STORE).delete(folderId);
                var docIndex = tx.objectStore(DOC_STORE).index('folderId');
                var req = docIndex.getAll(folderId);
                req.onsuccess = function () {
                    var docs = req.result || [];
                    docs.forEach(function (d) {
                        var d2 = Object.assign({}, d);
                        d2.folderId = null;
                        tx.objectStore(DOC_STORE).put(d2);
                    });
                };
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function moveDocumentToFolder(docId, folderId) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(DOC_STORE, 'readwrite');
                var req = tx.objectStore(DOC_STORE).get(docId);
                req.onsuccess = function () {
                    var doc = req.result;
                    if (!doc) { resolve(); return; }
                    doc.folderId = folderId || null;
                    tx.objectStore(DOC_STORE).put(doc);
                };
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
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

    /** Update the raw data of an existing document in IDB (for save after editing) */
    function updateDocumentContent(docId, newData) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(DOC_STORE, 'readwrite');
                var store = tx.objectStore(DOC_STORE);
                var updatedDoc = null;
                var req = store.get(docId);
                req.onsuccess = function() {
                    var doc = req.result;
                    if (!doc) return reject(new Error('Document not found'));
                    doc.data = newData;
                    doc.size = newData.byteLength || 0;
                    updatedDoc = doc;
                    store.put(doc);
                };
                tx.oncomplete = function() {
                    if (updatedDoc && updatedDoc.projectId) {
                        indexDocumentForProjectRag(updatedDoc.projectId, updatedDoc, {
                            source: updatedDoc.source || 'project-upload',
                            source_meta: updatedDoc.source_meta || {}
                        });
                    }
                    resolve();
                };
                tx.onerror = function() { reject(tx.error); };
            });
        });
    }

    function copyDocToProject(doc, targetProjectId, targetFolderId) {
        if (!doc || !targetProjectId) return Promise.resolve(null);
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(DOC_STORE, 'readwrite');
                var newDoc = {
                    id: 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
                    projectId: targetProjectId,
                    folderId: targetFolderId || null,
                    name: doc.name,
                    type: doc.type,
                    size: doc.size,
                    data: doc.data,
                    source: doc.source || null,
                    source_meta: doc.source_meta || null,
                    uploadedAt: new Date().toISOString(),
                };
                tx.objectStore(DOC_STORE).add(newDoc);
                tx.oncomplete = function () {
                    indexDocumentForProjectRag(targetProjectId, newDoc, {
                        source: newDoc.source || 'project-upload',
                        source_meta: newDoc.source_meta || {}
                    });
                    resolve(newDoc);
                };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function getDocumentById(docId) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(DOC_STORE, 'readonly');
                var req = tx.objectStore(DOC_STORE).get(docId);
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function pasteClipboard() {
        if (!docClipboard || !activeProjectId) return;
        if (docClipboard.type === 'doc') {
            var doc = docClipboard.doc;
            if (!doc) return;
            getDocumentById(doc.id).then(function (fullDoc) {
                var src = fullDoc || doc;
                copyDocToProject(src, activeProjectId, null).then(function () {
                    renderDocuments();
                    showToast('Pasted "' + src.name + '" into project');
                });
            });
        } else if (docClipboard.type === 'folder') {
            var folder = docClipboard.folder;
            var folderDocs = docClipboard.folderDocs || [];
            // Create new folder then copy all docs into it
            var newFolderId = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
            openDB().then(function (db) {
                return new Promise(function (resolve, reject) {
                    var tx = db.transaction(FOLDERS_STORE, 'readwrite');
                    tx.objectStore(FOLDERS_STORE).add({
                        id: newFolderId,
                        projectId: activeProjectId,
                        name: folder.name + ' (copy)',
                        createdAt: new Date().toISOString(),
                    });
                    tx.oncomplete = resolve;
                    tx.onerror = reject;
                });
            }).then(function () {
                return Promise.all(folderDocs.map(function (d) {
                    return getDocumentById(d.id).then(function (full) {
                        return copyDocToProject(full || d, activeProjectId, newFolderId);
                    });
                }));
            }).then(function () {
                renderDocuments();
                showToast('Pasted folder "' + folder.name + '" with ' + folderDocs.length + ' file' + (folderDocs.length !== 1 ? 's' : ''));
            });
        }
    }

    function showToast(msg) {
        var existing = document.getElementById('mudrag-toast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.id = 'mudrag-toast';
        toast.className = 'mudrag-toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        requestAnimationFrame(function () { toast.classList.add('mudrag-toast-show'); });
        setTimeout(function () {
            toast.classList.remove('mudrag-toast-show');
            setTimeout(function () { toast.remove(); }, 300);
        }, 2500);
    }

    // ── Bid Item CSV Scanner ────────────────────────────────────────────────
    var _lastCreatedCSVDocId = null;
    var _lastCreatedDocId = null;
    var _lastOpenedDocId = null;

    // Last doc saved via MUDRAG_SAVE_DOC — used by MUDRAG_CREATE_FOLDER to move it into the new folder
    var _lastSavedDocId = null;

    function moveDocToFolder(docId, folderId) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(DOC_STORE, 'readwrite');
                var req = tx.objectStore(DOC_STORE).get(docId);
                req.onsuccess = function () {
                    var doc = req.result;
                    if (!doc) { resolve(); return; }
                    doc.folderId = folderId;
                    tx.objectStore(DOC_STORE).put(doc);
                };
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function getDocExt(name) {
        var n = (name || '').toLowerCase();
        var idx = n.lastIndexOf('.');
        return idx >= 0 ? n.slice(idx + 1) : '';
    }

    function getDocTextSnippet(doc) {
        if (!doc || !(doc.data instanceof ArrayBuffer)) return '';
        var ext = getDocExt(doc.name);
        if (!/^(txt|md|markdown|csv|tsv|json|log|xml|yaml|yml|html|htm)$/i.test(ext)) return '';
        return ab2str(doc.data).slice(0, 2400).toLowerCase();
    }

    function classifyDocumentFolder(doc) {
        var name = (doc && doc.name ? doc.name : '').toLowerCase();
        var type = (doc && doc.type ? doc.type : '').toLowerCase();
        var ext = getDocExt(name);
        var text = getDocTextSnippet(doc);
        var has = function (re) { return re.test(name) || re.test(text); };

        if (/^(png|jpe?g|gif|webp|bmp|heic|tiff?)$/i.test(ext) || /^image\//i.test(type)) return 'Photos';
        if (has(/\b(plan|drawing|sheet|as[\s-]?built|blueprint)\b/)) return 'Plans';
        if (has(/\b(spec|specification|division)\b/)) return 'Specs';
        if (has(/\b(rfi|request\s+for\s+information)\b/)) return 'RFIs';
        if (has(/\b(submittal|shop[\s-]?drawing|material\s+data)\b/)) return 'Submittals';
        if (has(/\b(change[\s-]?order|co[-\s]?\d+)\b/)) return 'Change Orders';
        if (has(/\b(daily\s+report|daily\s+log|field\s+log)\b/)) return 'Daily Reports';
        if (has(/\b(pay\s*app|payment\s*application|invoice|billing|retainage)\b/)) return 'Billing';
        if (has(/\b(contract|agreement|msa|purchase\s*order|po[-\s]?\d+)\b/)) return 'Contracts';
        if (has(/\b(proposal|quote)\b/)) return 'Proposals';
        if (has(/\b(schedule|gantt|timeline)\b/)) return 'Schedules';
        if (has(/\b(bid|itb|rfp|rfq|solicitation|take[\s-]?off|quantity)\b/)) return 'Bids';

        if (/^(pdf|dwg|dxf)$/i.test(ext)) return 'Plans';
        if (/^(doc|docx|rtf)$/i.test(ext)) return 'Documents';
        if (/^(xls|xlsx|csv|tsv)$/i.test(ext)) return 'Spreadsheets';
        return 'Documents';
    }

    function buildAutoFolderPlan(docs) {
        var assignments = (docs || []).map(function (doc) {
            return { doc: doc, folder: classifyDocumentFolder(doc) };
        });
        var byFolder = {};
        assignments.forEach(function (a) {
            if (!byFolder[a.folder]) byFolder[a.folder] = [];
            byFolder[a.folder].push(a.doc);
        });
        var folders = Object.keys(byFolder).sort(function (a, b) { return a.localeCompare(b); });
        return { assignments: assignments, byFolder: byFolder, folders: folders };
    }

    function renderAutoFolderPreviewCard(projectId, wrap, plan) {
        if (!wrap || !plan) return;
        var card = document.createElement('div');
        card.className = 'msg-doc-card';
        var rows = plan.folders.map(function (folder) {
            var docs = plan.byFolder[folder] || [];
            var sample = docs.slice(0, 2).map(function (d) { return d.name; }).join(', ');
            return '<li><strong>' + folder + '</strong> (' + docs.length + ')'
                + (sample ? '<div style="font-size:0.78rem;color:var(--text-secondary);margin-top:2px">' + sample + (docs.length > 2 ? ', …' : '') + '</div>' : '')
                + '</li>';
        }).join('');
        card.innerHTML =
            '<div class="msg-doc-header">' +
                '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 7h18M3 12h18M3 17h18"/></svg>' +
                '<span>Suggested folder structure</span>' +
            '</div>' +
            '<ul style="margin:8px 0 0 18px;padding:0;display:flex;flex-direction:column;gap:8px;font-size:0.86rem">' + rows + '</ul>' +
            '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
                '<button type="button" class="btn-primary btn-sm msg-auto-folder-apply">Create Suggested Folder Structure</button>' +
            '</div>';
        var applyBtn = card.querySelector('.msg-auto-folder-apply');
        if (applyBtn) {
            applyBtn.addEventListener('click', function () {
                applyBtn.disabled = true;
                applyBtn.textContent = 'Organizing…';
                applyAutoFolderStructure(projectId, wrap, plan).finally(function () {
                    applyBtn.disabled = false;
                    applyBtn.textContent = 'Create Suggested Folder Structure';
                });
            });
        }
        wrap.appendChild(card);
    }

    function previewAutoFolderStructure(projectId, wrap) {
        return getDocuments(projectId).then(function (docs) {
            if (!docs || docs.length === 0) {
                appendStatusMsg(wrap, 'No documents found in this project yet. Upload files first, then try again.', false);
                return null;
            }
            var plan = buildAutoFolderPlan(docs);
            renderAutoFolderPreviewCard(projectId, wrap, plan);
            return plan;
        }).catch(function () {
            appendStatusMsg(wrap, 'Could not analyze project documents right now.', false);
            return null;
        });
    }

    function applyAutoFolderStructure(projectId, wrap, precomputedPlan) {
        var planPromise = precomputedPlan ? Promise.resolve(precomputedPlan) : getDocuments(projectId).then(buildAutoFolderPlan);
        return planPromise.then(function (plan) {
            if (!plan || !plan.assignments || plan.assignments.length === 0) {
                appendStatusMsg(wrap, 'No documents found to organize.', false);
                return;
            }
            return getFolders(projectId).then(function (folders) {
                var folderMap = {};
                (folders || []).forEach(function (f) { folderMap[(f.name || '').toLowerCase()] = f.id; });
                var ensureFolderPromises = plan.folders.map(function (folderName) {
                    var key = folderName.toLowerCase();
                    if (folderMap[key]) return Promise.resolve();
                    return createFolder(projectId, folderName).then(function (newId) { folderMap[key] = newId; });
                });
                return Promise.all(ensureFolderPromises).then(function () {
                    var moveOps = [];
                    plan.assignments.forEach(function (a) {
                        var targetId = folderMap[(a.folder || '').toLowerCase()];
                        if (!targetId || a.doc.folderId === targetId) return;
                        moveOps.push(moveDocumentToFolder(a.doc.id, targetId));
                    });
                    return Promise.all(moveOps).then(function () {
                        renderDocuments();
                        if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
                        var movedCount = moveOps.length;
                        var folderCount = plan.folders.length;
                        showToast('Organized ' + movedCount + ' file' + (movedCount !== 1 ? 's' : '') + ' into ' + folderCount + ' folder' + (folderCount !== 1 ? 's' : ''));
                        appendStatusMsg(wrap, '✓ Organized ' + movedCount + ' file' + (movedCount !== 1 ? 's' : '') + ' into ' + folderCount + ' smart folder' + (folderCount !== 1 ? 's' : '') + '.', true);
                    });
                });
            });
        }).catch(function () {
            appendStatusMsg(wrap, 'Could not auto-organize files right now. Please try again.', false);
        });
    }

    /**
     * Decode an ArrayBuffer to text (UTF-8).
     */
    function ab2str(ab) {
        try { return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(ab)); } catch (e) { return ''; }
    }

    /**
     * Robust CSV/TSV parser that handles quoted fields.
     */
    function naiveParseCSV(text) {
        var rows = [];
        var lines = text.split('\n');
        lines.forEach(function (line) {
            line = line.replace(/\r$/, '');
            if (!line.trim()) return;
            var sep = line.indexOf('\t') > 0 && line.indexOf(',') < 0 ? '\t' : ',';
            // Handle quoted fields
            var row = [];
            var cur = '';
            var inQ = false;
            for (var i = 0; i < line.length; i++) {
                var ch = line[i];
                if (inQ) {
                    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                    else if (ch === '"') { inQ = false; }
                    else { cur += ch; }
                } else if (ch === '"') {
                    inQ = true;
                } else if (ch === sep) {
                    row.push(cur.trim()); cur = '';
                } else {
                    cur += ch;
                }
            }
            row.push(cur.trim());
            rows.push(row);
        });
        return rows;
    }

    /**
     * Detect if a header row looks like a bid items / quantities table.
     */
    var BID_HEADER_KEYS = /qty|quantity|quantities|unit|item|description|desc|cost|price|total|amount|material|labor|lf|cy|ea|ls|sf|sy|scope|work|spec/i;
    function isBidTable(headers) {
        return headers.some(function (h) { return BID_HEADER_KEYS.test(h); });
    }

    /** Our internal standard columns (used as an interchange format). */
    var STD_COLS = ['Item / Description', 'Qty', 'Unit', 'Unit Cost', 'Total', 'Notes'];

    /**
     * Map any source header to one of STD_COLS.
     */
    function normalizeHeader(h) {
        h = (h || '').toLowerCase().trim();
        if (/^(item|description|desc|scope|work|spec|pay.?item|activity|task|line.?item)/.test(h)) return 'Item / Description';
        if (/^(qty|quantity|quantities|count|no\.?$|est\.?\s*qty|est\.?\s*quantity|bid\s*qty)/.test(h)) return 'Qty';
        if (/^(unit|uom|u\/m|measure)/.test(h)) return 'Unit';
        if (/^(unit.?cost|unit.?price|rate|each|per.?unit|bid.?price|u\/p|unit.?bid)/.test(h)) return 'Unit Cost';
        if (/^(total|amount|extended|ext\.?|subtotal|sub.?total|line.?total|bid.?amount|ext\.?\s*price)/.test(h)) return 'Total';
        if (/^(note|notes?|comment|remark|memo|spec.?section|section)/.test(h)) return 'Notes';
        return h;
    }

    /**
     * Extract bid rows from a markdown/pipe table block.
     * Returns { headers, rows } or null.
     */
    function extractMDTable(lines, startIdx) {
        var headerLine = lines[startIdx];
        var headers = headerLine.split('|').map(function (c) { return c.trim(); }).filter(Boolean);
        if (!isBidTable(headers)) return null;

        var rows = [];
        var currentSection = '';
        for (var i = startIdx + 1; i < lines.length; i++) {
            var line = lines[i];
            if (/^\|[\s|:-]+\|$/.test(line.trim())) continue; // separator row
            if (!/^\|/.test(line)) break; // end of table
            var cells = line.split('|').slice(1, -1).map(function (c) { return c.trim(); });
            if (cells.some(function (c) { return c !== ''; })) {
                cells._section = currentSection;
                rows.push(cells);
            }
        }
        return rows.length ? { headers: headers, rows: rows } : null;
    }

    /**
     * Match inline quantity lines, including:
     *   "1,500 LF of 8-inch PVC @ $45/LF = $67,500"
     *   "Excavation: 800 CY @ $12.00 = $9,600"
     *   "8" Ductile Iron Pipe — 2,400 LF — $52.00/LF — $124,800"
     *   "- 200 EA gate valves @ $850 = $170,000"
     */
    var QTY_PATTERN = /(?:^|\n)\s*[-*•\d\.]+\s*(?:([A-Za-z][A-Za-z0-9 '"\-\/\(\)]+?)(?::|—|-{2,}|\s{2,}))?\s*(\d[\d,.]*)\s*(?:of\s+)?([A-Za-z][A-Za-z0-9 '"\-\/\(\)]{1,60}?)\s+(?:(LF|CY|SF|SY|EA|LS|TN|GAL|VF|LB|CWT|TON|EACH|DAY|HR|HRS|HOUR|HOURS|ACRE|FT|IN|YD|MBF|MSF|SQFT|CUYD|LINFT)\b)?\s*(?:[—\-@]+\s*\$?([\d,.]+)\s*(?:\/\w+)?)?\s*(?:[—\-=]+\s*\$?([\d,.]+))?/gi;

    function extractInlineItems(text) {
        var items = [];
        var seen = {};
        var match;
        QTY_PATTERN.lastIndex = 0;
        while ((match = QTY_PATTERN.exec(text)) !== null) {
            var labelPart = (match[1] || '').trim();
            var qty = match[2] ? match[2].replace(/,/g, '') : '';
            var descPart = (match[3] || '').trim();
            var unit = (match[4] || '').trim();
            var unitCostRaw = match[5] ? match[5].replace(/,/g, '') : '';
            var totalRaw = match[6] ? match[6].replace(/,/g, '') : '';

            if (!qty || parseFloat(qty) < 0.01) continue;

            // Build description: prefer label, fallback to descPart
            var desc = labelPart || descPart || '';
            desc = desc.replace(/\s*@.*$/, '').replace(/\s*=.*$/, '').replace(/\s*—.*$/, '').trim().slice(0, 80);
            if (!desc || desc.length < 3) continue;
            // Skip if it's just a number
            if (/^\d+$/.test(desc)) continue;

            // If we have unit from descPart and no unit, try to extract it
            if (!unit && descPart) {
                var uMatch = descPart.match(/\b(LF|CY|SF|SY|EA|LS|TN|GAL|VF|LB|CWT|TON|EACH|DAY|HR|HRS|ACRE|FT|IN|YD|SQFT|CUYD|LINFT)\b/i);
                if (uMatch) unit = uMatch[1].toUpperCase();
            }

            // Reconstruct unit cost / total if one is missing
            var unitCost = unitCostRaw ? parseFloat(unitCostRaw) : 0;
            var total = totalRaw ? parseFloat(totalRaw) : 0;
            var qtyNum = parseFloat(qty);
            if (unitCost && !total && qtyNum) total = Math.round(unitCost * qtyNum * 100) / 100;
            if (total && !unitCost && qtyNum) unitCost = Math.round(total / qtyNum * 100) / 100;

            var key = desc.toLowerCase().slice(0, 24) + '|' + qty;
            if (seen[key]) continue;
            seen[key] = true;

            items.push([
                desc,
                qty,
                unit,
                unitCost ? '$' + unitCost : '',
                total ? '$' + total : '',
                ''
            ]);
        }
        return items;
    }

    /**
     * Parse section headers from a markdown document.
     * Returns array of { level, title, startLine, endLine }
     */
    function parseMDSections(lines) {
        var sections = [];
        for (var i = 0; i < lines.length; i++) {
            var m = lines[i].match(/^(#{1,4})\s+(.+)/);
            if (m) sections.push({ level: m[1].length, title: m[2].trim(), startLine: i });
        }
        for (var j = 0; j < sections.length - 1; j++) {
            sections[j].endLine = sections[j + 1].startLine - 1;
        }
        if (sections.length) sections[sections.length - 1].endLine = lines.length - 1;
        return sections;
    }

    /**
     * Get the section title for a given line index.
     */
    function getSectionForLine(sections, lineIdx) {
        var title = '';
        for (var i = 0; i < sections.length; i++) {
            if (sections[i].startLine <= lineIdx) title = sections[i].title;
        }
        return title;
    }

    /**
     * Parse a number string → clean float, stripping $, commas.
     */
    function parseNum(s) {
        if (!s) return 0;
        return parseFloat(String(s).replace(/[$,\s]/g, '')) || 0;
    }

    /**
     * Format a number for CSV (no $ sign, 2 decimal places if fractional).
     */
    function fmtNum(n) {
        n = parseFloat(n) || 0;
        return n % 1 === 0 ? String(n) : n.toFixed(2);
    }

    /**
     * Quote a value for CSV output.
     */
    function csvCell(v) {
        var s = String(v == null ? '' : v);
        if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    /**
     * Core extraction engine.
     * Reads all text-based docs in a project and returns a Promise resolving to:
     * [{ desc, qty, unit, unitCost, total, notes, section, source }]
     */
    function extractBidItemsFromProject(projectId) {
        return getDocuments(projectId).then(function (docs) {
            var allItems = [];
            var promises = [];

            docs.forEach(function (doc) {
                var name = (doc.name || '').toLowerCase();
                var isText = /\.(md|txt|json|csv|tsv|markdown)$/i.test(name);
                var isCSV = /\.(csv|tsv)$/i.test(name);
                if (!isText || !doc.data) return;

                var p = new Promise(function (resolve) {
                    var text = ab2str(doc.data);
                    if (!text || text.trim().length < 5) return resolve([]);
                    var items = [];
                    var srcName = doc.name || 'file';

                    if (isCSV) {
                        // Parse existing CSV/TSV — pull rows that look like bid items
                        var csvRows = naiveParseCSV(text);
                        if (csvRows.length > 1 && isBidTable(csvRows[0])) {
                            var headers = csvRows[0].map(normalizeHeader);
                            csvRows.slice(1).forEach(function (r) {
                                if (!r || r.every(function (c) { return !c; })) return;
                                var getCol = function (stdName) {
                                    var hi = headers.indexOf(stdName);
                                    return hi >= 0 ? (r[hi] || '').trim() : '';
                                };
                                var desc = getCol('Item / Description');
                                if (!desc) return;
                                var qtyRaw = getCol('Qty');
                                var unit = getCol('Unit');
                                var ucRaw = getCol('Unit Cost');
                                var totRaw = getCol('Total');
                                var notes = getCol('Notes');
                                var qty = parseNum(qtyRaw);
                                var uc = parseNum(ucRaw);
                                var tot = parseNum(totRaw);
                                if (!tot && qty && uc) tot = Math.round(qty * uc * 100) / 100;
                                if (!uc && qty && tot) uc = Math.round(tot / qty * 100) / 100;
                                items.push({ desc: desc, qty: qty || qtyRaw, unit: unit, unitCost: uc, total: tot, notes: notes, section: '', source: srcName });
                            });
                        }
                        return resolve(items);
                    }

                    // Markdown / text — scan section headers, tables, and inline patterns
                    var lines = text.split('\n');
                    var mdSections = parseMDSections(lines);
                    var i = 0;
                    while (i < lines.length) {
                        var line = lines[i];
                        // Markdown table
                        if (/^\|/.test(line) && !/^\|[\s|:-]+\|$/.test(line.trim())) {
                            var tbl = extractMDTable(lines, i);
                            if (tbl && tbl.rows.length > 0) {
                                var normH = tbl.headers.map(normalizeHeader);
                                var curSection = getSectionForLine(mdSections, i);
                                tbl.rows.forEach(function (r) {
                                    if (r.every(function (c) { return !c; })) return;
                                    var getC = function (stdName) {
                                        var hi = normH.indexOf(stdName);
                                        return hi >= 0 ? (r[hi] || '').trim() : '';
                                    };
                                    var desc = getC('Item / Description');
                                    if (!desc) desc = r.filter(Boolean).join(' | ').slice(0, 80);
                                    if (!desc) return;
                                    var qtyRaw = getC('Qty');
                                    var unit = getC('Unit');
                                    var ucRaw = getC('Unit Cost');
                                    var totRaw = getC('Total');
                                    var notes = getC('Notes') || (r._section || '');
                                    var qty = parseNum(qtyRaw);
                                    var uc = parseNum(ucRaw);
                                    var tot = parseNum(totRaw);
                                    if (!tot && qty && uc) tot = Math.round(qty * uc * 100) / 100;
                                    if (!uc && qty && tot) uc = Math.round(tot / qty * 100) / 100;
                                    items.push({ desc: desc, qty: qty || qtyRaw, unit: unit, unitCost: uc, total: tot, notes: notes, section: curSection, source: srcName });
                                });
                                // Advance past table
                                while (i < lines.length && /^\|/.test(lines[i])) i++;
                                continue;
                            }
                        }
                        i++;
                    }

                    // Inline quantity lines from free text
                    var inlineItems = extractInlineItems(text);
                    inlineItems.forEach(function (item) {
                        var desc = item[0];
                        var alreadyFound = items.some(function (r) {
                            return r.desc.toLowerCase().slice(0, 18) === desc.toLowerCase().slice(0, 18);
                        });
                        if (alreadyFound) return;
                        var qty = parseNum(item[1]);
                        var uc = parseNum(item[3]);
                        var tot = parseNum(item[4]);
                        if (!tot && qty && uc) tot = Math.round(qty * uc * 100) / 100;
                        if (!uc && qty && tot) uc = Math.round(tot / qty * 100) / 100;
                        items.push({ desc: desc, qty: qty || item[1], unit: item[2], unitCost: uc, total: tot, notes: '', section: '', source: srcName });
                    });

                    resolve(items);
                });
                promises.push(p);
            });

            return Promise.all(promises).then(function (results) {
                results.forEach(function (items) { allItems = allItems.concat(items); });
                // De-duplicate by description (first 24 chars, case-insensitive)
                var seen = {};
                allItems = allItems.filter(function (item) {
                    var key = (item.desc || '').toLowerCase().slice(0, 24) + '|' + String(item.qty || '');
                    if (seen[key] || !item.desc) return false;
                    seen[key] = true;
                    return true;
                });
                // Number the items
                allItems.forEach(function (item, idx) { item.itemNo = idx + 1; });
                return allItems;
            });
        });
    }

    /**
     * Generic CSV scan: extract bid items → MudRag standard CSV → save + open in viewer.
     */
    function scanProjectForCSV(projectId, messageWrap) {
        if (!projectId) return;

        extractBidItemsFromProject(projectId).then(function (items) {
            if (items.length === 0) {
                if (messageWrap) {
                    var hint = document.createElement('p');
                    hint.style.cssText = 'color:var(--text-secondary);font-size:0.875rem;margin-top:8px;';
                    hint.textContent = 'No bid items found in your project files yet. Run an estimate (e.g. "Estimate 1,500 LF of 8" sewer") or upload a document with quantities, then try again.';
                    messageWrap.appendChild(hint);
                }
                return;
            }
            persistProjectBidItems(projectId, items, {
                source: 'scan_project_docs',
                parsed_rows: items.length,
                mapped_valid_bid_items: items.length
            });

            var header = ['Item #', 'Item / Description', 'Qty', 'Unit', 'Unit Cost', 'Total', 'Notes', 'Section', 'Source'].map(csvCell).join(',');
            var csvLines = items.map(function (item) {
                return [
                    item.itemNo,
                    csvCell(item.desc),
                    csvCell(fmtNum(item.qty)),
                    csvCell(item.unit),
                    csvCell(item.unitCost ? fmtNum(item.unitCost) : ''),
                    csvCell(item.total ? fmtNum(item.total) : ''),
                    csvCell(item.notes),
                    csvCell(item.section),
                    csvCell(item.source)
                ].join(',');
            });
            var csvText = header + '\n' + csvLines.join('\n');
            var today = new Date().toISOString().slice(0, 10);
            var csvName = 'Bid Items - ' + today + '.csv';
            saveCsvAndOpen(projectId, csvName, csvText, items.length, messageWrap, 'Bid Items');
        });
    }

    /**
     * Export to HCSS HeavyBid import format.
     * Columns: Item No.,Description,Quantity,Unit,Unit Price,Amount,Section,Notes
     * Rules: no $ signs; plain decimal numbers; amount = qty × unit price.
     */
    function exportToHCSS(projectId, messageWrap) {
        if (!projectId) return;

        extractBidItemsFromProject(projectId).then(function (items) {
            if (items.length === 0) {
                appendStatusMsg(messageWrap, 'No bid items found in project files. Upload a take-off, estimate, or quantity sheet and try again.', false);
                return;
            }
            persistProjectBidItems(projectId, items, {
                source: 'hcss_export',
                parsed_rows: items.length,
                mapped_valid_bid_items: items.length
            });

            // HCSS HeavyBid CSV column specification
            var header = [
                'Item No.', 'Description', 'Quantity', 'Unit',
                'Unit Price', 'Amount', 'Section', 'Notes'
            ].map(csvCell).join(',');

            var csvLines = items.map(function (item) {
                var qty = parseFloat(item.qty) || 0;
                var uc = item.unitCost ? parseFloat(item.unitCost) : 0;
                var amt = item.total ? parseFloat(item.total) : (qty && uc ? Math.round(qty * uc * 100) / 100 : 0);
                // If we only have a total but not a unit price, derive unit price
                if (!uc && amt && qty) uc = Math.round(amt / qty * 100) / 100;
                return [
                    csvCell(item.itemNo),
                    csvCell(item.desc),
                    csvCell(qty ? fmtNum(qty) : ''),
                    csvCell(item.unit),
                    csvCell(uc ? fmtNum(uc) : ''),
                    csvCell(amt ? fmtNum(amt) : ''),
                    csvCell(item.section),
                    csvCell(item.notes)
                ].join(',');
            });

            var csvText = header + '\n' + csvLines.join('\n');
            var today = new Date().toISOString().slice(0, 10);
            var csvName = 'HCSS HeavyBid Import - ' + today + '.csv';
            saveCsvAndOpen(projectId, csvName, csvText, items.length, messageWrap, 'HCSS HeavyBid');
        });
    }

    /**
     * Export to Bid2Win import format.
     * Columns: Item No,Item Code,Description,Quantity,Unit,Unit Price,Amount,Category,Notes
     * Item Code is left blank unless a DOT pay item code can be detected in the description.
     */
    function exportToBid2Win(projectId, messageWrap) {
        if (!projectId) return;

        extractBidItemsFromProject(projectId).then(function (items) {
            if (items.length === 0) {
                appendStatusMsg(messageWrap, 'No bid items found in project files. Upload a take-off, estimate, or quantity sheet and try again.', false);
                return;
            }
            persistProjectBidItems(projectId, items, {
                source: 'bid2win_export',
                parsed_rows: items.length,
                mapped_valid_bid_items: items.length
            });

            // Bid2Win column specification
            var header = [
                'Item No', 'Item Code', 'Description', 'Quantity', 'Unit',
                'Unit Price', 'Amount', 'Category', 'Notes'
            ].map(csvCell).join(',');

            var csvLines = items.map(function (item) {
                var qty = parseFloat(item.qty) || 0;
                var uc = item.unitCost ? parseFloat(item.unitCost) : 0;
                var amt = item.total ? parseFloat(item.total) : (qty && uc ? Math.round(qty * uc * 100) / 100 : 0);
                if (!uc && amt && qty) uc = Math.round(amt / qty * 100) / 100;

                // Try to extract a DOT pay item code from the description
                // Common formats: "202-0100", "713-01", "A-1", etc.
                var itemCode = '';
                var codeMatch = item.desc.match(/\b(\d{3,4}-\d{2,4}[A-Z]?)\b/);
                if (codeMatch) {
                    itemCode = codeMatch[1];
                }

                // Category: derive from section or unit type
                var category = item.section || deriveBid2WinCategory(item.desc, item.unit);

                return [
                    csvCell(item.itemNo),
                    csvCell(itemCode),
                    csvCell(item.desc),
                    csvCell(qty ? fmtNum(qty) : ''),
                    csvCell(item.unit),
                    csvCell(uc ? fmtNum(uc) : ''),
                    csvCell(amt ? fmtNum(amt) : ''),
                    csvCell(category),
                    csvCell(item.notes)
                ].join(',');
            });

            var csvText = header + '\n' + csvLines.join('\n');
            var today = new Date().toISOString().slice(0, 10);
            var csvName = 'Bid2Win Import - ' + today + '.csv';
            saveCsvAndOpen(projectId, csvName, csvText, items.length, messageWrap, 'Bid2Win');
        });
    }

    /**
     * Derive a Bid2Win work category from description + unit keywords.
     */
    function deriveBid2WinCategory(desc, unit) {
        var d = (desc || '').toLowerCase();
        if (/pipe|waterline|water\s*main|sewer|storm|culvert|hdpe|pvc|ductile/.test(d)) return 'Underground Utilities';
        if (/concrete|curb|gutter|sidewalk|pavement|slab|footin|found/.test(d)) return 'Concrete';
        if (/asphalt|pavin|base\s*course|subgrade|hma|ac/.test(d)) return 'Paving';
        if (/excavat|earthwork|gradin|embankment|fill|cut|haul/.test(d)) return 'Earthwork';
        if (/valve|hydrant|fitting|service|meter|manhole|structure/.test(d)) return 'Structures';
        if (/traffic|sign|stripe|marking|signal/.test(d)) return 'Traffic Control';
        if (/mobiliz|demobiliz|general|bonds|insurance|overhead/.test(d)) return 'General';
        if (/landscap|reveget|seeding|erosion|silt/.test(d)) return 'Landscaping';
        if (/electric|conduit|wire|pull\s*box|junction/.test(d)) return 'Electrical';
        if (unit && /ls|ea|each/i.test(unit)) return 'General';
        return 'Construction';
    }

    /**
     * Shared helper: save a CSV string as a project document, open it, and update the message wrap.
     */
    function saveCsvAndOpen(projectId, csvName, csvText, itemCount, messageWrap, formatLabel) {
        var blob = new Blob([csvText], { type: 'text/csv' });
        var file = new File([blob], csvName, { type: 'text/csv' });
        var csvBuffer = new TextEncoder().encode(csvText).buffer;
        getDocuments(projectId).then(function (docs) {
            var existing = (docs || []).find(function (d) { return (d.name || '').toLowerCase() === (csvName || '').toLowerCase(); });
            if (existing) {
                return updateDocumentContent(existing.id, csvBuffer).then(function () {
                    return { docId: existing.id, updated: true };
                });
            }
            return saveDocument(projectId, file).then(function (docId) {
                return { docId: docId, updated: false };
            });
        }).then(function (saveResult) {
            var docId = saveResult.docId;
            _lastCreatedCSVDocId = docId;
            _lastCreatedDocId = docId;
            renderDocuments();
            showToast((saveResult.updated ? 'Updated ' : 'Exported ') + itemCount + ' item' + (itemCount !== 1 ? 's' : '') + ' → "' + csvName + '"');

            getDocuments(projectId).then(function (freshDocs) {
                var created = freshDocs.find(function (d) { return d.id === docId; });
                if (created && window.mudrag && window.mudrag.openDocument) {
                    window.mudrag.openDocument(created);
                }
            });

            appendStatusMsg(
                messageWrap,
                '✓ Read project files → parsed ' + itemCount + ' row' + (itemCount !== 1 ? 's' : '') + ' → mapped '
                + itemCount + ' valid bid item' + (itemCount !== 1 ? 's' : '') + ' → '
                + (saveResult.updated ? 'updated' : 'saved as') + ' "' + csvName + '" (' + formatLabel + ' format) and opened in the document viewer.',
                true
            );
        });
    }

    /**
     * Append a status line to a message wrap element.
     */
    function appendStatusMsg(wrap, msg, success) {
        if (!wrap) return;
        var p = document.createElement('p');
        p.style.cssText = 'font-size:0.875rem;margin-top:8px;color:' + (success ? 'var(--accent)' : 'var(--text-secondary)') + ';';
        p.textContent = msg;
        wrap.appendChild(p);
    }

    var _lastCreatedCSVDocId_placeholder = null; // referenced from renderMessageContent above

    // Global Cmd+C / Cmd+V on document list
    document.addEventListener('keydown', function (e) {
        var isMac = navigator.platform.indexOf('Mac') >= 0;
        var mod = isMac ? e.metaKey : e.ctrlKey;
        if (!mod) return;
        if (e.key === 'd' || e.key === 'D') {
            var selectedIds = getSelectedDocumentIds();
            if (selectedIds.length > 0) {
                e.preventDefault();
                deleteSelectedDocuments();
            }
            return;
        }
        var activeItem = document.querySelector('.document-item.document-item-active');
        if (e.key === 'c' && activeItem) {
            var docId = activeItem.getAttribute('data-doc-id');
            if (docId) {
                getDocuments(activeProjectId).then(function (docs) {
                    var doc = docs.find(function (d) { return d.id === docId; });
                    if (doc) {
                        docClipboard = { type: 'doc', doc: doc };
                        showToast('Copied "' + doc.name + '" — switch projects and Cmd+V to paste');
                    }
                });
            }
        }
        if (e.key === 'v' && docClipboard && activeProjectId) {
            pasteClipboard();
        }
    });

    function refreshDocumentViews() {
        return Promise.resolve(renderDocuments()).then(function () {
            if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
        });
    }

    var _lastDuplicateDeletionBatch = null;

    function restoreDocumentsBatch(docsBatch) {
        if (!docsBatch || docsBatch.length === 0) return Promise.resolve(0);
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(DOC_STORE, 'readwrite');
                var store = tx.objectStore(DOC_STORE);
                docsBatch.forEach(function (doc) {
                    try { store.put(doc); } catch (e) { /* ignore individual restore failures */ }
                });
                tx.oncomplete = function () { resolve(docsBatch.length); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function undoDuplicateDeletionBatch() {
        if (!_lastDuplicateDeletionBatch || _lastDuplicateDeletionBatch.length === 0) {
            addMessage('assistant', 'No duplicate cleanup action is available to undo.');
            return;
        }
        var batch = _lastDuplicateDeletionBatch.slice();
        restoreDocumentsBatch(batch).then(function () {
            _lastDuplicateDeletionBatch = null;
            return refreshDocumentViews();
        }).then(function () {
            addMessage('assistant', 'Restored ' + batch.length + ' duplicate file' + (batch.length !== 1 ? 's' : '') + ' from the last cleanup.');
        }).catch(function () {
            addMessage('assistant', 'Could not restore deleted duplicates. Please try again.');
        });
    }

    function showConfirmDeleteModal(titleText, descText, onConfirm, opts) {
        var modal = document.getElementById('modal-confirm-delete');
        var title = document.getElementById('confirm-delete-title');
        var desc = document.getElementById('confirm-delete-desc');
        var btnOk = document.getElementById('btn-confirm-delete-ok');
        var btnCancel = document.getElementById('btn-confirm-delete-cancel');
        if (!modal) { if (onConfirm) onConfirm(); return; }
        if (title) title.textContent = titleText;
        if (desc) desc.textContent = descText;
        var parentModalId = opts && opts.parentModalId ? opts.parentModalId : null;
        var parentModal = parentModalId ? document.getElementById(parentModalId) : null;
        if (parentModal && !parentModal.hidden) modal.classList.add('modal-overlay-top');
        modal.hidden = false;
        function cleanup() {
            modal.hidden = true;
            modal.classList.remove('modal-overlay-top');
            btnOk.removeEventListener('click', doOk);
            btnCancel.removeEventListener('click', doCancel);
        }
        function doOk() { cleanup(); if (onConfirm) onConfirm(); }
        function doCancel() { cleanup(); }
        btnOk.addEventListener('click', doOk);
        btnCancel.addEventListener('click', doCancel);
    }

    function confirmDeleteDocument(doc, onConfirm, opts) {
        return showConfirmDeleteModal(
            'Delete "' + (doc.name || 'this file') + '"?',
            'This will permanently remove the file from your project. This cannot be undone.',
            onConfirm,
            opts
        );
    }

    function confirmDeleteFolder(folder, onConfirm, opts) {
        return showConfirmDeleteModal(
            'Delete folder "' + (folder.name || 'this folder') + '"?',
            'This will permanently remove the folder and all files inside it. This cannot be undone.',
            onConfirm,
            opts
        );
    }

    function findAndShowDuplicates() {
        if (!activeProjectId) { addMessage('assistant', 'Select a project first.'); return; }
        getDocuments(activeProjectId).then(function (docs) {
            var groups = {};
            docs.forEach(function (d) {
                var key = (d.name || '').toLowerCase().trim();
                if (!groups[key]) groups[key] = [];
                groups[key].push(d);
            });
            var dupes = Object.values(groups).filter(function (g) { return g.length > 1; });
            var modal = document.getElementById('modal-duplicates');
            var listEl = document.getElementById('duplicates-list');
            var subtitle = document.getElementById('duplicates-subtitle');
            var btnClose = document.getElementById('btn-duplicates-close');
            var btnDeleteAll = document.getElementById('btn-duplicates-delete-all');
            if (!modal || !listEl) return;
            if (dupes.length === 0) {
                addMessage('assistant', 'No duplicate files found in your project. All files have unique names.');
                return;
            }
            if (subtitle) subtitle.textContent = 'Found ' + dupes.length + ' set' + (dupes.length !== 1 ? 's' : '') + ' of duplicates. Choose which copies to delete, or delete individually.';
            listEl.innerHTML = '';
            var duplicateDocById = {};
            var selectedDeleteIds = {};
            function getSelectedDuplicates() {
                return Object.keys(selectedDeleteIds).filter(function (docId) { return !!selectedDeleteIds[docId]; }).map(function (docId) { return duplicateDocById[docId]; }).filter(Boolean);
            }
            function updateBulkDeleteButton() {
                if (!btnDeleteAll) return;
                var selectedCount = getSelectedDuplicates().length;
                btnDeleteAll.textContent = selectedCount > 0 ? 'Delete Selected (' + selectedCount + ')' : 'Delete Selected';
                btnDeleteAll.disabled = selectedCount === 0;
            }
            dupes.forEach(function (group) {
                var groupEl = document.createElement('div');
                groupEl.className = 'dupe-group';
                var headEl = document.createElement('div');
                headEl.className = 'dupe-group-name';
                headEl.textContent = group[0].name + ' (' + group.length + ' copies)';
                groupEl.appendChild(headEl);
                group.forEach(function (doc, idx) {
                    var row = document.createElement('div');
                    row.className = 'dupe-row';
                    var info = document.createElement('span');
                    info.className = 'dupe-info';
                    info.textContent = (idx === 0 ? 'Keep' : 'Copy ' + idx) + ' — ' + formatSize(doc.size || 0);
                    var controls = document.createElement('div');
                    controls.className = 'dupe-controls';
                    var btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn-dupe-delete btn-danger-sm';
                    btn.textContent = idx === 0 ? 'Keep' : 'Delete';
                    btn.disabled = idx === 0;
                    if (idx > 0) {
                        duplicateDocById[doc.id] = doc;
                        selectedDeleteIds[doc.id] = true;
                        var selectLabel = document.createElement('label');
                        selectLabel.className = 'dupe-select-label';
                        var checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.className = 'dupe-select-checkbox';
                        checkbox.checked = true;
                        checkbox.setAttribute('aria-label', 'Select duplicate "' + (doc.name || 'file') + '" for delete');
                        checkbox.addEventListener('change', function () {
                            selectedDeleteIds[doc.id] = checkbox.checked;
                            updateBulkDeleteButton();
                        });
                        selectLabel.appendChild(checkbox);
                        selectLabel.appendChild(document.createTextNode('Select'));
                        controls.appendChild(selectLabel);
                        btn.addEventListener('click', function () {
                            deleteDocument(doc.id).then(function () {
                                delete selectedDeleteIds[doc.id];
                                delete duplicateDocById[doc.id];
                                row.remove();
                                updateBulkDeleteButton();
                                return refreshDocumentViews();
                            }).catch(function () {
                                addMessage('assistant', 'Could not delete "' + (doc.name || 'file') + '". Please try again.');
                            });
                        });
                    }
                    controls.appendChild(btn);
                    row.appendChild(info);
                    row.appendChild(controls);
                    groupEl.appendChild(row);
                });
                listEl.appendChild(groupEl);
            });
            modal.hidden = false;
            if (btnClose) {
                btnClose.onclick = function () { modal.hidden = true; };
            }
            if (btnDeleteAll) {
                updateBulkDeleteButton();
                btnDeleteAll.onclick = function () {
                    var selectedDocs = getSelectedDuplicates();
                    if (!selectedDocs.length) { return; }
                    var deleteCount = selectedDocs.length;
                    showConfirmDeleteModal(
                        'Delete selected duplicates?',
                        'This will permanently remove ' + deleteCount + ' selected duplicate file' + (deleteCount !== 1 ? 's' : '') + '. This cannot be undone.',
                        function () {
                        _lastDuplicateDeletionBatch = selectedDocs.map(function (d) { return Object.assign({}, d); });
                        modal.hidden = true;
                        Promise.all(selectedDocs.map(function (d) { return deleteDocument(d.id); })).then(function () {
                            return refreshDocumentViews();
                        }).then(function () {
                            var undoActions = [{ label: 'Undo Delete', text: '__undo_duplicate_delete__' }];
                            addMessage('assistant', 'Deleted ' + deleteCount + ' duplicate file' + (deleteCount !== 1 ? 's' : '') + '. Your project is clean.\n\n[MUDRAG_ACTIONS]' + JSON.stringify(undoActions) + '[/MUDRAG_ACTIONS]');
                        }).catch(function () {
                            addMessage('assistant', 'Some duplicate files could not be deleted. Please try again.');
                        });
                        },
                        { parentModalId: 'modal-duplicates' }
                    );
                };
            }
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

    var selectedDocumentIds = {};
    var documentSelectionAnchorId = null;

    function getSelectedDocumentIds() {
        return Object.keys(selectedDocumentIds).filter(function (id) { return !!selectedDocumentIds[id]; });
    }

    function isDocumentSelected(docId) {
        return !!selectedDocumentIds[String(docId || '')];
    }

    function syncDocumentSelectionUI() {
        var selectedIds = getSelectedDocumentIds();
        var activeId = null;
        if (documentSelectionAnchorId && selectedDocumentIds[documentSelectionAnchorId]) {
            activeId = documentSelectionAnchorId;
        } else if (selectedIds.length > 0) {
            activeId = selectedIds[0];
            documentSelectionAnchorId = activeId;
        }
        document.querySelectorAll('.document-item').forEach(function (el) {
            var id = el.getAttribute('data-doc-id');
            var selected = !!(id && selectedDocumentIds[id]);
            el.classList.toggle('document-item-selected', selected);
            el.classList.toggle('document-item-active', !!(selected && activeId && id === activeId));
            if (selected) el.setAttribute('aria-selected', 'true');
            else el.removeAttribute('aria-selected');
        });
    }

    function clearDocumentSelection() {
        selectedDocumentIds = {};
        documentSelectionAnchorId = null;
        syncDocumentSelectionUI();
    }

    function selectSingleDocument(docId) {
        var key = String(docId || '');
        if (!key) return;
        selectedDocumentIds = {};
        selectedDocumentIds[key] = true;
        documentSelectionAnchorId = key;
        syncDocumentSelectionUI();
    }

    function toggleDocumentSelection(docId) {
        var key = String(docId || '');
        if (!key) return;
        if (selectedDocumentIds[key]) delete selectedDocumentIds[key];
        else selectedDocumentIds[key] = true;
        documentSelectionAnchorId = key;
        syncDocumentSelectionUI();
    }

    function selectDocumentRange(docId) {
        var targetId = String(docId || '');
        if (!targetId) return;
        var rows = Array.prototype.slice.call(document.querySelectorAll('#documents-list .document-item'));
        if (!rows.length) return;
        var targetIdx = rows.findIndex(function (row) { return row.getAttribute('data-doc-id') === targetId; });
        if (targetIdx < 0) return;
        var anchorId = documentSelectionAnchorId || targetId;
        var anchorIdx = rows.findIndex(function (row) { return row.getAttribute('data-doc-id') === anchorId; });
        if (anchorIdx < 0) anchorIdx = targetIdx;
        var start = Math.min(anchorIdx, targetIdx);
        var end = Math.max(anchorIdx, targetIdx);
        selectedDocumentIds = {};
        for (var i = start; i <= end; i++) {
            var id = rows[i].getAttribute('data-doc-id');
            if (id) selectedDocumentIds[id] = true;
        }
        documentSelectionAnchorId = targetId;
        syncDocumentSelectionUI();
    }

    function deleteSelectedDocuments(opts) {
        if (!activeProjectId) return;
        getDocuments(activeProjectId).then(function (docs) {
            var selected = docs.filter(function (d) { return !!selectedDocumentIds[d.id]; });
            if (!selected.length) return;
            var deleteCount = selected.length;
            showConfirmDeleteModal(
                'Delete selected files?',
                'This will permanently remove ' + deleteCount + ' selected file' + (deleteCount !== 1 ? 's' : '') + ' from your project. This cannot be undone.',
                function () {
                    Promise.all(selected.map(function (d) { return deleteDocument(d.id); })).then(function () {
                        clearDocumentSelection();
                        return refreshDocumentViews();
                    });
                },
                opts
            );
        });
    }

    function showDocumentContextMenu(e, doc, li) {
        e.preventDefault();
        if (!isDocumentSelected(doc.id)) {
            selectSingleDocument(doc.id);
        } else {
            syncDocumentSelectionUI();
        }
        var selectedCount = getSelectedDocumentIds().length;
        var existing = document.getElementById('document-context-menu');
        if (existing) existing.remove();
        var menu = document.createElement('div');
        menu.id = 'document-context-menu';
        menu.className = 'project-context-menu';
        var pasteLabel = docClipboard ? 'Paste "' + ((docClipboard.doc && docClipboard.doc.name) || (docClipboard.folder && docClipboard.folder.name) || 'item') + '"' : null;
        if (selectedCount > 1) {
            menu.innerHTML =
                '<button type="button" class="project-context-item project-context-item-danger" data-action="delete-selected">Delete Selected (' + selectedCount + ')  <span class="ctx-kbd">⌘D</span></button>' +
                '<div class="project-context-divider"></div>' +
                '<button type="button" class="project-context-item" data-action="clear-selection">Clear Selection</button>';
        } else {
            menu.innerHTML = '<button type="button" class="project-context-item" data-action="open">Open Document</button>' +
                '<div class="project-context-divider"></div>' +
                '<button type="button" class="project-context-item" data-action="copy">Copy  <span class="ctx-kbd">⌘C</span></button>' +
                (pasteLabel ? '<button type="button" class="project-context-item" data-action="paste">' + pasteLabel + '  <span class="ctx-kbd">⌘V</span></button>' : '') +
                '<div class="project-context-divider"></div>' +
                '<button type="button" class="project-context-item" data-action="rename">Rename</button>' +
                '<button type="button" class="project-context-item" data-action="download">Download</button>' +
                '<button type="button" class="project-context-item project-context-item-danger" data-action="delete">Delete</button>';
        }
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        document.body.appendChild(menu);
        var deleteSelectedBtn = menu.querySelector('[data-action="delete-selected"]');
        if (deleteSelectedBtn) {
            deleteSelectedBtn.addEventListener('click', function () {
                menu.remove();
                deleteSelectedDocuments();
            });
        }
        var clearSelectionBtn = menu.querySelector('[data-action="clear-selection"]');
        if (clearSelectionBtn) {
            clearSelectionBtn.addEventListener('click', function () {
                menu.remove();
                clearDocumentSelection();
            });
        }
        var openBtn = menu.querySelector('[data-action="open"]');
        if (openBtn) openBtn.addEventListener('click', function () {
            menu.remove();
            selectSingleDocument(doc.id);
            if (window.mudrag && window.mudrag.openDocument) window.mudrag.openDocument(doc);
        });
        var copyBtn = menu.querySelector('[data-action="copy"]');
        if (copyBtn) copyBtn.addEventListener('click', function () {
            menu.remove();
            docClipboard = { type: 'doc', doc: doc };
            showToast('Copied "' + doc.name + '" — switch projects then Cmd+V to paste');
        });
        var pasteBtn = menu.querySelector('[data-action="paste"]');
        if (pasteBtn) {
            pasteBtn.addEventListener('click', function () {
                menu.remove();
                pasteClipboard();
            });
        }
        var renameBtn = menu.querySelector('[data-action="rename"]');
        if (renameBtn) renameBtn.addEventListener('click', function () {
            menu.remove();
            var nameEl = li && li.querySelector('.document-name');
            if (nameEl) startRenameDocument(doc.id, nameEl, doc.name);
        });
        var downloadBtn = menu.querySelector('[data-action="download"]');
        if (downloadBtn) downloadBtn.addEventListener('click', function () {
            menu.remove();
            downloadDocument(doc);
        });
        var deleteBtn = menu.querySelector('[data-action="delete"]');
        if (deleteBtn) deleteBtn.addEventListener('click', function () {
            menu.remove();
            deleteDocument(doc.id).then(function () {
                clearDocumentSelection();
                renderDocuments();
                if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
            });
        });
        function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
        setTimeout(function () { document.addEventListener('click', closeMenu); }, 0);
    }

    var SVG_CHEVRON = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var SVG_FOLDER  = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 10.12 3.5H13A1.5 1.5 0 0 1 14.5 5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V3z"/></svg>';

    function fileIconSVG(name) {
        var ext = (name || '').split('.').pop().toLowerCase();
        var color = '#888';
        var path = '<path d="M4 1.5A1.5 1.5 0 0 1 5.5 0h5.586a1 1 0 0 1 .707.293l2.914 2.914A1 1 0 0 1 15 3.914V14.5A1.5 1.5 0 0 1 13.5 16h-8A1.5 1.5 0 0 1 4 14.5v-13z" fill="currentColor"/>';
        if (ext === 'pdf') { color = '#e24d4d'; }
        else if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') { color = '#3fa46a'; }
        else if (ext === 'md' || ext === 'txt') { color = '#7aacdf'; }
        else if (ext === 'json') { color = '#e5a64d'; }
        else if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp') { color = '#b07ee8'; }
        else if (ext === 'docx' || ext === 'doc') { color = '#5a8fdf'; }
        return '<svg width="14" height="14" viewBox="0 0 16 16" style="color:' + color + '">' + path + '</svg>';
    }

    function renderDocItem(doc, listEl, docs) {
        var li = document.createElement('div');
        li.className = 'document-item';
        li.draggable = true;
        li.setAttribute('role', 'option');
        li.innerHTML =
            '<span class="document-file-icon">' + fileIconSVG(doc.name) + '</span>' +
            '<span class="document-name" title="' + (doc.name || '').replace(/"/g, '&quot;') + '">' + (doc.name || 'Document') + '</span>' +
            '<span class="document-size">' + formatSize(doc.size || 0) + '</span>' +
            '<button type="button" class="btn-delete-doc" title="Delete">×</button>';
        li.setAttribute('data-doc-id', doc.id);
        listEl.appendChild(li);
        li.style.cursor = 'pointer';

        var clickTimer = null;
        li.addEventListener('dragstart', function (e) {
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
            e.dataTransfer.setData('text/plain', doc.id);
            e.dataTransfer.effectAllowed = 'copyMove';
            li.classList.add('document-item-dragging');
        });
        li.addEventListener('dragend', function () {
            li.classList.remove('document-item-dragging');
        });
        li.addEventListener('click', function (e) {
            if (li.querySelector('input')) return;
            var isToggle = !!(e.metaKey || e.ctrlKey);
            if (e.shiftKey) {
                if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                selectDocumentRange(doc.id);
                return;
            }
            if (isToggle) {
                if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                toggleDocumentSelection(doc.id);
                return;
            }
            if (clickTimer) return;
            clickTimer = setTimeout(function () {
                clickTimer = null;
                selectSingleDocument(doc.id);
                if (window.mudrag && window.mudrag.openDocument) window.mudrag.openDocument(doc);
            }, 220);
        });
        li.addEventListener('dblclick', function (e) {
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
            var nameEl = li.querySelector('.document-name');
            if (nameEl) startRenameDocument(doc.id, nameEl, doc.name);
        });
        li.addEventListener('contextmenu', function (e) {
            showDocumentContextMenu(e, doc, li);
        });
        var delBtn = li.querySelector('.btn-delete-doc');
        if (delBtn) {
            delBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (isDocumentSelected(doc.id) && getSelectedDocumentIds().length > 1) {
                    deleteSelectedDocuments();
                    return;
                }
                deleteDocument(doc.id).then(function () {
                    clearDocumentSelection();
                    renderDocuments();
                    if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
                });
            });
        }
    }

    function makeFolderHeaderDroppable(headerEl, folderId) {
        headerEl.setAttribute('data-drop-folder-id', folderId || 'root');
        headerEl.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            headerEl.classList.add('document-folder-drop-target');
        });
        headerEl.addEventListener('dragleave', function (e) {
            if (!headerEl.contains(e.relatedTarget)) {
                headerEl.classList.remove('document-folder-drop-target');
            }
        });
        headerEl.addEventListener('drop', function (e) {
            e.preventDefault();
            headerEl.classList.remove('document-folder-drop-target');
            var docId = e.dataTransfer.getData('text/plain');
            if (!docId) return;
            var targetFolderId = (folderId === 'root' || !folderId) ? null : folderId;
            moveDocumentToFolder(docId, targetFolderId).then(function () {
                renderDocuments();
                if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
            });
        });
    }

    function renderDocuments() {
        var listEl = document.getElementById('documents-list');
        var hintEl = document.getElementById('documents-hint');
        var uploadLabel = document.querySelector('.btn-upload');
        var btnNewFolder = document.getElementById('btn-new-folder');
        if (!listEl || !hintEl) return;

        if (!activeProjectId) {
            listEl.innerHTML = '';
            clearDocumentSelection();
            hintEl.textContent = 'Select a project to add documents';
            hintEl.hidden = false;
            if (uploadLabel) uploadLabel.style.pointerEvents = 'none';
            if (btnNewFolder) btnNewFolder.style.pointerEvents = 'none';
            return;
        }

        if (uploadLabel) uploadLabel.style.pointerEvents = '';
        if (btnNewFolder) btnNewFolder.style.pointerEvents = '';

        return Promise.all([getFolders(activeProjectId), getDocuments(activeProjectId)]).then(function (arr) {
            var folders = arr[0];
            var docs = arr[1];
            var validById = {};
            docs.forEach(function (d) { validById[d.id] = true; });
            Object.keys(selectedDocumentIds).forEach(function (id) {
                if (!validById[id]) delete selectedDocumentIds[id];
            });
            if (documentSelectionAnchorId && !validById[documentSelectionAnchorId]) {
                documentSelectionAnchorId = null;
            }
            listEl.innerHTML = '';
            var rootDocs = docs.filter(function (d) { return !d.folderId; });
            var hasContent = folders.length > 0 || docs.length > 0;
            hintEl.textContent = hasContent ? '' : 'No documents. Click + Add to upload.';
            hintEl.hidden = hasContent;

            folders.forEach(function (folder) {
                var folderDocs = docs.filter(function (d) { return d.folderId === folder.id; });
                var folderEl = document.createElement('div');
                folderEl.className = 'document-folder';
                folderEl.setAttribute('data-folder-id', folder.id);
                var expanded = localStorage.getItem('mudrag_folder_expanded_' + folder.id) !== 'false';
                folderEl.innerHTML = '<div class="document-folder-header' + (expanded ? ' expanded' : '') + '">' +
                    '<span class="document-folder-toggle" aria-label="' + (expanded ? 'Collapse' : 'Expand') + '">' + SVG_CHEVRON + '</span>' +
                    '<span class="document-folder-icon">' + SVG_FOLDER + '</span>' +
                    '<span class="document-folder-name" title="' + (folder.name || '').replace(/"/g, '&quot;') + '">' + (folder.name || 'Folder') + '</span>' +
                    '<button type="button" class="btn-delete-folder" data-folder-id="' + folder.id + '" title="Delete folder">×</button>' +
                    '</div><div class="document-folder-body"' + (expanded ? '' : ' style="display:none;"') + '></div>';
                var body = folderEl.querySelector('.document-folder-body');
                folderDocs.forEach(function (doc) { renderDocItem(doc, body, docs); });
                folderEl.querySelector('.document-folder-header').addEventListener('click', function (e) {
                    if (e.target.classList.contains('btn-delete-folder')) return;
                    var wasExpanded = folderEl.querySelector('.document-folder-header').classList.contains('expanded');
                    var nowExpanded = !wasExpanded;
                    folderEl.querySelector('.document-folder-header').classList.toggle('expanded', nowExpanded);
                    folderEl.querySelector('.document-folder-body').style.display = nowExpanded ? '' : 'none';
                    try { localStorage.setItem('mudrag_folder_expanded_' + folder.id, String(nowExpanded)); } catch (err) {}
                });
                folderEl.querySelector('.btn-delete-folder').addEventListener('click', function (e) {
                    e.stopPropagation();
                    deleteFolder(folder.id).then(function () {
                        renderDocuments();
                        if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
                    });
                });
                // Right-click on folder header → context menu with Copy Folder
                folderEl.querySelector('.document-folder-header').addEventListener('contextmenu', function (e) {
                    if (e.target.classList.contains('btn-delete-folder')) return;
                    e.preventDefault();
                    var existing = document.getElementById('document-context-menu');
                    if (existing) existing.remove();
                    var fMenu = document.createElement('div');
                    fMenu.id = 'document-context-menu';
                    fMenu.className = 'project-context-menu';
                    fMenu.innerHTML = '<button type="button" class="project-context-item" data-action="copy-folder">Copy Folder  <span class="ctx-kbd">⌘C</span></button>' +
                        '<button type="button" class="project-context-item" data-action="rename-folder">Rename</button>' +
                        '<div class="project-context-divider"></div>' +
                        '<button type="button" class="project-context-item project-context-item-danger" data-action="delete-folder">Delete</button>';
                    fMenu.style.left = e.clientX + 'px';
                    fMenu.style.top = e.clientY + 'px';
                    document.body.appendChild(fMenu);
                    fMenu.querySelector('[data-action="copy-folder"]').addEventListener('click', function () {
                        fMenu.remove();
                        docClipboard = { type: 'folder', folder: folder, folderDocs: folderDocs };
                        showToast('Copied folder "' + folder.name + '" (' + folderDocs.length + ' files) — switch projects then Cmd+V to paste');
                    });
                    fMenu.querySelector('[data-action="rename-folder"]').addEventListener('click', function () {
                        fMenu.remove();
                        var nameEl = folderEl.querySelector('.document-folder-name');
                        if (nameEl) startRenameFolder(folder.id, nameEl);
                    });
                    fMenu.querySelector('[data-action="delete-folder"]').addEventListener('click', function () {
                        fMenu.remove();
                        deleteFolder(folder.id).then(function () {
                            renderDocuments();
                            if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
                        });
                    });
                    function closeFMenu() { fMenu.remove(); document.removeEventListener('click', closeFMenu); }
                    setTimeout(function () { document.addEventListener('click', closeFMenu); }, 0);
                });
                makeFolderHeaderDroppable(folderEl.querySelector('.document-folder-header'), folder.id);
                listEl.appendChild(folderEl);
            });

            var rootEl = document.createElement('div');
            rootEl.className = 'document-folder document-folder-root';
            rootEl.innerHTML = '<div class="document-folder-header expanded"><span class="document-folder-toggle" aria-label="Collapse">' + SVG_CHEVRON + '</span><span class="document-folder-name">Documents</span></div><div class="document-folder-body"></div>';
            var rootBody = rootEl.querySelector('.document-folder-body');
            rootDocs.forEach(function (doc) { renderDocItem(doc, rootBody, docs); });
            rootEl.querySelector('.document-folder-header').addEventListener('click', function (e) {
                var body = rootEl.querySelector('.document-folder-body');
                var isHidden = body.style.display === 'none';
                body.style.display = isHidden ? '' : 'none';
                rootEl.querySelector('.document-folder-header').classList.toggle('expanded', isHidden);
            });
            makeFolderHeaderDroppable(rootEl.querySelector('.document-folder-header'), null);
            listEl.appendChild(rootEl);
            syncDocumentSelectionUI();
        });
    }

    function startRenameFolder(folderId, nameEl) {
        if (!nameEl || !folderId) return;
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'project-rename-input';
        input.value = nameEl.textContent || 'New folder';
        input.setAttribute('data-folder-id', folderId);
        nameEl.textContent = '';
        nameEl.appendChild(input);
        input.focus();
        input.select();
        function finish() {
            var newName = input.value.trim();
            nameEl.removeChild(input);
            if (newName) {
                renameFolder(folderId, newName).then(function () {
                    renderDocuments();
                    if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
                });
            } else {
                nameEl.textContent = 'New folder';
                renameFolder(folderId, 'New folder').then(function () {
                    renderDocuments();
                    if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
                });
            }
        }
        input.addEventListener('blur', finish);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); finish(); }
            if (e.key === 'Escape') {
                e.preventDefault();
                nameEl.removeChild(input);
                nameEl.textContent = 'New folder';
            }
        });
    }

    function startRenameDocument(docId, nameEl, originalName) {
        if (!nameEl || !docId) return;
        if (nameEl.querySelector('input')) return;
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'project-rename-input';
        input.value = originalName || nameEl.textContent || '';
        nameEl.textContent = '';
        nameEl.appendChild(input);
        input.focus();
        input.select();
        var finished = false;
        function finish() {
            if (finished) return;
            finished = true;
            var newName = input.value.trim();
            if (input.parentNode) input.parentNode.removeChild(input);
            if (newName && newName !== originalName) {
                renameDocument(docId, newName).then(function () {
                    renderDocuments();
                    if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
                });
            } else {
                nameEl.textContent = originalName || '';
            }
        }
        input.addEventListener('blur', function () {
            setTimeout(finish, 150);
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') {
                e.preventDefault();
                finished = true;
                if (input.parentNode) input.parentNode.removeChild(input);
                nameEl.textContent = originalName || '';
            }
        });
        input.addEventListener('click', function (e) { e.stopPropagation(); });
        input.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    }

    function updateDesktopTitle() {
        var isDesktop = isDesktopApp || useDesktopApi;
        var isTryPage = !!(document.body && document.body.classList && document.body.classList.contains('page-try'));
        // Keep /try on the desktop-title-bar layout so settings + sidebar toggle
        // remain available with lp-nav fixed as the true top bar.
        var useDesktopLayout = isDesktop || isTryPage;
        var bar = document.getElementById('desktop-title-bar');
        var nameEl = document.getElementById('desktop-title-bar-name');
        var webHeader = document.getElementById('header-web-fallback');
        var webNameEl = document.getElementById('header-web-bar-name');
        var projects = getProjects();
        var proj = activeProjectId ? projects.find(function (p) { return p.id === activeProjectId; }) : null;
        var name = proj ? proj.name : '';
        if (isDesktop) {
            document.title = '';
        } else {
            document.title = name;
        }
        if (useDesktopLayout && bar) {
            bar.hidden = false;
            document.body.classList.add('has-desktop-title-bar');
            document.body.classList.remove('has-web-bar');
            if (nameEl) nameEl.textContent = name;
            if (webHeader) webHeader.hidden = true;
        } else if (webHeader) {
            webHeader.hidden = false;
            if (bar) bar.hidden = true;
            document.body.classList.remove('has-desktop-title-bar');
            document.body.classList.add('has-web-bar');
            if (webNameEl) webNameEl.textContent = name;
        }
    }

    function switchProject(id) {
        var prevId = activeProjectId;
        if (getAuthHeaders().Authorization && prevId && prevId !== id) {
            syncMessagesToApi(prevId, getMessages(prevId));
        }
        activeProjectId = id;
        setActiveId(id);
        activeChatId = getActiveChatId(id);
        if (!activeChatId) {
            var chats = getChats(id);
            var keys = Object.keys(chats);
            if (keys.length > 0) {
                activeChatId = keys[0];
                setActiveChatId(id, activeChatId);
            }
        }
        renderProjects();
        renderChats();
        if (getAuthHeaders().Authorization) {
            loadMessagesFromApi(id, function (msgs) {
                if (msgs && msgs.length > 0) {
                    var cid = activeChatId || getActiveChatId(id);
                    if (!cid) cid = createNewChat(id);
                    var raw = localStorage.getItem(STORAGE_MESSAGES);
                    var all = raw ? JSON.parse(raw) : {};
                    if (!all[id]) all[id] = {};
                    if (!all[id][cid]) all[id][cid] = { name: 'Chat 1', messages: [], createdAt: Date.now() };
                    all[id][cid].messages = msgs;
                    localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(all));
                }
                renderMessages();
                renderChats();
                renderDocuments();
                var pmPane = document.getElementById('pm-ops-pane');
                if (pmPane && typeof pmPane._mudragPmRefresh === 'function') pmPane._mudragPmRefresh();
                updateDesktopTitle();
                if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
            });
        } else {
            renderMessages();
            renderDocuments();
            var pmPane2 = document.getElementById('pm-ops-pane');
            if (pmPane2 && typeof pmPane2._mudragPmRefresh === 'function') pmPane2._mudragPmRefresh();
            updateDesktopTitle();
            if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
        }
    }

    function createProject(name) {
        var projects = getProjects();
        var p = { id: id(), name: name.trim(), createdAt: Date.now() };
        projects.unshift(p);
        setProjects(projects);
        createNewChat(p.id);
        switchProject(p.id);
        modalNewProject.hidden = true;
        inputProjectName.value = '';
        if (getAuthHeaders().Authorization) {
            fetch(API_BASE + '/projects', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ id: p.id, name: p.name })
            }).catch(function () {});
        }
    }

    function renameProject(projectId, newName) {
        var trimmed = (newName || '').trim();
        if (!trimmed) return;
        var projects = getProjects();
        var p = projects.find(function (x) { return x.id === projectId; });
        if (!p || p.name === trimmed) return;
        p.name = trimmed;
        setProjects(projects);
        renderProjects();
        updateDesktopTitle();
    }

    var _renamingProject = false;

    function startRenameProject(projectId, buttonEl) {
        if (!buttonEl || !projectId) return;
        var projects = getProjects();
        var p = projects.find(function (x) { return x.id === projectId; });
        if (!p) return;
        _renamingProject = true;
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'project-rename-input';
        input.value = p.name;
        input.setAttribute('data-project-id', projectId);
        buttonEl.textContent = '';
        buttonEl.appendChild(input);
        input.focus();
        input.select();
        var finished = false;
        function finish() {
            if (finished) return;
            finished = true;
            _renamingProject = false;
            var newName = input.value.trim();
            if (input.parentNode) input.parentNode.removeChild(input);
            if (newName && newName !== p.name) {
                renameProject(projectId, newName);
            } else {
                buttonEl.textContent = p.name;
            }
        }
        input.addEventListener('blur', function () {
            setTimeout(finish, 150);
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { e.preventDefault(); finished = true; _renamingProject = false; if (input.parentNode) input.parentNode.removeChild(input); buttonEl.textContent = p.name; }
        });
        input.addEventListener('click', function (e) { e.stopPropagation(); });
        input.addEventListener('mousedown', function (e) { e.stopPropagation(); });
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
            saveDocument(activeProjectId, file, null, { source: 'project-upload', source_meta: { via: 'upload' } }).then(function () {
                renderDocuments();
                if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
            }).catch(function (err) {
                console.error('Upload failed:', err);
                addMessage('assistant', 'Could not save document. Storage may be full or unavailable.');
            });
        });
        if (rejected > 0) {
            addMessage('assistant', 'Some files were skipped (max 500 MB per file).');
        }
        inputEl.value = '';
    }
    var docUpload = document.getElementById('doc-upload');
    if (docUpload) {
        docUpload.addEventListener('change', function () {
            handleDocUpload(this);
        });
    }
    var btnNewFolder = document.getElementById('btn-new-folder');
    if (btnNewFolder) {
        btnNewFolder.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (!activeProjectId) {
                addMessage('assistant', 'Select a project first, then click New folder.');
                return;
            }
            createFolder(activeProjectId, 'New folder').then(function (folderId) {
                return renderDocuments().then(function () {
                    var listEl = document.getElementById('documents-list');
                    var folderEl = listEl && listEl.querySelector('.document-folder[data-folder-id="' + folderId + '"]');
                    var nameSpan = folderEl && folderEl.querySelector('.document-folder-name');
                    if (nameSpan) {
                        try { localStorage.setItem('mudrag_folder_expanded_' + folderId, 'true'); } catch (err) {}
                        folderEl.querySelector('.document-folder-body').style.display = '';
                        folderEl.querySelector('.document-folder-header').classList.add('expanded');
                        folderEl.querySelector('.document-folder-toggle').textContent = '▾';
                        startRenameFolder(folderId, nameSpan);
                    }
                    if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
                });
            }).catch(function (err) {
                console.error('Create folder failed:', err);
                addMessage('assistant', 'Could not create folder. Try again.');
            });
        });
    }
    // New file button — shows file-type picker, creates blank file in active project
    var btnNewFile = document.getElementById('btn-new-file');
    var newFileMenu = document.getElementById('new-file-menu');
    if (btnNewFile && newFileMenu) {
        btnNewFile.addEventListener('click', function (e) {
            e.stopPropagation();
            if (!activeProjectId) {
                addMessage('assistant', 'Select a project first, then create a file.');
                return;
            }
            newFileMenu.hidden = !newFileMenu.hidden;
        });

        newFileMenu.querySelectorAll('.new-file-item').forEach(function (item) {
            item.addEventListener('click', function () {
                newFileMenu.hidden = true;
                if (!activeProjectId) return;

                var ext  = item.getAttribute('data-ext')  || 'txt';
                var mime = item.getAttribute('data-mime') || 'text/plain';
                var defaultName = 'Untitled.' + ext;

                // Stub content per type so the file isn't completely empty
                var stubs = {
                    md:   '# Untitled\n\n',
                    txt:  '',
                    csv:  'Column1,Column2,Column3\n',
                    json: '{\n  \n}\n',
                    html: '<!DOCTYPE html>\n<html>\n<head><title>Untitled</title></head>\n<body>\n\n</body>\n</html>\n'
                };
                var content = stubs[ext] !== undefined ? stubs[ext] : '';

                var blob = new Blob([content], { type: mime });
                var file = new File([blob], defaultName, { type: mime });

                saveDocument(activeProjectId, file, null, { source: 'new-file' }).then(function (docId) {
                    return renderDocuments().then(function () {
                        // Kick off inline rename so the user can name it immediately
                        var listEl = document.getElementById('documents-list');
                        var docEl  = listEl && listEl.querySelector('.document-item[data-doc-id="' + docId + '"]');
                        var nameEl = docEl  && docEl.querySelector('.document-item-name');
                        if (nameEl) startRenameDocument(docId, nameEl, defaultName);
                        if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
                    });
                }).catch(function () {
                    showToast('Could not create file. Try again.');
                });
            });
        });

        // Close menu when clicking outside
        document.addEventListener('click', function (e) {
            if (!newFileMenu.hidden && !document.getElementById('btn-new-file-wrap').contains(e.target)) {
                newFileMenu.hidden = true;
            }
        });
    }

    var chatDocUpload = document.getElementById('chat-doc-upload');
    if (chatDocUpload) {
        chatDocUpload.addEventListener('change', function () {
            if (this.files && this.files.length > 0) {
                Array.from(this.files).forEach(function (f) { addPendingAttachment(f); });
            }
            this.value = '';
        });
    }

    function handleDroppedFiles(files) {
        if (!activeProjectId || !files || files.length === 0) return;
        var rejected = 0;
        Array.from(files).forEach(function (file) {
            if (file.size > MAX_FILE_SIZE) { rejected++; return; }
            saveDocument(activeProjectId, file, null, { source: 'project-upload', source_meta: { via: 'drag-drop' } }).then(function () {
                renderDocuments();
                if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
            }).catch(function () {
                addMessage('assistant', 'Could not save document. Storage may be full or unavailable.');
            });
        });
        if (rejected > 0) addMessage('assistant', 'Some files were skipped (max 500 MB per file).');
    }

    var docsSection = document.getElementById('documents-section');
    if (docsSection) {
        docsSection.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
            docsSection.classList.add('documents-drop-active');
        });
        docsSection.addEventListener('dragleave', function (e) {
            if (!docsSection.contains(e.relatedTarget)) {
                docsSection.classList.remove('documents-drop-active');
            }
        });
        docsSection.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            docsSection.classList.remove('documents-drop-active');
            if (!activeProjectId) {
                addMessage('assistant', 'Select or create a project first, then drop files here.');
                return;
            }
            var files = e.dataTransfer.files;
            if (files && files.length > 0) handleDroppedFiles(files);
        });
    }

    var pendingAttachments = [];

    function extractFileContent(file) {
        return new Promise(function (resolve) {
            var name = (file.name || '').toLowerCase();
            var ext = name.split('.').pop();

            if (ext === 'csv') {
                var reader = new FileReader();
                reader.onload = function () {
                    if (typeof Papa !== 'undefined') {
                        var result = Papa.parse(reader.result, { header: true, skipEmptyLines: true });
                        var rows = result.data || [];
                        var text = 'CSV file: ' + file.name + ' (' + rows.length + ' rows)\n';
                        if (result.meta && result.meta.fields) text += 'Columns: ' + result.meta.fields.join(', ') + '\n';
                        text += '\n' + rows.slice(0, 200).map(function (r) { return JSON.stringify(r); }).join('\n');
                        if (rows.length > 200) text += '\n... (' + (rows.length - 200) + ' more rows)';
                        resolve({ name: file.name, content: text, type: 'csv' });
                    } else {
                        resolve({ name: file.name, content: 'CSV file: ' + file.name + '\n\n' + reader.result.slice(0, 8000), type: 'csv' });
                    }
                };
                reader.onerror = function () { resolve({ name: file.name, content: '[Could not read file]', type: 'error' }); };
                reader.readAsText(file);
            } else if (ext === 'xlsx' || ext === 'xls') {
                var reader = new FileReader();
                reader.onload = function () {
                    if (typeof XLSX !== 'undefined') {
                        var wb = XLSX.read(reader.result, { type: 'array' });
                        var text = 'Excel file: ' + file.name + ' (' + wb.SheetNames.length + ' sheet(s))\n\n';
                        wb.SheetNames.forEach(function (sn) {
                            var ws = wb.Sheets[sn];
                            var json = XLSX.utils.sheet_to_json(ws, { header: 1 });
                            text += '## Sheet: ' + sn + ' (' + json.length + ' rows)\n';
                            json.slice(0, 150).forEach(function (row) { text += row.join('\t') + '\n'; });
                            if (json.length > 150) text += '... (' + (json.length - 150) + ' more rows)\n';
                            text += '\n';
                        });
                        resolve({ name: file.name, content: text, type: 'xlsx' });
                    } else {
                        resolve({ name: file.name, content: '[Excel parsing not available]', type: 'error' });
                    }
                };
                reader.onerror = function () { resolve({ name: file.name, content: '[Could not read file]', type: 'error' }); };
                reader.readAsArrayBuffer(file);
            } else if (ext === 'docx') {
                var reader = new FileReader();
                reader.onload = function () {
                    if (typeof mammoth !== 'undefined') {
                        mammoth.extractRawText({ arrayBuffer: reader.result }).then(function (result) {
                            var text = 'Word document: ' + file.name + '\n\n' + (result.value || '').slice(0, 10000);
                            resolve({ name: file.name, content: text, type: 'docx' });
                        }).catch(function () {
                            resolve({ name: file.name, content: '[Could not parse Word document]', type: 'error' });
                        });
                    } else {
                        resolve({ name: file.name, content: '[Word parsing not available]', type: 'error' });
                    }
                };
                reader.onerror = function () { resolve({ name: file.name, content: '[Could not read file]', type: 'error' }); };
                reader.readAsArrayBuffer(file);
            } else if (ext === 'txt' || ext === 'md' || ext === 'json' || ext === 'log') {
                var reader = new FileReader();
                reader.onload = function () {
                    resolve({ name: file.name, content: 'File: ' + file.name + '\n\n' + (reader.result || '').slice(0, 10000), type: 'text' });
                };
                reader.onerror = function () { resolve({ name: file.name, content: '[Could not read file]', type: 'error' }); };
                reader.readAsText(file);
            } else if (ext === 'pdf') {
                resolve({ name: file.name, content: '[PDF attached: ' + file.name + '. PDF text extraction is limited — paste key details from the document for best results.]', type: 'pdf' });
            } else if (/^image\//i.test(file.type) || /\.(png|jpg|jpeg|gif|webp|bmp|heic|svg)$/i.test(name)) {
                // Image: read as base64 data URL for vision models
                var reader = new FileReader();
                reader.onload = function () {
                    var dataUrl = reader.result;
                    resolve({
                        name: file.name || 'screenshot.png',
                        content: '[Image attached: ' + (file.name || 'screenshot') + '. The model will analyze this image visually.]',
                        type: 'image',
                        dataUrl: dataUrl,
                        mimeType: file.type || 'image/png'
                    });
                };
                reader.onerror = function () { resolve({ name: file.name, content: '[Could not read image]', type: 'error' }); };
                reader.readAsDataURL(file);
            } else {
                resolve({ name: file.name, content: '[File attached: ' + file.name + ' (' + formatSize(file.size) + '). Cannot extract text from this file type.]', type: 'unknown' });
            }
        });
    }

    function addPendingAttachment(file) {
        ensureProject();
        if (file.size > MAX_FILE_SIZE) {
            addMessage('assistant', 'File too large (max 500 MB): ' + file.name);
            return;
        }
        extractFileContent(file).then(function (attachment) {
            pendingAttachments.push(attachment);
            if (activeProjectId) {
                saveDocument(activeProjectId, file, null, {
                    source: 'chat-attachment',
                    source_meta: { attachment_type: attachment.type || 'unknown' }
                }).then(function () {
                    renderDocuments();
                    if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
                }).catch(function () {});
            }
            renderAttachmentChips();
        });
    }

    function renderAttachmentChips() {
        var container = document.getElementById('attachment-chips');
        if (!container) return;
        container.innerHTML = '';
        if (pendingAttachments.length === 0) { container.hidden = true; return; }
        container.hidden = false;
        pendingAttachments.forEach(function (att, idx) {
            var chip = document.createElement('span');
            chip.className = 'attachment-chip' + (att.type === 'image' ? ' attachment-chip-image' : '');
            if (att.type === 'image' && att.dataUrl) {
                chip.innerHTML =
                    '<img class="attachment-chip-thumb" src="' + att.dataUrl + '" alt="' + att.name + '">' +
                    '<span class="attachment-chip-name">' + att.name + '</span>' +
                    '<button type="button" class="attachment-chip-remove" aria-label="Remove">&times;</button>';
            } else if (att.type === 'folder') {
                chip.innerHTML =
                    '<span class="attachment-chip-icon">📁</span>' +
                    '<span class="attachment-chip-name">' + att.name + '</span>' +
                    '<span class="attachment-chip-meta">' + att.fileCount + ' files</span>' +
                    '<button type="button" class="attachment-chip-remove" aria-label="Remove">&times;</button>';
            } else {
                chip.innerHTML =
                    '<span class="attachment-chip-icon">📎</span>' +
                    '<span class="attachment-chip-name">' + att.name + '</span>' +
                    '<button type="button" class="attachment-chip-remove" aria-label="Remove">&times;</button>';
            }
            chip.querySelector('.attachment-chip-remove').addEventListener('click', function () {
                pendingAttachments.splice(idx, 1);
                renderAttachmentChips();
            });
            container.appendChild(chip);
        });
    }

    document.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); });
    document.addEventListener('drop', function (e) { e.preventDefault(); e.stopPropagation(); });

    var chatComposer = document.querySelector('.chat-composer');
    if (chatComposer) {
        chatComposer.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
            chatComposer.classList.add('chat-drop-active');
        });
        chatComposer.addEventListener('dragleave', function (e) {
            if (!chatComposer.contains(e.relatedTarget)) {
                chatComposer.classList.remove('chat-drop-active');
            }
        });
        chatComposer.addEventListener('drop', function (e) {
            e.preventDefault();
            e.stopPropagation();
            chatComposer.classList.remove('chat-drop-active');

            // Check if any dropped item is a directory using webkitGetAsEntry
            var items = e.dataTransfer && e.dataTransfer.items;
            if (items && items.length > 0) {
                var hasFolder = false;
                var folderEntries = [];
                var fileItems = [];
                for (var i = 0; i < items.length; i++) {
                    var entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
                    if (entry && entry.isDirectory) {
                        hasFolder = true;
                        folderEntries.push(entry);
                    } else {
                        var f = items[i].getAsFile ? items[i].getAsFile() : null;
                        if (f) fileItems.push(f);
                    }
                }
                if (hasFolder) {
                    folderEntries.forEach(function (entry) { addFolderAsContext(entry); });
                    fileItems.forEach(function (f) { addPendingAttachment(f); });
                    if (input) input.focus();
                    return;
                }
            }

            // Regular file drop
            var files = e.dataTransfer.files;
            if (files && files.length > 0) {
                Array.from(files).forEach(function (f) { addPendingAttachment(f); });
                if (input) input.focus();
                return;
            }
            // openmud sidebar document drag
            var docId = e.dataTransfer.getData('text/plain');
            if (docId && docId.indexOf('d_') === 0 && activeProjectId) {
                getDocuments(activeProjectId).then(function (docs) {
                    var doc = docs.find(function (d) { return d.id === docId; });
                    if (doc) {
                        attachDocumentByName(doc);
                        if (input) input.focus();
                    }
                });
            }
        });
    }

    // Clipboard paste — handle images (screenshots) and files pasted into the chat
    if (input) {
        input.addEventListener('paste', function (e) {
            var items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
            var hasImage = false;
            var hasFile = false;
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                if (item.kind === 'file' && item.type.indexOf('image/') === 0) {
                    hasImage = true;
                }
                if (item.kind === 'file' && item.type.indexOf('image/') !== 0) {
                    hasFile = true;
                }
            }
            // Only intercept if there's an image or non-text file; let plain text paste through normally
            if (!hasImage && !hasFile) return;
            e.preventDefault();
            for (var j = 0; j < items.length; j++) {
                var it = items[j];
                if (it.kind === 'file') {
                    var file = it.getAsFile();
                    if (!file) continue;
                    if (it.type.indexOf('image/') === 0 && !file.name) {
                        // Screenshot from clipboard — give it a timestamped name
                        var ext = it.type === 'image/png' ? 'png' : it.type === 'image/jpeg' ? 'jpg' : 'png';
                        file = new File([file], 'screenshot-' + new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-') + '.' + ext, { type: it.type });
                    }
                    addPendingAttachment(file);
                }
            }
            if (input) input.focus();
        });
    }

    function attachDocumentByName(doc) {
        var blob = new Blob([doc.data], { type: doc.type || 'application/octet-stream' });
        var file = new File([blob], doc.name, { type: doc.type || 'application/octet-stream' });
        extractFileContent(file).then(function (attachment) {
            pendingAttachments.push(attachment);
            renderAttachmentChips();
        });
    }

    // ── Folder-as-context: drag a folder from Finder into the chat ───────────
    // Recursively walks the FileSystem API entry tree, builds a plain-text
    // listing (with optional text file content), and adds it as an attachment.
    function addFolderAsContext(dirEntry) {
        var folderName = dirEntry.name || 'folder';
        showToast('Reading folder "' + folderName + '"…');

        // Collect all entries in the directory recursively
        function readEntries(entry, prefix) {
            return new Promise(function (resolve) {
                if (entry.isFile) {
                    entry.file(function (file) {
                        resolve([{ path: prefix + file.name, file: file, isDir: false }]);
                    }, function () { resolve([]); });
                } else if (entry.isDirectory) {
                    var reader = entry.createReader();
                    var allEntries = [];
                    function readBatch() {
                        reader.readEntries(function (batch) {
                            if (batch.length === 0) {
                                // Recurse into all children
                                var promises = allEntries.map(function (child) {
                                    return readEntries(child, prefix + entry.name + '/');
                                });
                                Promise.all(promises).then(function (nested) {
                                    var flat = [];
                                    nested.forEach(function (arr) { arr.forEach(function (x) { flat.push(x); }); });
                                    resolve(flat);
                                });
                            } else {
                                allEntries = allEntries.concat(Array.from(batch));
                                readBatch();
                            }
                        }, function () { resolve([]); });
                    }
                    readBatch();
                } else {
                    resolve([]);
                }
            });
        }

        readEntries(dirEntry, '').then(function (entries) {
            // Sort: dirs first, then files
            entries.sort(function (a, b) { return a.path.localeCompare(b.path); });

            var fileEntries = entries.filter(function (e) { return !e.isDir; });
            var TEXT_EXTS = /\.(txt|md|csv|json|log|xml|html|htm|js|ts|py|rb|sh|yaml|yml|toml|ini|conf|cfg|env|gitignore|readme)$/i;
            var DOC_EXTS  = /\.(pdf|docx?|xlsx?|pptx?)$/i;
            var IMG_EXTS  = /\.(png|jpg|jpeg|gif|webp|heic|bmp|svg)$/i;

            // Build a tree listing
            var listing = '📁 Folder: ' + folderName + ' (' + fileEntries.length + ' file' + (fileEntries.length !== 1 ? 's' : '') + ')\n\n';
            listing += '**File structure:**\n';
            entries.forEach(function (e) {
                var indent = e.path.split('/').length - 1;
                listing += '  '.repeat(indent) + '• ' + e.path + '\n';
            });

            // Read text file contents (up to 3 files, 4000 chars each)
            var textFiles = fileEntries.filter(function (e) { return TEXT_EXTS.test(e.path); }).slice(0, 3);
            var textPromises = textFiles.map(function (e) {
                return new Promise(function (resolve) {
                    var reader = new FileReader();
                    reader.onload = function () {
                        resolve('\n\n---\n**' + e.path + ':**\n' + (reader.result || '').slice(0, 4000));
                    };
                    reader.onerror = function () { resolve(''); };
                    reader.readAsText(e.file);
                });
            });

            Promise.all(textPromises).then(function (textContents) {
                var content = listing;
                if (textContents.some(function (t) { return t.length > 0; })) {
                    content += '\n**Contents of readable files:**' + textContents.join('');
                }

                // Summary line for AI
                var docCount   = fileEntries.filter(function (e) { return DOC_EXTS.test(e.path); }).length;
                var imgCount   = fileEntries.filter(function (e) { return IMG_EXTS.test(e.path); }).length;
                var textCount  = fileEntries.filter(function (e) { return TEXT_EXTS.test(e.path); }).length;
                var summary = [];
                if (docCount)  summary.push(docCount  + ' document' + (docCount  !== 1 ? 's' : ''));
                if (imgCount)  summary.push(imgCount  + ' image' + (imgCount  !== 1 ? 's' : ''));
                if (textCount) summary.push(textCount + ' text file' + (textCount !== 1 ? 's' : ''));
                if (summary.length) content += '\n\n**Contains:** ' + summary.join(', ');

                pendingAttachments.push({
                    name: folderName + '/ (folder)',
                    content: content,
                    type: 'folder',
                    fileCount: fileEntries.length,
                });
                renderAttachmentChips();
                showToast('Folder "' + folderName + '" attached as context (' + fileEntries.length + ' files)');
            });
        });
    }

    var mentionDropdown = null;
    function closeMentionDropdown() {
        if (mentionDropdown && mentionDropdown.parentNode) mentionDropdown.parentNode.removeChild(mentionDropdown);
        mentionDropdown = null;
    }

    function showMentionDropdown(query) {
        closeMentionDropdown();
        if (!activeProjectId) return;
        getDocuments(activeProjectId).then(function (docs) {
            if (docs.length === 0) return;
            var q = (query || '').toLowerCase();
            var filtered = q ? docs.filter(function (d) { return (d.name || '').toLowerCase().indexOf(q) >= 0; }) : docs;
            if (filtered.length === 0) { closeMentionDropdown(); return; }
            mentionDropdown = document.createElement('div');
            mentionDropdown.className = 'mention-dropdown';
            filtered.slice(0, 8).forEach(function (doc) {
                var item = document.createElement('button');
                item.type = 'button';
                item.className = 'mention-dropdown-item';
                item.textContent = doc.name;
                item.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    var val = input.value || '';
                    var atIdx = val.lastIndexOf('@');
                    if (atIdx >= 0) {
                        input.value = val.slice(0, atIdx) + val.slice(input.selectionStart);
                    }
                    closeMentionDropdown();
                    attachDocumentByName(doc);
                    input.focus();
                });
                mentionDropdown.appendChild(item);
            });
            var wrap = document.querySelector('.chat-composer-text-wrap');
            if (wrap) wrap.appendChild(mentionDropdown);
        });
    }

    if (input) {
        input.addEventListener('input', function () {
            var val = input.value || '';
            var cursor = input.selectionStart;
            var before = val.slice(0, cursor);
            var atMatch = before.match(/@([^\s]*)$/);
            if (atMatch) {
                showMentionDropdown(atMatch[1]);
            } else {
                closeMentionDropdown();
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

    function resolveDocumentReference(projectId, referenceText) {
        if (!projectId) return Promise.resolve(null);
        return getDocuments(projectId).then(function (docs) {
            if (!docs || docs.length === 0) return null;
            var text = (referenceText || '').toLowerCase();
            var current = (window.mudrag && window.mudrag.getCurrentDocument) ? window.mudrag.getCurrentDocument() : null;
            if (current && current.id) _lastOpenedDocId = current.id;

            function byId(docId) {
                if (!docId) return null;
                return docs.find(function (d) { return d.id === docId; }) || null;
            }
            function isCsv(doc) {
                return !!doc && /\.csv$/i.test(doc.name || '');
            }

            var quotedMatch = referenceText && referenceText.match(/["']([^"']+\.[a-z0-9]+)["']/i);
            var bareMatch = referenceText && referenceText.match(/\b([a-z0-9][a-z0-9 _-]{1,140}\.(?:csv|tsv|xlsx|xls|pdf|md|txt|json|docx?|png|jpe?g|gif|webp))\b/i);
            var requestedFileName = ((quotedMatch && quotedMatch[1]) || (bareMatch && bareMatch[1]) || '').toLowerCase().trim();
            if (requestedFileName) {
                var exact = docs.find(function (d) { return (d.name || '').toLowerCase() === requestedFileName; });
                if (exact) return exact;
                var partial = docs.find(function (d) { return (d.name || '').toLowerCase().indexOf(requestedFileName) >= 0; });
                if (partial) return partial;
            }

            if (/\b(last|latest)\s+csv\b/i.test(text)) {
                return byId(_lastCreatedCSVDocId) || docs.filter(isCsv).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); })[0] || null;
            }

            if (/\b(this|current|opened|open)\s+(file|csv|document)\b/i.test(text)) {
                return byId(current && current.id) || byId(_lastOpenedDocId) || byId(_lastCreatedDocId) || byId(_lastCreatedCSVDocId) || null;
            }

            if (/\b(last|latest)\s+(file|document)\b/i.test(text)) {
                return byId(_lastCreatedDocId) || byId(_lastOpenedDocId) || null;
            }

            if (/\bcsv\b/i.test(text)) {
                return byId(_lastCreatedCSVDocId) || docs.filter(isCsv).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); })[0] || null;
            }

            return byId(current && current.id) || byId(_lastOpenedDocId) || null;
        });
    }

    function extractBidItemsFromReferencedDocument(projectId, doc) {
        if (!projectId || !doc || !doc.data) return Promise.resolve([]);
        var sourceName = doc.name || 'file';
        var ext = getDocExt(sourceName);
        var isText = /^(md|txt|json|csv|tsv|markdown)$/i.test(ext);
        if (!isText) return Promise.resolve([]);
        var text = ab2str(doc.data);
        if (!text || text.trim().length < 3) return Promise.resolve([]);
        var items = [];

        if (/^(csv|tsv)$/i.test(ext)) {
            var csvRows = naiveParseCSV(text);
            if (csvRows.length > 1 && isBidTable(csvRows[0])) {
                var headers = csvRows[0].map(normalizeHeader);
                csvRows.slice(1).forEach(function (r) {
                    if (!r || r.every(function (c) { return !c; })) return;
                    var getCol = function (stdName) {
                        var hi = headers.indexOf(stdName);
                        return hi >= 0 ? (r[hi] || '').trim() : '';
                    };
                    var desc = getCol('Item / Description');
                    if (!desc) return;
                    var qtyRaw = getCol('Qty');
                    var unit = getCol('Unit');
                    var ucRaw = getCol('Unit Cost');
                    var totRaw = getCol('Total');
                    var notes = getCol('Notes');
                    var qty = parseNum(qtyRaw);
                    var uc = parseNum(ucRaw);
                    var tot = parseNum(totRaw);
                    if (!tot && qty && uc) tot = Math.round(qty * uc * 100) / 100;
                    if (!uc && qty && tot) uc = Math.round(tot / qty * 100) / 100;
                    items.push({ desc: desc, qty: qty || qtyRaw, unit: unit, unitCost: uc, total: tot, notes: notes, section: '', source: sourceName });
                });
            }
            items.forEach(function (item, idx) { item.itemNo = idx + 1; });
            return Promise.resolve(items);
        }

        var lines = text.split('\n');
        var mdSections = parseMDSections(lines);
        var i = 0;
        while (i < lines.length) {
            var line = lines[i];
            if (/^\|/.test(line) && !/^\|[\s|:-]+\|$/.test(line.trim())) {
                var tbl = extractMDTable(lines, i);
                if (tbl && tbl.rows.length > 0) {
                    var normH = tbl.headers.map(normalizeHeader);
                    var curSection = getSectionForLine(mdSections, i);
                    tbl.rows.forEach(function (r) {
                        if (r.every(function (c) { return !c; })) return;
                        var getC = function (stdName) {
                            var hi = normH.indexOf(stdName);
                            return hi >= 0 ? (r[hi] || '').trim() : '';
                        };
                        var desc = getC('Item / Description');
                        if (!desc) return;
                        var qtyRaw = getC('Qty');
                        var unit = getC('Unit');
                        var ucRaw = getC('Unit Cost');
                        var totRaw = getC('Total');
                        var notes = getC('Notes') || (r._section || '');
                        var qty = parseNum(qtyRaw);
                        var uc = parseNum(ucRaw);
                        var tot = parseNum(totRaw);
                        if (!tot && qty && uc) tot = Math.round(qty * uc * 100) / 100;
                        if (!uc && qty && tot) uc = Math.round(tot / qty * 100) / 100;
                        items.push({ desc: desc, qty: qty || qtyRaw, unit: unit, unitCost: uc, total: tot, notes: notes, section: curSection, source: sourceName });
                    });
                    while (i < lines.length && /^\|/.test(lines[i])) i++;
                    continue;
                }
            }
            i++;
        }

        var inlineItems = extractInlineItems(text);
        inlineItems.forEach(function (item) {
            var desc = item[0];
            var alreadyFound = items.some(function (r) {
                return r.desc.toLowerCase().slice(0, 18) === desc.toLowerCase().slice(0, 18);
            });
            if (alreadyFound) return;
            var qty = parseNum(item[1]);
            var uc = parseNum(item[3]);
            var tot = parseNum(item[4]);
            if (!tot && qty && uc) tot = Math.round(qty * uc * 100) / 100;
            if (!uc && qty && tot) uc = Math.round(tot / qty * 100) / 100;
            items.push({ desc: desc, qty: qty || item[1], unit: item[2], unitCost: uc, total: tot, notes: '', section: '', source: sourceName });
        });

        var seen = {};
        items = items.filter(function (item) {
            var key = (item.desc || '').toLowerCase().slice(0, 24) + '|' + String(item.qty || '');
            if (seen[key] || !item.desc) return false;
            seen[key] = true;
            return true;
        });
        items.forEach(function (item, idx) { item.itemNo = idx + 1; });
        return Promise.resolve(items);
    }

    function tryHandleBidItemsLoadToProposalCommand(text) {
        var t = (text || '').trim();
        if (!t) return false;
        var loadIntent = /\b(load|use|import|extract|pull)\b.{0,80}\b(bid\s*items?|line\s*items?)\b.{0,90}\bproposal\b/i;
        if (!loadIntent.test(t)) return false;
        if (!activeProjectId) return false;

        addMessage('user', t);
        input.value = '';
        input.style.height = 'auto';
        setLoading(true);

        resolveDocumentReference(activeProjectId, t).then(function (doc) {
            if (!doc) {
                throw new Error('I could not determine which file you meant. Try “this file” with the document open, “last CSV”, or provide the exact filename.');
            }
            _lastOpenedDocId = doc.id;
            return extractBidItemsFromReferencedDocument(activeProjectId, doc).then(function (items) {
                return { doc: doc, items: items || [] };
            });
        }).then(function (result) {
            if (!result.items.length) {
                throw new Error('I read "' + (result.doc.name || 'that file') + '" but could not map bid items from it.');
            }
            var canonical = persistProjectBidItems(activeProjectId, result.items, {
                source: 'chat_file_reference',
                source_doc_id: result.doc.id || null,
                source_doc_name: result.doc.name || '',
                parsed_rows: result.items.length,
                mapped_valid_bid_items: result.items.length
            });
            addMessage('assistant', 'Read **' + (result.doc.name || 'file') + '** → parsed ' + result.items.length + ' rows → mapped ' + canonical.length + ' valid bid items → proposal state updated.');
            renderMessages();
        }).catch(function (err) {
            addMessage('assistant', err.message || 'Could not load bid items from that file.');
            renderMessages();
        }).then(function () {
            setLoading(false);
            scrollToLatest();
        });
        return true;
    }

    function parseCsvEditIntent(text) {
        var t = (text || '').trim();
        if (!/\b(edit|update|change|set)\b/i.test(t)) return null;
        if (!/\b(row|item)\s+\d+\b/i.test(t)) return null;
        var rowMatch = t.match(/\b(row|item)\s+(\d+)\b/i);
        if (!rowMatch) return null;
        var rowType = rowMatch[1].toLowerCase();
        var rowNumber = parseInt(rowMatch[2], 10);
        if (!rowNumber || rowNumber < 1) return null;

        var field = null;
        if (/\b(unit\s*price|price|unit\s*cost|rate)\b/i.test(t)) field = 'unit_price';
        else if (/\b(qty|quantity)\b/i.test(t)) field = 'qty';
        else if (/\bdescription|desc\b/i.test(t)) field = 'description';
        else if (/\bunit\b/i.test(t)) field = 'unit';
        else if (/\btotal|amount\b/i.test(t)) field = 'total';
        if (!field) return null;

        var markerMatch = t.match(/\b(?:to|as|=)\b([\s\S]+)$/i);
        if (!markerMatch) return null;
        var rawValue = markerMatch[1].trim();
        rawValue = rawValue.replace(/\band\s+recalc.*$/i, '').trim();
        rawValue = rawValue.replace(/^["']|["']$/g, '');
        if (!rawValue) return null;

        var saveAsMatch = t.match(/\bsave\s+as\s+["']?([^"']+\.csv)\b/i);
        var overwrite = /\b(overwrite|replace\s+current|save\s+over)\b/i.test(t);
        return {
            rowType: rowType,
            rowNumber: rowNumber,
            field: field,
            value: rawValue,
            saveAsName: saveAsMatch ? saveAsMatch[1].trim() : null,
            overwrite: overwrite
        };
    }

    function findCsvColumnIndex(headers, field) {
        var normalized = (headers || []).map(function (h) { return (h || '').toLowerCase().trim(); });
        var matchers = {
            qty: [/^qty$|quantity|bid\s*qty|est\.?\s*qty/i],
            unit_price: [/unit\s*(price|cost)|bid\s*price|rate|u\/p/i],
            description: [/item|description|desc|scope|line\s*item/i],
            unit: [/^unit$|uom|u\/m|measure/i],
            total: [/total|amount|extended|line\s*total/i]
        };
        var regs = matchers[field] || [];
        for (var i = 0; i < normalized.length; i++) {
            for (var j = 0; j < regs.length; j++) {
                if (regs[j].test(normalized[i])) return i;
            }
        }
        var fallback = { description: 1, qty: 2, unit: 3, unit_price: 4, total: 5 };
        return fallback[field] != null ? fallback[field] : -1;
    }

    function buildNextCsvVersionName(baseName, docs) {
        var clean = (baseName || 'Bid Items.csv').replace(/\s*\(v\d+\)(?=\.csv$)/i, '');
        var extMatch = clean.match(/\.csv$/i);
        var root = extMatch ? clean.replace(/\.csv$/i, '') : clean;
        var existing = {};
        (docs || []).forEach(function (d) { existing[(d.name || '').toLowerCase()] = true; });
        var version = 2;
        var candidate = root + ' (v' + version + ').csv';
        while (existing[candidate.toLowerCase()]) {
            version++;
            candidate = root + ' (v' + version + ').csv';
        }
        return candidate;
    }

    function tryHandleCsvEditCommand(text) {
        var intent = parseCsvEditIntent(text);
        if (!intent || !activeProjectId) return false;

        addMessage('user', text);
        input.value = '';
        input.style.height = 'auto';
        setLoading(true);

        resolveDocumentReference(activeProjectId, text).then(function (doc) {
            if (!doc) throw new Error('I could not determine which CSV to edit. Try "this file", "last CSV", or provide the filename.');
            if (!/\.csv$/i.test(doc.name || '')) throw new Error('That file is not a CSV. Open or reference a CSV file first.');
            _lastOpenedDocId = doc.id;
            var csvText = ab2str(doc.data || new ArrayBuffer(0));
            var rows = naiveParseCSV(csvText);
            if (!rows.length) throw new Error('That CSV appears to be empty.');

            var rowIndex = intent.rowType === 'item'
                ? rows.slice(1).findIndex(function (r) {
                    var itemNo = parseInt((r[0] || '').toString().trim(), 10);
                    return itemNo === intent.rowNumber;
                }) + 1
                : (rows[intent.rowNumber] ? intent.rowNumber : intent.rowNumber - 1);
            if (rowIndex <= 0 || rowIndex >= rows.length) {
                throw new Error('Row ' + intent.rowNumber + ' was not found in "' + doc.name + '".');
            }

            var header = rows[0] || [];
            var colIndex = findCsvColumnIndex(header, intent.field);
            if (colIndex < 0) throw new Error('Could not find a matching "' + intent.field + '" column in this CSV.');
            while (rows[rowIndex].length <= colIndex) rows[rowIndex].push('');
            rows[rowIndex][colIndex] = intent.value;

            var qtyCol = findCsvColumnIndex(header, 'qty');
            var unitPriceCol = findCsvColumnIndex(header, 'unit_price');
            var totalCol = findCsvColumnIndex(header, 'total');
            if (qtyCol >= 0 && unitPriceCol >= 0 && totalCol >= 0) {
                var qty = parseNum(rows[rowIndex][qtyCol]);
                var unitPrice = parseNum(rows[rowIndex][unitPriceCol]);
                if (qty && unitPrice) rows[rowIndex][totalCol] = fmtNum(Math.round(qty * unitPrice * 100) / 100);
            }

            var updatedCsv = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
            var updatedBlob = new Blob([updatedCsv], { type: 'text/csv' });
            var updatedBufferPromise = updatedBlob.arrayBuffer();

            return getDocuments(activeProjectId).then(function (docs) {
                return updatedBufferPromise.then(function (ab) {
                    if (intent.overwrite) {
                        if (!window.confirm('Overwrite "' + (doc.name || 'this CSV') + '" with these edits?')) {
                            throw new Error('Overwrite cancelled.');
                        }
                        return updateDocumentContent(doc.id, ab).then(function () {
                            return { savedDocId: doc.id, savedName: doc.name, savedBuffer: ab, mode: 'overwrite' };
                        });
                    }
                    var saveName = intent.saveAsName || buildNextCsvVersionName(doc.name || 'Bid Items.csv', docs);
                    var file = new File([updatedBlob], saveName, { type: 'text/csv' });
                    return saveDocument(activeProjectId, file).then(function (newDocId) {
                        _lastCreatedCSVDocId = newDocId;
                        _lastCreatedDocId = newDocId;
                        return updatedBlob.arrayBuffer().then(function (savedBuffer) {
                            return { savedDocId: newDocId, savedName: saveName, savedBuffer: savedBuffer, mode: 'versioned' };
                        });
                    });
                });
            });
        }).then(function (saved) {
            var tempDoc = { name: saved.savedName, data: saved.savedBuffer };
            return extractBidItemsFromReferencedDocument(activeProjectId, tempDoc).then(function (items) {
                persistProjectBidItems(activeProjectId, items, {
                    source: 'chat_csv_edit',
                    source_doc_id: saved.savedDocId,
                    source_doc_name: saved.savedName,
                    parsed_rows: items.length,
                    mapped_valid_bid_items: items.length
                });
                return saved;
            });
        }).then(function (saved) {
            return refreshDocumentViews().then(function () {
                return getDocuments(activeProjectId).then(function (docs) {
                    var updatedDoc = docs.find(function (d) { return d.id === saved.savedDocId; });
                    if (updatedDoc && window.mudrag && window.mudrag.openDocument) window.mudrag.openDocument(updatedDoc);
                    addMessage('assistant', 'Read file → updated row ' + intent.rowNumber + ' ' + intent.field.replace('_', ' ') + ' to ' + intent.value + ' → recalculated totals → saved as "' + saved.savedName + '".');
                    renderMessages();
                });
            });
        }).catch(function (err) {
            if ((err.message || '').indexOf('cancelled') < 0) {
                addMessage('assistant', err.message || 'Could not apply that CSV edit.');
                renderMessages();
            }
        }).then(function () {
            setLoading(false);
            scrollToLatest();
        });

        return true;
    }

    function tryHandleOpenClawSetupCommand(text) {
        var t = String(text || '').trim();
        if (!t) return false;
        var lower = t.toLowerCase();
        var asksHow = /(how|help|walk me|guide|what).{0,35}(link|connect|setup|set up|enable).{0,35}openclaw/.test(lower)
            || /^\/openclaw\b/.test(lower)
            || /^openclaw\s+setup\b/.test(lower);
        var hasConfigFields = /\b(openclaw\s*(api\s*)?key|base\s*url|endpoint|openclaw\s*model)\b\s*[:=]/i.test(t)
            || /\bkey=|url=|base=|model=|enable\b|disable\b/i.test(lower) && /\bopenclaw\b/i.test(lower);
        if (!asksHow && !hasConfigFields) return false;

        addMessage('user', t);
        input.value = '';
        input.style.height = 'auto';

        var current = getProviderConfig();
        var next = {};
        Object.keys(current || {}).forEach(function (k) { next[k] = current[k]; });

        var keyMatch = t.match(/\b(?:openclaw\s*(?:api\s*)?key|key)\s*[:=]\s*([^\s,;]+)/i) || t.match(/\bkey=([^\s,;]+)/i);
        var urlMatch = t.match(/\b(?:openclaw\s*(?:base\s*url|url|endpoint)|base\s*url|url|endpoint)\s*[:=]\s*(https?:\/\/[^\s,;]+)/i)
            || t.match(/\b(?:url|base)=([^\s,;]+)/i);
        var modelMatch = t.match(/\b(?:openclaw\s*model|model)\s*[:=]\s*([^\s,;]+)/i) || t.match(/\bmodel=([^\s,;]+)/i);
        var disable = /\b(?:disable|disabled|off)\b/i.test(t);
        var enable = /\b(?:enable|enabled|on)\b/i.test(t);

        var changed = false;
        if (keyMatch && keyMatch[1]) {
            next.openclawApiKey = String(keyMatch[1]).trim();
            changed = true;
        }
        if (urlMatch && urlMatch[1]) {
            next.openclawBaseUrl = String(urlMatch[1]).trim();
            changed = true;
        }
        if (modelMatch && modelMatch[1]) {
            next.openclawModel = String(modelMatch[1]).trim();
            changed = true;
        }
        if (enable) {
            next.openclawEnabled = true;
            changed = true;
        }
        if (disable) {
            next.openclawEnabled = false;
            changed = true;
        }
        if ((next.openclawApiKey || next.openclawBaseUrl) && !disable) {
            next.openclawEnabled = true;
        }

        if (changed) {
            if (!saveProviderConfig(next)) {
                addMessage('assistant', 'I could not save OpenClaw settings in this browser. Open Settings and save there.');
                return true;
            }
            if (next.openclawEnabled) setModelSelection('openclaw');
            var savedSummary = [
                'OpenClaw setup updated.',
                '- Enabled: ' + (next.openclawEnabled ? 'yes' : 'no'),
                '- API key: ' + (next.openclawApiKey ? 'saved' : 'not set'),
                '- Base URL: ' + (next.openclawBaseUrl || 'not set'),
                '- Model: ' + (next.openclawModel || 'openclaw')
            ].join('\n');
            addMessage('assistant', savedSummary + '\n\nI set your model to openmud agent when enabled. Send your next task and I will route through your local agent.');
            return true;
        }

        addMessage('assistant',
            'OpenClaw setup is quick. Paste one line like:\n'
            + '/openclaw enable key=YOUR_KEY url=https://YOUR_OPENCLAW_BASE_URL/v1 model=openclaw\n\n'
            + 'You can also say:\n'
            + 'openclaw key: YOUR_KEY\n'
            + 'openclaw base url: https://.../v1\n'
            + 'openclaw model: openclaw\n\n'
            + 'After that, I will switch chat to OpenClaw Agent automatically.'
        );
        return true;
    }

    var activeLoadingStatusText = '';
    var _loadingPhraseTimer = null;

    var LOADING_PHRASE_SETS = {
        email:    ['Searching email…', 'Scanning inbox…', 'Reading messages…'],
        estimate: ['Crunching numbers…', 'Building estimate…', 'Calculating costs…'],
        proposal: ['Drafting proposal…', 'Writing it up…', 'Putting it together…'],
        schedule: ['Building schedule…', 'Mapping phases…', 'Laying out the timeline…'],
        bid:      ['Hunting for bids…', 'Scanning job boards…', 'Checking plan rooms…'],
        tool:     ['Running tool…', 'Executing…', 'On it…'],
        default:  ['Thinking…', 'Working on it…', 'Cooking…', 'On it…', 'Just a sec…'],
    };

    function _getLoadingPhrases(statusHint) {
        if (!statusHint) return LOADING_PHRASE_SETS.default;
        var h = statusHint.toLowerCase();
        if (/email|mail|inbox/.test(h)) return LOADING_PHRASE_SETS.email;
        if (/estimate|cost|material|labor/.test(h)) return LOADING_PHRASE_SETS.estimate;
        if (/proposal/.test(h)) return LOADING_PHRASE_SETS.proposal;
        if (/schedule/.test(h)) return LOADING_PHRASE_SETS.schedule;
        if (/bid|job|work/.test(h)) return LOADING_PHRASE_SETS.bid;
        if (/tool|running|executing/.test(h)) return LOADING_PHRASE_SETS.tool;
        return LOADING_PHRASE_SETS.default;
    }

    function setLoading(on, contextHint) {
        if (sendBtn) { sendBtn.disabled = on; sendBtn.setAttribute('aria-busy', on ? 'true' : 'false'); }
        var indicator = document.getElementById('chat-loading-indicator');
        if (indicator) indicator.hidden = !on;
        var statusEl = document.getElementById('chat-loading-status');

        if (_loadingPhraseTimer) { clearInterval(_loadingPhraseTimer); _loadingPhraseTimer = null; }

        if (on && statusEl) {
            var phrases = _getLoadingPhrases(activeLoadingStatusText || contextHint || '');
            var idx = 0;
            statusEl.textContent = phrases[0];
            if (phrases.length > 1) {
                _loadingPhraseTimer = setInterval(function () {
                    idx = (idx + 1) % phrases.length;
                    // Only cycle phrases if no specific status is being pushed
                    if (!activeLoadingStatusText) statusEl.textContent = phrases[idx];
                }, 2200);
            }
        } else if (!on && statusEl) {
            activeLoadingStatusText = '';
            statusEl.textContent = 'Thinking…';
        }
    }

    function getFileReferenceContext() {
        var current = (window.mudrag && window.mudrag.getCurrentDocument) ? window.mudrag.getCurrentDocument() : null;
        if (current && current.id) _lastOpenedDocId = current.id;
        return {
            current_document: current ? { id: current.id || null, name: current.name || null, type: current.type || null } : null,
            last_opened_document_id: _lastOpenedDocId || null,
            last_created_document_id: _lastCreatedDocId || null,
            last_created_csv_document_id: _lastCreatedCSVDocId || null
        };
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

    function getCanvasDocumentContext() {
        var pref = localStorage.getItem(STORAGE_MAIN_VIEW);
        if (pref !== 'canvas') return Promise.resolve('');
        var mudrag = window.mudrag;
        if (!mudrag) return Promise.resolve('');
        return new Promise(function (resolve) {
            if (!activeProjectId) { resolve(''); return; }
            getDocuments(activeProjectId).then(function (docs) {
                var parts = [];
                parts.push('\n[Canvas mode. Documents on canvas: ' + (docs.length ? docs.map(function (d) { return d.name; }).join(', ') : 'none') + '. User can ask about any of these.]');
                var focused = mudrag.getCurrentDocument?.();
                if (focused) {
                    var text = mudrag.getCurrentDocumentText?.();
                    if (text && text.length > 0) {
                        var snippet = text.length > 4000 ? text.slice(0, 4000) + '\n...[truncated]' : text;
                        parts.push('\n[User is viewing: ' + (focused.name || 'Document') + '. Content:\n' + snippet + ']');
                    } else {
                        parts.push('\n[User is viewing: ' + (focused.name || 'Document') + '. Content not extractable (PDF/image). User may describe what they see.]');
                    }
                }
                resolve(parts.join(''));
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

    var TOOL_TRIGGERS = /generate|build|create|make|draft|estimate|bid|proposal|schedule|project/i;
    function shouldUseTools(text) {
        return TOOL_TRIGGERS.test(text);
    }

    function buildCitationsBlock(rag) {
        if (!rag || !Array.isArray(rag.sources) || rag.sources.length === 0) return '';
        var confidence = String(rag.confidence || 'low').toLowerCase();
        // Hide noisy fallback/low-confidence matches so sources only appear when
        // we have meaningful retrieval grounding.
        if (confidence === 'low' && !!rag.fallback_used) return '';
        var payload = {
            confidence: confidence,
            fallback_used: !!rag.fallback_used,
            sources: rag.sources.slice(0, 8).map(function (s) {
                return {
                    id: s.id || null,
                    title: s.title || s.topic || s.source || 'Source',
                    source: s.source || 'project-doc',
                    url: s.url || s.href || '',
                    snippet: s.snippet || s.content || '',
                    score: s.score != null ? s.score : null
                };
            })
        };
        return '\n\n[MUDRAG_CITATIONS]' + JSON.stringify(payload) + '[/MUDRAG_CITATIONS]';
    }

    function doSend(prefillText) {
        if (prefillText) { input.value = prefillText; }
        var text = (input.value || '').trim();
        if (!text && pendingAttachments.length === 0) return;
        window.__mudragSend = doSend;
        if (!text && pendingAttachments.length > 0) {
            var hasImg    = pendingAttachments.some(function (a) { return a.type === 'image'; });
            var hasFolder = pendingAttachments.some(function (a) { return a.type === 'folder'; });
            if (hasFolder) {
                text = 'Here is a folder I dropped in. What files does it contain and which ones look most useful for this project?';
            } else if (hasImg) {
                text = 'Here is a screenshot. Please extract and summarize the key information from it.';
            } else {
                text = 'Here is the attached document. Extract the key details from it.';
            }
        }
        ensureProject();
        if (!activeProjectId) return;
        if (tryHandleOpenClawSetupCommand(text)) return;
        if (tryHandleBidItemsLoadToProposalCommand(text)) return;
        if (tryHandleCsvEditCommand(text)) return;

        if (isOverLimit()) {
            var modal = document.getElementById('modal-upgrade');
            if (modal) {
                var tier = localStorage.getItem(STORAGE_SUB_TIER) || 'free';
                var titleEl = document.getElementById('modal-upgrade-title');
                var descEl = document.getElementById('modal-upgrade-desc');
                if (tier === 'free' && titleEl) titleEl.textContent = 'Free limit reached';
                else if (tier === 'personal' && titleEl) titleEl.textContent = 'Personal limit reached';
                else if (titleEl) titleEl.textContent = 'Limit reached';
                if (tier === 'personal' && descEl) descEl.textContent = "You've used your 100 messages for today. Upgrade to Pro for unlimited.";
                else if (descEl) descEl.textContent = "You've used your free messages for today. Upgrade for more.";
                modal.hidden = false;
                modal.addEventListener('click', function closeModal(e) {
                    if (e.target === modal) {
                        modal.hidden = true;
                        modal.removeEventListener('click', closeModal);
                    }
                });
            }
            return;
        }

        var attachmentContext = '';
        var pendingImages = [];
        if (pendingAttachments.length > 0) {
            var textAtts = pendingAttachments.filter(function (a) { return a.type !== 'image'; });
            var imgAtts = pendingAttachments.filter(function (a) { return a.type === 'image' && a.dataUrl; });
            if (textAtts.length > 0) {
                attachmentContext = '\n\n[ATTACHED DOCUMENTS]\n' + textAtts.map(function (a) { return a.content; }).join('\n\n---\n\n') + '\n[/ATTACHED DOCUMENTS]';
            }
            if (imgAtts.length > 0) {
                // Store for vision payload injection; also append a note to context for non-vision models
                pendingImages = imgAtts.map(function (a) { return { dataUrl: a.dataUrl, mimeType: a.mimeType || 'image/png', name: a.name }; });
            }
            pendingAttachments = [];
            renderAttachmentChips();
        }

        var displayText = text;
        addMessage('user', displayText);
        input.value = '';
        input.style.height = 'auto';
        // Pick a context hint for the loading phrases based on the user's message
        var _lhint = '';
        var _lt = (text || '').toLowerCase();
        if (/email|mail|inbox/.test(_lt)) _lhint = 'email';
        else if (/estimate|cost|material|labor|bid/.test(_lt)) _lhint = 'estimate';
        else if (/proposal/.test(_lt)) _lhint = 'proposal';
        else if (/schedule/.test(_lt)) _lhint = 'schedule';
        setLoading(true, _lhint);

        var msgs = getMessages(activeProjectId);
        var history = msgs.map(function (m) {
            var content = m.content;
            if (typeof content === 'string') {
                content = content.replace(/\n\n\[MUDRAG_CITATIONS\][\s\S]*?\[\/MUDRAG_CITATIONS\]/g, '');
            }
            return { role: m.role, content: content };
        }).slice(-20);
        if (attachmentContext && history.length > 0) {
            history[history.length - 1].content = history[history.length - 1].content + attachmentContext;
        }

        (localStorage.getItem(STORAGE_MAIN_VIEW) === 'canvas' ? getCanvasDocumentContext() : getDocumentsContext()).then(function (docCtx) {
            if (docCtx && history.length > 0) {
                history[history.length - 1].content = history[history.length - 1].content + docCtx;
            }
            var modelSelect = document.getElementById('model-select');
            var model = modelSelect ? modelSelect.value : 'gpt-4o-mini';
            if (modelSelect) localStorage.setItem(STORAGE_MODEL, model);
            var providerConfig = getProviderConfig();
            if (model === 'openclaw') {
                var ocRelayToken = '';
                try { ocRelayToken = localStorage.getItem('openmud_oc_relay_token') || ''; } catch (e) {}

                // Route through /api/chat with relay token if a token exists — no need for
                // the explicit "connected" flag. Server will return a clear error if no agent is connected.
                if (ocRelayToken) {
                    var ocHeaders = getChatHeaders();
                    ocHeaders['X-Openmud-Relay-Token'] = ocRelayToken;
                    var ocController = new AbortController();
                    var ocRelayTimeout = setTimeout(function () {
                        ocController.abort();
                        addMessage('assistant', 'OpenClaw request timed out. Make sure openmud-agent is running on your Mac.');
                        setLoading(false);
                        scrollToLatest();
                    }, 90000);
                    fetch(API_BASE + '/chat', {
                        method: 'POST',
                        headers: ocHeaders,
                        body: JSON.stringify({ messages: history, model: 'openclaw', temperature: 0.3, max_tokens: 1024 }),
                        signal: ocController.signal
                    }).then(function (r) {
                        return r.json().then(function (data) {
                            clearTimeout(ocRelayTimeout);
                            if (!r.ok) addMessage('assistant', 'Error: ' + (data.error || 'Request failed'));
                            else addMessage('assistant', data.response || 'No response.');
                            setLoading(false);
                            scrollToLatest();
                        });
                    }).catch(function (err) {
                        clearTimeout(ocRelayTimeout);
                        if (err.name !== 'AbortError') {
                            addMessage('assistant', 'Could not reach server: ' + (err.message || err));
                            setLoading(false);
                            scrollToLatest();
                        }
                    });
                    return;
                }

                var openclawEnabled = !!(providerConfig.openclawEnabled || (providerConfig.openclawApiKey && providerConfig.openclawBaseUrl));
                if (!openclawEnabled) {
                    addMessage('assistant', 'openmud agent is not linked yet. Go to Settings → openmud agent and follow the setup steps to connect your Mac.');
                    setLoading(false);
                    return;
                }
                // Fallback: call the local gateway directly (works on localhost dev, requires ngrok/Tailscale on live site)
                var ocBaseUrl = (providerConfig.openclawBaseUrl || '').replace(/\/+$/, '');
                var ocApiKey = providerConfig.openclawApiKey || '';
                var ocModel = providerConfig.openclawModel || 'gpt-4.1-mini';
                var ocSystemPrompt = 'You are OpenClaw, an agentic assistant for openmud. You execute tasks — you do not just answer questions.\n\nEXECUTION RULES:\n- Execute immediately. Do NOT ask for confirmation before acting.\n- If you can infer the intent, act with sensible defaults. Ask at most ONE question only if truly critical info is missing.\n- Calendar events: create with 1 hour duration, 15 min reminder, Work calendar by default.\n- Emails: send if you know recipient and message.\n- State what you are doing in one line, then do it.\n\nYou are connected to the user\'s Mac via OpenClaw nodes and can run osascript to control Apple Calendar, Apple Mail, and other apps.\n\nBe direct, concise, action-first.';
                var ocPayload = {
                    model: ocModel,
                    messages: [{ role: 'system', content: ocSystemPrompt }].concat(history),
                    temperature: 0.3,
                    max_tokens: 1024
                };
                var ocTimeoutId = setTimeout(function () {
                    addMessage('assistant', 'OpenClaw request timed out. Check that your gateway is running at ' + ocBaseUrl + ' (run: openclaw gateway start).');
                    setLoading(false);
                    scrollToLatest();
                }, 90000);
                fetch(ocBaseUrl + '/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + ocApiKey
                    },
                    body: JSON.stringify(ocPayload)
                })
                    .then(function (r) {
                        return r.json().then(function (data) {
                            if (!r.ok) {
                                var err = data && (data.error || data.message);
                                throw new Error(typeof err === 'object' ? (err.message || JSON.stringify(err)) : String(err || 'OpenClaw error ' + r.status));
                            }
                            return data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || 'No response from OpenClaw.';
                        });
                    })
                    .then(function (reply) {
                        clearTimeout(ocTimeoutId);
                        addMessage('assistant', reply);
                    })
                    .catch(function (err) {
                        clearTimeout(ocTimeoutId);
                        var msg = String(err.message || err || '');
                        if (/failed to fetch|networkerror|load failed|cors/i.test(msg)) {
                            addMessage('assistant', 'Cannot reach OpenClaw gateway at ' + ocBaseUrl + '. Make sure OpenClaw is running on your Mac (openclaw gateway start) and your base URL is correct in Settings.');
                        } else {
                            addMessage('assistant', 'OpenClaw error: ' + msg);
                        }
                    })
                    .then(function () {
                        setLoading(false);
                        scrollToLatest();
                    });
                return;
            }

            // For vision-capable models, upgrade last user message to multimodal content array
            var isVisionModel = /gpt-4o|claude/i.test(model);
            if (pendingImages.length > 0 && isVisionModel && history.length > 0) {
                var lastMsg = history[history.length - 1];
                var contentArray = [{ type: 'text', text: lastMsg.content }];
                pendingImages.forEach(function (img) {
                    var b64 = img.dataUrl.split(',')[1] || img.dataUrl;
                    contentArray.push({
                        type: 'image_url',
                        image_url: { url: img.dataUrl }
                    });
                });
                lastMsg.content = contentArray;
            } else if (pendingImages.length > 0 && !isVisionModel) {
                // Non-vision model: describe the image in text instead
                if (history.length > 0) {
                    history[history.length - 1].content += '\n\n[Note: ' + pendingImages.length + ' image(s) were attached. This model does not support image analysis — switch to Claude or GPT-4o to extract information from screenshots.]';
                }
            }

            var agentMode = localStorage.getItem(STORAGE_AGENT_MODE) || 'agent';
            var useTools = (agentMode === 'agent') && shouldUseTools(text);
            var effectiveModel = model;
            var projectDataForPayload = getProjectData(activeProjectId);
            var activeProject = getProjects().find(function (p) { return p.id === activeProjectId; }) || null;
            var payload = {
                messages: history,
                model: effectiveModel,
                temperature: 0.7,
                max_tokens: 1024,
                use_tools: useTools,
                stream: !useTools
                    && !effectiveModel.startsWith('claude-')
                    && effectiveModel !== 'mud1'
                    && !/^grok/i.test(effectiveModel)
                    && !/^openrouter\//i.test(effectiveModel),
                available_tools: useTools ? ['build_schedule', 'generate_proposal', 'estimate_project_cost', 'calculate_material_cost', 'calculate_labor_cost', 'calculate_equipment_cost'] : undefined,
                project_data: projectDataForPayload && Object.keys(projectDataForPayload).length ? projectDataForPayload : undefined,
                project_name: activeProject && activeProject.name ? activeProject.name : undefined,
                project_id: activeProjectId || undefined,
                file_reference_context: getFileReferenceContext()
            };
            if (useTools && lastEstimatePayload && lastEstimateResult) {
                payload.estimate_context = {
                    payload: lastEstimatePayload,
                    result: lastEstimateResult
                };
            }
            if (!useTools) delete payload.available_tools;
            var chatEndpoint = API_BASE + '/chat';

            var controller = new AbortController();
            var timeoutId = setTimeout(function () { controller.abort(); }, 60000);

            // Safety net: always dismiss the spinner after 45s no matter what
            var _spinnerGuard = setTimeout(function () { setLoading(false); }, 45000);
            function doneSending() {
                clearTimeout(_spinnerGuard);
                setLoading(false);
                scrollToLatest();
                _doTypewriter = true;
                renderMessages();
            }

            // Show upgrade modal for rate-limit or auth errors instead of raw error text
            function handleApiError(errMsg, statusCode) {
                var msg = String(errMsg || '').toLowerCase();
                var isRateLimit = statusCode === 429 || /rate.?limit|too many request|usage limit|limit reached|limit exceeded/i.test(errMsg);
                var isAuthError = statusCode === 401 || statusCode === 403 || /sign in|log in|unauthorized|not authenticated|authentication/i.test(errMsg);
                var hasDevUnlimited = localStorage.getItem('mudrag_dev_unlimited') === 'true';
                if (isAuthError && hasDevUnlimited) {
                    addMessage('assistant', 'Dev mode is enabled. Retrying with dev access unlocked.');
                    return;
                }
                if (isAuthError && typeof mudragAuth !== 'undefined' && mudragAuth.getSession) {
                    // Best effort: refresh in-memory token, but do not interrupt with a
                    // "send again" loop message. Let normal auth UI explain next steps.
                    mudragAuth.getSession().then(function (r) {
                        var session = r && r.data ? r.data.session : null;
                        if (session && session.access_token) syncAuthSession(session);
                    }).catch(function () {});
                }
                if (isRateLimit || isAuthError) {
                    var modal = document.getElementById('modal-upgrade');
                    var titleEl = document.getElementById('modal-upgrade-title');
                    var descEl = document.getElementById('modal-upgrade-desc');
                    if (isAuthError) {
                        var signInPath = '/settings.html';
                        if (titleEl) titleEl.textContent = 'Sign in to continue';
                        if (descEl) descEl.textContent = 'You need to sign in to use the AI. Use the sign in button below, or enter a dev key.';
                    } else {
                        var tier = localStorage.getItem(STORAGE_SUB_TIER) || 'free';
                        if (titleEl) titleEl.textContent = tier === 'free' ? 'Free limit reached' : 'Daily limit reached';
                        if (descEl) descEl.textContent = tier === 'free'
                            ? "You've used your free messages for today. Upgrade for more, or use the desktop app with mud1 (free, local)."
                            : "You've hit today's limit. Upgrade to Pro for unlimited messages, or enter a dev key below.";
                    }
                    if (modal) modal.hidden = false;
                } else {
                    addMessage('assistant', 'Error: ' + errMsg);
                }
            }

            function readErrorMessage(res) {
                var contentType = (res.headers.get('content-type') || '').toLowerCase();
                if (contentType.indexOf('application/json') >= 0) {
                    return res.json().then(function (data) {
                        return (data && data.error) ? data.error : 'Request failed (' + res.status + ')';
                    }).catch(function () {
                        return 'Request failed (' + res.status + ')';
                    });
                }
                return res.text().then(function (text) {
                    if (contentType.indexOf('text/html') >= 0 || /<!doctype|<html/i.test(text || '')) {
                        return 'API route returned HTML instead of JSON. If testing locally, start the desktop app (npm run dev:app) so the tool server runs on port 3847, then hard-refresh (Cmd+Shift+R).';
                    }
                    return 'Unexpected response format (' + res.status + ').';
                }).catch(function () {
                    return 'Request failed (' + res.status + ')';
                });
            }

            if (payload.stream) {
                var streamingEl = null;
                var fullText = '';
                var messageAdded = false;
                function ensureStreamingMessage() {
                    if (!messageAdded && fullText) {
                        messageAdded = true;
                        addMessage('assistant', fullText);
                        var assistants = messagesEl.querySelectorAll('.msg-assistant');
                        streamingEl = assistants.length > 0 ? assistants[assistants.length - 1].querySelector('.msg-content p') : null;
                    }
                }
                fetch(chatEndpoint, {
                    method: 'POST',
                    headers: getChatHeaders(),
                    body: JSON.stringify(payload),
                    signal: controller.signal
                })
                    .then(function (r) {
                        clearTimeout(timeoutId);
                        if (!r.ok) {
                            return readErrorMessage(r).then(function (errMsg) {
                                handleApiError(errMsg, r.status);
                                throw new Error(errMsg || ('Request failed (' + r.status + ')'));
                            });
                        }
                        var reader = r.body.getReader();
                        var decoder = new TextDecoder();
                        var buffer = '';
                        function readChunk() {
                            return reader.read().then(function (result) {
                                if (result.done) return;
                                buffer += decoder.decode(result.value, { stream: true });
                                var lines = buffer.split('\n');
                                buffer = lines.pop() || '';
                                lines.forEach(function (line) {
                                    if (line.startsWith('data: ')) {
                                        var data = line.slice(6).trim();
                                        if (data === '[DONE]') return;
                                        try {
                                            var parsed = JSON.parse(data);
                                            if (parsed.content) {
                                                fullText += parsed.content;
                                                ensureStreamingMessage();
                                                if (streamingEl) streamingEl.textContent = fullText;
                                                scrollToLatest();
                                            }
                                        } catch (e) { /* ignore */ }
                                    }
                                });
                                return readChunk();
                            });
                        }
                        return readChunk();
                    })
                    .then(function () {
                        if (!messageAdded) addMessage('assistant', fullText || 'The AI returned an empty response. Try again.');
                        else {
                            var msgs = getMessages(activeProjectId);
                            var last = msgs.length - 1;
                            if (last >= 0 && msgs[last].role === 'assistant') msgs[last].content = fullText || 'The AI returned an empty response. Try again.';
                            setMessages(activeProjectId, msgs);
                        }
                        incrementUsage({ model: effectiveModel });
                        syncUsageFromApi();
                    })
                    .catch(function (err) {
                        var errMsg = err.message || 'Request failed.';
                        if (err.name === 'AbortError') {
                            addMessage('assistant', 'Request timed out. Try again.');
                        } else {
                            if (!messageAdded) handleApiError(errMsg, 0);
                            else {
                                var msgs = getMessages(activeProjectId);
                                var last = msgs.length - 1;
                                if (last >= 0 && msgs[last].role === 'assistant') {
                                    msgs[last].content = 'Error: ' + errMsg;
                                    setMessages(activeProjectId, msgs);
                                }
                            }
                        }
                    })
                    .then(function () { doneSending(); });
            } else {
                fetch(chatEndpoint, {
                    method: 'POST',
                    headers: getChatHeaders(),
                    body: JSON.stringify(payload),
                    signal: controller.signal
                })
                    .then(function (r) {
                        clearTimeout(timeoutId);
                        if (!r.ok) {
                            return readErrorMessage(r).then(function (errMsg) {
                                handleApiError(errMsg, r.status);
                                throw new Error(errMsg || ('Request failed (' + r.status + ')'));
                            });
                        }
                        return r.json().then(function (data) {
                            var txt = (data && data.response) ? String(data.response).trim() : '';
                            if (data && data.rag && effectiveModel === 'mud1') {
                                txt += buildCitationsBlock(data.rag);
                            }
                            addMessage('assistant', txt || 'Done.');
                            // Contact ambiguity: render choice buttons as a follow-up UI element
                            if (data && data._choices && data._choices.length > 0) {
                                renderContactChoices(data._choices);
                            }
                            if (data && data.tools_used && data.tools_used.length > 0) {
                                updateActiveToolPills(data.tools_used);
                            }
                            incrementUsage({ model: effectiveModel, responseData: data || {} });
                            syncUsageFromApi();
                        }).catch(function () {
                            addMessage('assistant', 'Error: Unexpected API response. Please try again.');
                        });
                    })
                    .catch(function (err) {
                        clearTimeout(timeoutId);
                        var isAbort = err.name === 'AbortError';
                        var rawMsg = err && err.message ? err.message : '';
                        var isFetchFail = /failed to fetch|networkerror|load failed/i.test(rawMsg || '');
                        var friendly = isAbort
                            ? 'Request timed out. Try again.'
                            : (isFetchFail ? 'Could not reach the AI service. Check localhost API is running, then refresh and retry.' : (rawMsg || 'Check your connection and try again.'));
                        handleApiError(friendly, isAbort ? 408 : 0);
                    })
                    .then(function () { doneSending(); });
            }
        });
    }

    window.__mudragSend = doSend;

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        doSend();
    });

    if (sendBtn) {
        sendBtn.addEventListener('click', function (e) {
            e.preventDefault();
            doSend();
        });
    }

    function handleEnterSend(e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            e.stopPropagation();
            doSend();
            return false;
        }
    }
    if (input) {
        input.addEventListener('keydown', handleEnterSend);
    }
    form.addEventListener('keydown', function (e) {
        if (e.target === input && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            e.stopPropagation();
            doSend();
        }
    }, true);

    function autoGrowTextarea() {
        input.style.height = '1px';
        var h = input.scrollHeight;
        input.style.height = Math.min(Math.max(h, 24), 200) + 'px';
    }
    input.addEventListener('input', autoGrowTextarea);
    input.addEventListener('paste', function () { setTimeout(autoGrowTextarea, 0); });
    autoGrowTextarea();

    // ── Slash command menu ────────────────────────────────────────────────
    var SLASH_COMMANDS = [
        // Construction
        { cmd: '/estimate',  label: 'Estimate',          desc: 'Calculate cost for a job',              category: 'Construction', template: 'Estimate [qty] LF of [size] inch [pipe type]' },
        { cmd: '/proposal',  label: 'Generate Proposal', desc: 'Create a proposal document',            category: 'Construction', template: 'Generate a proposal for [client name]' },
        { cmd: '/schedule',  label: 'Build Schedule',    desc: 'Create a project schedule',             category: 'Construction', template: 'Build a schedule for [project name]' },
        { cmd: '/bid',       label: 'Start a Bid',       desc: 'Step-by-step bid worksheet',            category: 'Construction', template: 'Help me bid a [project type] job' },
        { cmd: '/work',      label: 'Find Work',         desc: 'Search for bids and jobs (AI chat)',     category: 'Construction', template: 'Find me a [trade] job' },
        { cmd: '/bids',      label: 'Bid Finder',        desc: 'Open the full bid finder tool (5 sources)', category: 'Construction', url: '/tools/bid-finder.html' },
        { cmd: '/plan',      label: 'Estimating Plan',   desc: 'Create a structured bid/estimating plan', category: 'Construction', template: 'Build an estimating plan for [project type]' },
        // Documents & Exports
        { cmd: '/csv',       label: 'Export CSV',        desc: 'Scan project files → bid items CSV',    category: 'Documents',    template: 'Create a CSV of the bid items' },
        { cmd: '/hcss',      label: 'Export to HCSS',    desc: 'HeavyBid-ready import CSV',             category: 'Documents',    template: 'Export to HCSS HeavyBid' },
        { cmd: '/bid2win',   label: 'Export to Bid2Win', desc: 'Bid2Win-ready import CSV',              category: 'Documents',    template: 'Export to Bid2Win' },
        { cmd: '/pdf',       label: 'Export PDF',        desc: 'Export estimate to PDF',                category: 'Documents',    template: 'Export to PDF' },
        // Productivity (desktop only)
        { cmd: '/calendar',  label: 'Add to Calendar',   desc: 'Schedule a meeting or event',           category: 'Productivity', template: 'Add to calendar: [event description on date at time]', desktopOnly: true },
        { cmd: '/reminder',  label: 'Set Reminder',      desc: 'Add a reminder',                        category: 'Productivity', template: 'Remind me to [task] on [date]', desktopOnly: true },
        { cmd: '/note',      label: 'Quick Note',        desc: 'Save a note to Apple Notes',            category: 'Productivity', template: 'Note: [your note here]', desktopOnly: true },
        { cmd: '/email',     label: 'Send Email',        desc: 'Compose and send an email',             category: 'Productivity', template: 'Send email to [name] about [subject]: [message]', desktopOnly: true },
        { cmd: '/weather',   label: 'Weather',           desc: 'Get current weather for a location',    category: 'Productivity', template: 'What\'s the weather in [city]?', desktopOnly: true },
        { cmd: '/mail',      label: 'Search Mail',       desc: 'Find emails in Mail.app',               category: 'Productivity', template: 'Find email from [sender] about [subject]', desktopOnly: true },
        { cmd: '/openclaw',  label: 'Link OpenClaw',     desc: 'Connect OpenClaw account for web agent use', category: 'System', template: '/openclaw enable key=[api_key] url=[base_url]/v1 model=[preferred_model]' },
        // System
        { cmd: '/desktop',   label: 'Organize Desktop',  desc: 'Sort and clean up Desktop files',       category: 'System',       template: 'Organize my desktop', desktopOnly: true },
        { cmd: '/downloads', label: 'Organize Downloads', desc: 'Sort and clean up Downloads folder',   category: 'System',       template: 'Organize my downloads', desktopOnly: true },
    ];

    var slashMenu = document.createElement('div');
    slashMenu.id = 'slash-command-menu';
    slashMenu.className = 'slash-cmd-menu';
    slashMenu.hidden = true;
    // Insert as first child of the form so position:relative on form anchors it
    if (form) form.prepend(slashMenu);

    var slashActiveIdx = -1;
    var slashVisible = [];

    function renderSlashMenu(query, preserveIdx) {
        var q = (query || '').toLowerCase();
        var isDesktop = !!(window.mudragDesktop);
        slashVisible = SLASH_COMMANDS.filter(function (c) {
            if (c.desktopOnly && !isDesktop) return false;
            return !q || c.cmd.includes(q) || c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q);
        });
        if (slashVisible.length === 0) { slashMenu.hidden = true; slashActiveIdx = -1; return; }

        // Clamp active index
        if (!preserveIdx) slashActiveIdx = -1;
        slashActiveIdx = Math.max(-1, Math.min(slashActiveIdx, slashVisible.length - 1));

        var lastCat = '';
        slashMenu.innerHTML = '';
        slashVisible.forEach(function (c, i) {
            if (c.category !== lastCat) {
                var catEl = document.createElement('div');
                catEl.className = 'slash-cmd-category';
                catEl.textContent = c.category;
                slashMenu.appendChild(catEl);
                lastCat = c.category;
            }
            var item = document.createElement('div');
            item.className = 'slash-cmd-item' + (i === slashActiveIdx ? ' active' : '');
            item.dataset.idx = i;
            item.innerHTML = '<span class="slash-cmd-name">' + c.cmd + '</span><span class="slash-cmd-label">' + c.label + '</span><span class="slash-cmd-desc">' + c.desc + '</span>';
            item.addEventListener('mousedown', function (e) {
                e.preventDefault();
                selectSlashCommand(i);
            });
            slashMenu.appendChild(item);
        });
        slashMenu.hidden = false;

        // Scroll active item into view
        if (slashActiveIdx >= 0) {
            var activeEl = slashMenu.querySelector('.slash-cmd-item.active');
            if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
        }
    }

    function selectSlashCommand(idx) {
        var cmd = slashVisible[idx];
        if (!cmd) return;
        slashMenu.hidden = true;
        slashActiveIdx = -1;
        // URL commands: navigate to tool page directly
        if (cmd.url) {
            var tpParam = toolPort ? (cmd.url.includes('?') ? '&' : '?') + 'toolPort=' + toolPort : '';
            window.location.href = cmd.url + tpParam;
            return;
        }
        input.value = cmd.template;
        input.focus();
        // Place cursor at first [...] placeholder
        var firstBracket = cmd.template.indexOf('[');
        var lastBracket = cmd.template.indexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1) {
            input.setSelectionRange(firstBracket, lastBracket + 1);
        }
        autoGrowTextarea();
    }

    function hideSlashMenu() {
        slashMenu.hidden = true;
        slashActiveIdx = -1;
    }

    input.addEventListener('input', function () {
        var val = input.value;
        if (val.startsWith('/')) {
            var q = val.slice(1);
            renderSlashMenu(q);
        } else {
            hideSlashMenu();
        }
    });

    input.addEventListener('keydown', function (e) {
        if (slashMenu.hidden) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            slashActiveIdx = slashActiveIdx < slashVisible.length - 1 ? slashActiveIdx + 1 : 0;
            renderSlashMenu(input.value.slice(1), true);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            slashActiveIdx = slashActiveIdx > 0 ? slashActiveIdx - 1 : slashVisible.length - 1;
            renderSlashMenu(input.value.slice(1), true);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (slashActiveIdx >= 0) {
                e.preventDefault();
                selectSlashCommand(slashActiveIdx);
            } else if (slashVisible.length > 0 && e.key === 'Tab') {
                e.preventDefault();
                selectSlashCommand(0);
            }
        } else if (e.key === 'Escape') {
            hideSlashMenu();
        }
    }, true);

    document.addEventListener('click', function (e) {
        if (!slashMenu.contains(e.target) && e.target !== input) hideSlashMenu();
    });
    // ── End slash command menu ────────────────────────────────────────────

    if (btnOpenFolder && window.mudragDesktop && window.mudragDesktop.openFolder) {
        btnOpenFolder.hidden = false;
        btnOpenFolder.addEventListener('click', function () {
            window.mudragDesktop.openFolder().then(function (folderPath) {
                if (!folderPath) return;
                fetch(API_BASE + '/storage/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: folderPath })
                }).then(function (r) { return r.json(); }).then(function (proj) {
                    if (proj && proj.id) {
                        var projects = getProjects();
                        var exists = projects.find(function (p) { return p.path === proj.path || p.id === proj.id; });
                        if (!exists) {
                            projects.unshift(proj);
                            setProjects(projects);
                        }
                        switchProject(proj.id);
                    }
                }).catch(function () {
                    addMessage('assistant', 'Could not add project. Make sure you\'re running the desktop app.');
                });
            });
        });
    }

    function loadStorageProjects(cb) {
        if (!(isToolServerOrigin || (useDesktopApi && toolPort)) || !API_BASE) { if (cb) cb(); return; }
        fetch(API_BASE + '/storage/projects').then(function (r) { return r.json(); }).then(function (storageProjects) {
            if (Array.isArray(storageProjects) && storageProjects.length > 0) {
                localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(storageProjects));
            }
            if (cb) cb();
        }).catch(function () { if (cb) cb(); });
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

    var btnSettings = document.getElementById('btn-settings');
    var settingsDropdown = document.getElementById('settings-dropdown');
    var btnSettingsWeb = document.getElementById('btn-settings-web');
    function closeSettingsDropdown() {
        if (settingsDropdown) settingsDropdown.hidden = true;
        if (btnSettings) btnSettings.setAttribute('aria-expanded', 'false');
        if (btnSettingsWeb) btnSettingsWeb.setAttribute('aria-expanded', 'false');
    }
    var btnProfile = document.getElementById('btn-profile');
    var modalProfile = document.getElementById('modal-profile');
    var btnProfileCancel = document.getElementById('btn-profile-cancel');
    var btnProfileSave = document.getElementById('btn-profile-save');
    var btnRates = document.getElementById('btn-rates');
    var modalRates = document.getElementById('modal-rates');
    var btnRatesCancel = document.getElementById('btn-rates-cancel');
    var btnRatesSave = document.getElementById('btn-rates-save');

    if (btnProfile && (isToolServerOrigin || isDesktopApp)) {
        btnProfile.hidden = false;
        btnProfile.addEventListener('click', function () {
            closeSettingsDropdown();
            fetch(API_BASE + '/storage/profile').then(function (r) { return r.json(); }).then(function (profile) {
                var rc = profile.resume_content || {};
                document.getElementById('profile-name').value = profile.name || '';
                document.getElementById('profile-email').value = profile.email || '';
                document.getElementById('profile-phone').value = profile.phone || '';
                document.getElementById('profile-city').value = profile.city || '';
                document.getElementById('profile-title').value = profile.title || '';
                document.getElementById('profile-linkedin').value = profile.linkedin || '';
                document.getElementById('profile-website').value = profile.website || '';
                document.getElementById('profile-summary').value = rc.summary || '';
                document.getElementById('profile-skills').value = Array.isArray(rc.skills) ? rc.skills.join(', ') : (rc.skills || '');
                modalProfile.hidden = false;
            }).catch(function () {
                addMessage('assistant', 'Could not load profile. Run from the desktop app.');
            });
        });
    }
    if (modalProfile) {
        modalProfile.addEventListener('click', function (e) { if (e.target === modalProfile) modalProfile.hidden = true; });
        if (btnProfileCancel) btnProfileCancel.addEventListener('click', function () { modalProfile.hidden = true; });
        if (btnProfileSave) btnProfileSave.addEventListener('click', function () {
            var skillsVal = document.getElementById('profile-skills').value.trim();
            var skills = skillsVal ? skillsVal.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
            var payload = {
                name: document.getElementById('profile-name').value.trim(),
                email: document.getElementById('profile-email').value.trim(),
                phone: document.getElementById('profile-phone').value.trim(),
                city: document.getElementById('profile-city').value.trim(),
                title: document.getElementById('profile-title').value.trim(),
                linkedin: document.getElementById('profile-linkedin').value.trim(),
                website: document.getElementById('profile-website').value.trim(),
                resume_content: {
                    summary: document.getElementById('profile-summary').value.trim(),
                    skills: skills.length ? skills : undefined
                }
            };
            fetch(API_BASE + '/storage/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(function (r) { return r.json(); }).then(function () {
                modalProfile.hidden = true;
                addMessage('assistant', 'Profile saved. Say "help me build my resume" to create a PDF.');
            }).catch(function () {
                addMessage('assistant', 'Could not save profile.');
            });
        });
    }

    if (btnRates && (isToolServerOrigin || isDesktopApp)) {
        btnRates.hidden = false;
        btnRates.addEventListener('click', function () {
            closeSettingsDropdown();
            fetch(API_BASE + '/storage/rates').then(function (r) { return r.json(); }).then(function (rates) {
                var laborEl = document.getElementById('rates-labor');
                var equipEl = document.getElementById('rates-equipment');
                if (laborEl) {
                    laborEl.innerHTML = '';
                    Object.keys(rates.labor || {}).forEach(function (k) {
                        var row = document.createElement('div');
                        row.className = 'rates-row';
                        row.innerHTML = '<label>' + k + '</label><input type="number" data-type="labor" data-key="' + k + '" value="' + (rates.labor[k] || 0) + '" min="0" step="1">';
                        laborEl.appendChild(row);
                    });
                }
                if (equipEl) {
                    equipEl.innerHTML = '';
                    Object.keys(rates.equipment || {}).forEach(function (k) {
                        var row = document.createElement('div');
                        row.className = 'rates-row';
                        row.innerHTML = '<label>' + k + '</label><input type="number" data-type="equipment" data-key="' + k + '" value="' + (rates.equipment[k] || 0) + '" min="0" step="1">';
                        equipEl.appendChild(row);
                    });
                }
                modalRates.hidden = false;
            }).catch(function () {
                addMessage('assistant', 'Could not load rates. Run from the desktop app.');
            });
        });
    }
    if (modalRates) {
        modalRates.addEventListener('click', function (e) { if (e.target === modalRates) modalRates.hidden = true; });
        if (btnRatesCancel) btnRatesCancel.addEventListener('click', function () { modalRates.hidden = true; });
        if (btnRatesSave) btnRatesSave.addEventListener('click', function () {
            var labor = {}, equipment = {};
            modalRates.querySelectorAll('input[data-type="labor"]').forEach(function (inp) {
                labor[inp.dataset.key] = parseFloat(inp.value) || 0;
            });
            modalRates.querySelectorAll('input[data-type="equipment"]').forEach(function (inp) {
                equipment[inp.dataset.key] = parseFloat(inp.value) || 0;
            });
            fetch(API_BASE + '/storage/rates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ labor: labor, equipment: equipment })
            }).then(function (r) { return r.json(); }).then(function () {
                modalRates.hidden = true;
                addMessage('assistant', 'Rates saved. mud1 will use these when building bids.');
            }).catch(function () {
                addMessage('assistant', 'Could not save rates.');
            });
        });
    }
    // ── Data Sync ────────────────────────────────────────────────────────────
    var btnDataSync = document.getElementById('btn-data-sync');
    var modalDataSync = document.getElementById('modal-data-sync');
    var btnDataSyncClose = document.getElementById('btn-data-sync-close');
    var btnSyncContacts = document.getElementById('btn-sync-contacts');
    var btnSyncEmails = document.getElementById('btn-sync-emails');
    var btnSyncAll = document.getElementById('btn-sync-all');

    function formatSyncDate(iso) {
        if (!iso) return 'Not synced';
        var d = new Date(iso);
        return 'Last synced ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function loadDataSyncStatus() {
        if (!isToolServerOrigin && !isDesktopApp) return;
        fetch(API_BASE + '/data-sync/status').then(function (r) { return r.json(); }).then(function (s) {
            var cEl = document.getElementById('data-sync-contacts-status');
            var eEl = document.getElementById('data-sync-emails-status');
            if (cEl) cEl.textContent = s.contactCount ? formatSyncDate(s.lastSyncedContacts) + ' (' + s.contactCount + ' contacts)' : 'Not synced';
            if (eEl) eEl.textContent = s.emailCount ? formatSyncDate(s.lastSyncedEmails) + ' (' + s.emailCount + ' emails)' : 'Not synced';
        }).catch(function () {});
    }

    function doSyncContacts(btn) {
        var orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Syncing…';
        fetch(API_BASE + '/data-sync/contacts', { method: 'POST' })
            .then(function (r) { return r.json(); })
            .then(function (result) {
                btn.disabled = false;
                btn.textContent = orig;
                var cEl = document.getElementById('data-sync-contacts-status');
                if (result.ok) {
                    if (cEl) cEl.textContent = 'Synced just now (' + result.count + ' contacts)';
                } else {
                    if (cEl) cEl.textContent = 'Error: ' + (result.error || 'Unknown error');
                }
            }).catch(function () {
                btn.disabled = false;
                btn.textContent = orig;
            });
    }

    function doSyncEmails(btn) {
        var orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Syncing…';
        fetch(API_BASE + '/data-sync/emails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ since: '30 days', limit: 150 }) })
            .then(function (r) { return r.json(); })
            .then(function (result) {
                btn.disabled = false;
                btn.textContent = orig;
                var eEl = document.getElementById('data-sync-emails-status');
                if (result.ok) {
                    if (eEl) eEl.textContent = 'Synced just now (' + result.count + ' emails)';
                } else {
                    if (eEl) eEl.textContent = 'Error: ' + (result.error || 'Unknown error');
                }
            }).catch(function () {
                btn.disabled = false;
                btn.textContent = orig;
            });
    }

    if (btnDataSync && (isToolServerOrigin || isDesktopApp)) {
        btnDataSync.hidden = false;
        btnDataSync.addEventListener('click', function () {
            closeSettingsDropdown();
            loadDataSyncStatus();
            modalDataSync.hidden = false;
        });
    }
    if (modalDataSync) {
        modalDataSync.addEventListener('click', function (e) { if (e.target === modalDataSync) modalDataSync.hidden = true; });
        if (btnDataSyncClose) btnDataSyncClose.addEventListener('click', function () { modalDataSync.hidden = true; });
        if (btnSyncContacts) btnSyncContacts.addEventListener('click', function () { doSyncContacts(btnSyncContacts); });
        if (btnSyncEmails) btnSyncEmails.addEventListener('click', function () { doSyncEmails(btnSyncEmails); });
        if (btnSyncAll) btnSyncAll.addEventListener('click', function () {
            doSyncContacts(btnSyncContacts || { disabled: false, textContent: '' });
            doSyncEmails(btnSyncEmails || { disabled: false, textContent: '' });
        });
    }

    // ── Resume Builder ───────────────────────────────────────────────────────
    var btnResumeBuilder = document.getElementById('btn-resume-builder');
    var modalResumeBuilder = document.getElementById('modal-resume-builder');
    var btnResumeBuilderClose = document.getElementById('btn-resume-builder-close');
    var resumeChatForm = document.getElementById('resume-chat-form');
    var resumeChatInput = document.getElementById('resume-chat-input');
    var resumeChatMessages = document.getElementById('resume-chat-messages');
    var btnGenerateResumePdf = document.getElementById('btn-generate-resume-pdf');

    var _resumeContent = { summary: '', experience: [], skills: [], education: [] };

    function renderResumePreview() {
        var summaryEl = document.getElementById('resume-preview-summary');
        var expEl = document.getElementById('resume-preview-experience');
        var skillsEl = document.getElementById('resume-preview-skills');
        var eduEl = document.getElementById('resume-preview-education');
        if (summaryEl) summaryEl.textContent = _resumeContent.summary || '—';
        if (expEl) {
            if (_resumeContent.experience && _resumeContent.experience.length) {
                expEl.textContent = _resumeContent.experience.map(function (e) {
                    return (e.title || '') + (e.subtitle ? ' — ' + e.subtitle : '') + (e.dates ? ' (' + e.dates + ')' : '');
                }).join('\n');
            } else {
                expEl.textContent = '—';
            }
        }
        if (skillsEl) {
            var sk = _resumeContent.skills;
            skillsEl.textContent = Array.isArray(sk) ? sk.join(', ') : (sk || '—');
        }
        if (eduEl) {
            if (_resumeContent.education && _resumeContent.education.length) {
                eduEl.textContent = _resumeContent.education.map(function (e) {
                    return (e.name || '') + (e.year ? ' (' + e.year + ')' : '');
                }).join('\n');
            } else {
                eduEl.textContent = '—';
            }
        }
    }

    function loadResumeContent() {
        if (!isToolServerOrigin && !isDesktopApp) return;
        fetch(API_BASE + '/storage/profile').then(function (r) { return r.json(); }).then(function (profile) {
            var rc = profile.resume_content || {};
            _resumeContent = {
                summary: rc.summary || '',
                experience: rc.experience || [],
                skills: rc.skills || [],
                education: rc.education || [],
            };
            renderResumePreview();
        }).catch(function () {});
    }

    function addResumeChatMessage(role, text) {
        if (!resumeChatMessages) return;
        var div = document.createElement('div');
        div.className = 'resume-chat-msg resume-chat-msg-' + role;
        div.textContent = text;
        resumeChatMessages.appendChild(div);
        resumeChatMessages.scrollTop = resumeChatMessages.scrollHeight;
    }

    function parseAndApplyResumeUpdate(text) {
        var match = text.match(/```resume_update\s*([\s\S]*?)```/);
        if (!match) {
            match = text.match(/\[RESUME_UPDATE\]([\s\S]*?)\[\/RESUME_UPDATE\]/);
        }
        if (!match) return false;
        try {
            var update = JSON.parse(match[1].trim());
            if (update.summary !== undefined) _resumeContent.summary = update.summary;
            if (update.experience !== undefined) _resumeContent.experience = update.experience;
            if (update.skills !== undefined) _resumeContent.skills = update.skills;
            if (update.education !== undefined) _resumeContent.education = update.education;
            // Persist to storage
            fetch(API_BASE + '/storage/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resume_content: _resumeContent })
            }).catch(function () {});
            renderResumePreview();
            return true;
        } catch (_) { return false; }
    }

    function sendResumeChatMessage(text) {
        if (!text.trim()) return;
        addResumeChatMessage('user', text);
        if (resumeChatInput) resumeChatInput.value = '';

        var systemPrompt = 'You are a resume writing assistant integrated into openmud. ' +
            'Help the user build and improve their resume through conversation. ' +
            'When you want to update resume sections, include a JSON block wrapped in triple-backtick resume_update like:\n' +
            '```resume_update\n{"summary":"...","skills":["..."],"experience":[{"title":"...","subtitle":"...","dates":"...","bullets":["..."]}],"education":[{"name":"...","year":"...","detail":"..."}]}\n```\n' +
            'Only include sections you are updating. Be conversational and helpful. ' +
            'Current resume content: ' + JSON.stringify(_resumeContent);

        var messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
        ];

        // Collect existing chat for context
        if (resumeChatMessages) {
            var existing = resumeChatMessages.querySelectorAll('.resume-chat-msg');
            var history = [];
            existing.forEach(function (el) {
                var role = el.classList.contains('resume-chat-msg-user') ? 'user' : 'assistant';
                history.push({ role: role, content: el.textContent });
            });
            if (history.length > 2) {
                messages = [{ role: 'system', content: systemPrompt }].concat(history.slice(-10)).concat([{ role: 'user', content: text }]);
            }
        }

        fetch(API_BASE + '/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'mud1', messages: messages })
        }).then(function (r) { return r.json(); }).then(function (data) {
            var response = data.response || data.content || 'I had trouble responding. Try again.';
            parseAndApplyResumeUpdate(response);
            var displayText = response.replace(/```resume_update[\s\S]*?```/g, '').replace(/\[RESUME_UPDATE\][\s\S]*?\[\/RESUME_UPDATE\]/g, '').trim();
            addResumeChatMessage('assistant', displayText || 'Resume sections updated.');
        }).catch(function () {
            addResumeChatMessage('assistant', 'Could not reach the AI. Make sure the desktop app is running.');
        });
    }

    if (btnResumeBuilder && (isToolServerOrigin || isDesktopApp)) {
        btnResumeBuilder.hidden = false;
        btnResumeBuilder.addEventListener('click', function () {
            closeSettingsDropdown();
            loadResumeContent();
            if (resumeChatMessages && resumeChatMessages.children.length === 0) {
                addResumeChatMessage('assistant', "Hi! I'm here to help you build your resume. Tell me about your work experience, skills, or education — or ask me to update any section. What would you like to work on?");
            }
            modalResumeBuilder.hidden = false;
        });
    }
    if (modalResumeBuilder) {
        modalResumeBuilder.addEventListener('click', function (e) { if (e.target === modalResumeBuilder) modalResumeBuilder.hidden = true; });
        if (btnResumeBuilderClose) btnResumeBuilderClose.addEventListener('click', function () { modalResumeBuilder.hidden = true; });
        if (resumeChatForm) {
            resumeChatForm.addEventListener('submit', function (e) {
                e.preventDefault();
                var text = resumeChatInput ? resumeChatInput.value.trim() : '';
                if (text) sendResumeChatMessage(text);
            });
        }
        if (resumeChatInput) {
            resumeChatInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    var text = resumeChatInput.value.trim();
                    if (text) sendResumeChatMessage(text);
                }
            });
        }
        if (btnGenerateResumePdf) {
            btnGenerateResumePdf.addEventListener('click', function () {
                var orig = btnGenerateResumePdf.textContent;
                btnGenerateResumePdf.disabled = true;
                btnGenerateResumePdf.textContent = 'Generating…';
                fetch(API_BASE + '/resume/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: _resumeContent })
                }).then(function (r) { return r.json(); }).then(function (data) {
                    btnGenerateResumePdf.disabled = false;
                    btnGenerateResumePdf.textContent = orig;
                    if (data.error) {
                        addResumeChatMessage('assistant', 'Error generating PDF: ' + data.error);
                    } else {
                        addResumeChatMessage('assistant', 'Your resume PDF is ready on your Desktop: ' + data.filename + '. You can also say "build my resume" in the main chat any time.');
                    }
                }).catch(function () {
                    btnGenerateResumePdf.disabled = false;
                    btnGenerateResumePdf.textContent = orig;
                    addResumeChatMessage('assistant', 'Could not generate PDF. Make sure Chrome is installed and the desktop app is running.');
                });
            });
        }
    }

    var layoutItems = document.querySelectorAll('.dropdown-layout-item');
    var toggleRightPanelBtn = document.getElementById('toggle-right-panel');

    function getMainViewPreference() {
        var pref = localStorage.getItem(STORAGE_MAIN_VIEW);
        return pref === 'canvas' ? 'canvas' : 'chat';
    }

    function applyMainViewPreference() {
        if (!mainWrapper) return;
        mainWrapper.classList.remove('layout-canvas-main');
        mainWrapper.classList.add('layout-chat-main');
        renderDocuments();
        if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
    }

    function isRightPanelVisible() {
        var raw = localStorage.getItem(STORAGE_RIGHT_PANEL_VISIBLE);
        return raw === 'true';
    }

    function applyRightPanelVisibility() {
        if (!mainWrapper || !toggleRightPanelBtn) return;
        var stored = isRightPanelVisible();
        mainWrapper.classList.toggle('right-panel-hidden', !stored);
        // For the checkmark, use actual DOM state — a document can open the canvas
        // without updating localStorage, so DOM is the source of truth for display.
        var actuallyVisible = !mainWrapper.classList.contains('right-panel-hidden');
        toggleRightPanelBtn.classList.toggle('dropdown-item-active', actuallyVisible);
        toggleRightPanelBtn.textContent = (actuallyVisible ? '✓ ' : '') + 'Canvas';
    }

    window.addEventListener('mudrag-main-view-change', function () {
        renderDocuments();
        if (window.mudrag && window.mudrag.renderCanvas) window.mudrag.renderCanvas();
    });

    // ── Hide / Show chat panel ───────────────────────────────────────────────
    var STORAGE_CHAT_HIDDEN = 'mudrag_chat_hidden';
    // Always start with chat visible; user can hide within a session
    try { localStorage.removeItem(STORAGE_CHAT_HIDDEN); } catch (e) {}
    var toggleChatBtn = document.getElementById('toggle-chat-panel');

    function isChatHidden() {
        return localStorage.getItem(STORAGE_CHAT_HIDDEN) === 'true';
    }

    function applyChatVisibility() {
        if (!mainWrapper || !toggleChatBtn) return;
        var hidden = isChatHidden();
        mainWrapper.classList.toggle('chat-hidden', hidden);
        toggleChatBtn.classList.toggle('dropdown-item-active', !hidden);
        toggleChatBtn.textContent = (!hidden ? '✓ ' : '') + 'Chat panel';
        // When hiding chat, also ensure the document panel is visible
        if (hidden && mainWrapper.classList.contains('right-panel-hidden')) {
            mainWrapper.classList.remove('right-panel-hidden');
            try { localStorage.setItem(STORAGE_RIGHT_PANEL_VISIBLE, 'true'); } catch (e) {}
            if (toggleRightPanelBtn) {
                toggleRightPanelBtn.classList.add('dropdown-item-active');
                toggleRightPanelBtn.textContent = '✓ Canvas';
            }
        }
        if (window.mudrag && window.mudrag.renderCanvas) {
            setTimeout(function () { window.mudrag.renderCanvas(); }, 50);
        }
    }

    if (toggleChatBtn) {
        toggleChatBtn.addEventListener('click', function () {
            var nowHidden = !isChatHidden();
            try { localStorage.setItem(STORAGE_CHAT_HIDDEN, String(nowHidden)); } catch (e) {}
            applyChatVisibility();
            closeSettingsDropdown();
        });
    }

    // Apply on load
    applyChatVisibility();

    var btnExportProject = document.getElementById('btn-export-project');
    if (btnExportProject) {
        btnExportProject.addEventListener('click', function () {
            closeSettingsDropdown();
            if (!activeProjectId) {
                addMessage('assistant', 'Select a project first, then use Save project backup.');
                return;
            }
            var projects = getProjects();
            var proj = projects.find(function (p) { return p.id === activeProjectId; });
            if (!proj) return;
            btnExportProject.disabled = true;
            btnExportProject.textContent = 'Saving…';
            getMessages(activeProjectId).then(function (msgs) {
                return getDocuments(activeProjectId).then(function (docs) {
                    return getFolders(activeProjectId).then(function (folders) {
                        var backup = {
                            version: 1,
                            exportedAt: new Date().toISOString(),
                            project: { id: proj.id, name: proj.name },
                            messages: msgs || [],
                            folders: (folders || []).map(function (f) { return { id: f.id, name: f.name }; }),
                            documents: (docs || []).map(function (d) {
                                var data = d.data;
                                var b64 = '';
                                if (data instanceof ArrayBuffer) {
                                    var bytes = new Uint8Array(data);
                                    var bin = '';
                                    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
                                    b64 = btoa(bin);
                                }
                                return { id: d.id, name: d.name, type: d.type, size: d.size, folderId: d.folderId || null, data: b64 };
                            })
                        };
                        var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                        var a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = 'mudrag-backup-' + (proj.name || 'project').replace(/[^a-zA-Z0-9\u0020-]/g, '').replace(/\s+/g, '-').slice(0, 30) + '-' + new Date().toISOString().slice(0, 10) + '.json';
                        a.click();
                        URL.revokeObjectURL(a.href);
                        btnExportProject.disabled = false;
                        btnExportProject.textContent = 'Save project backup';
                    });
                });
            }).catch(function (err) {
                console.error('Export failed:', err);
                btnExportProject.disabled = false;
                btnExportProject.textContent = 'Save project backup';
                addMessage('assistant', 'Could not save backup. Try again.');
            });
        });
    }

    if (toggleRightPanelBtn) {
        toggleRightPanelBtn.addEventListener('click', function (e) {
            e.preventDefault();
            localStorage.setItem(STORAGE_RIGHT_PANEL_VISIBLE, isRightPanelVisible() ? 'false' : 'true');
            applyRightPanelVisibility();
        });
    }

    // Desktop app: all external links (settings, billing, account) open in the system browser.
    // The app is the AI assistant; the website handles account/billing/settings.
    if (isDesktopApp || useDesktopApi) {
        document.querySelectorAll('[data-open-external]').forEach(function (a) {
            a.addEventListener('click', function (e) {
                e.preventDefault();
                var href = a.href || '';
                if (href && window.mudragDesktop && window.mudragDesktop.openExternal) {
                    window.mudragDesktop.openExternal(href);
                } else if (href) {
                    window.open(href, '_blank');
                }
            });
        });
    }

    function positionSettingsDropdown(dropdown, trigger) {
        if (!dropdown || !trigger) return;
        var r = trigger.getBoundingClientRect();
        var viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
        var viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
        var pad = 8;
        var minTop = pad;
        var lpNav = document.querySelector('.lp-nav');
        if (lpNav) {
            var navRect = lpNav.getBoundingClientRect();
            if (navRect && navRect.bottom) minTop = Math.max(minTop, Math.round(navRect.bottom + 2));
        }

        // Use fixed positioning so coordinates are relative to viewport, not
        // the portal container box.
        dropdown.style.position = 'fixed';
        dropdown.style.left = '0px';
        dropdown.style.top = '0px';
        dropdown.style.right = 'auto';
        dropdown.style.visibility = 'hidden';
        dropdown.hidden = false;
        var dw = dropdown.offsetWidth || 180;
        var dh = dropdown.offsetHeight || 0;
        dropdown.hidden = true;
        dropdown.style.visibility = '';

        var leftPos = Math.round(r.right - dw);
        if (leftPos < pad) leftPos = pad;
        if (leftPos + dw > viewportW - pad) leftPos = Math.max(pad, viewportW - dw - pad);

        // Keep settings menu below the button so it never blocks dismiss clicks.
        var topPos = Math.round(r.bottom + 2);
        if (topPos < minTop) topPos = minTop;
        if (dh && topPos + dh > viewportH - pad) {
            topPos = Math.max(minTop, viewportH - dh - pad);
        }

        dropdown.style.left = leftPos + 'px';
        dropdown.style.top = topPos + 'px';
    }

    [btnSettings, btnSettingsWeb].forEach(function (btn) {
        if (!btn || !settingsDropdown) return;
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var open = !settingsDropdown.hidden;
            closeSettingsDropdown();
            if (!open) {
                // Refresh view-toggle checkmarks to reflect actual DOM state before showing
                applyRightPanelVisibility();
                applyChatVisibility();
                positionSettingsDropdown(settingsDropdown, btn);
                settingsDropdown.hidden = false;
                btn.setAttribute('aria-expanded', 'true');
            }
        });
    });
    if (settingsDropdown) settingsDropdown.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () {
        closeSettingsDropdown();
    });

    modalNewProject.addEventListener('click', function (e) {
        if (e.target === modalNewProject) modalNewProject.hidden = true;
    });

    var btnNewChat = document.getElementById('btn-new-chat');
    if (btnNewChat) {
        btnNewChat.addEventListener('click', function () {
            if (!activeProjectId) return;
            var cid = createNewChat(activeProjectId);
            switchChat(activeProjectId, cid);
        });
    }

    var btnCopyChat = document.getElementById('btn-copy-chat');
    if (btnCopyChat) {
        btnCopyChat.addEventListener('click', function () {
            var msgs = getMessages(activeProjectId);
            if (!msgs || msgs.length === 0) { showToast('No messages to copy.'); return; }
            var text = msgs.map(function (m) {
                return (m.role === 'user' ? 'You' : 'openmud') + ':\n' + (m.content || '').replace(/\[MUDRAG_[A-Z_]+\][\s\S]*?\[\/MUDRAG_[A-Z_]+\]/g, '').trim();
            }).filter(function (s) { return s.length > 6; }).join('\n\n---\n\n');
            navigator.clipboard.writeText(text).then(function () {
                var orig = btnCopyChat.innerHTML;
                btnCopyChat.title = 'Copied!';
                btnCopyChat.innerHTML = '<svg class="chat-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
                setTimeout(function () { btnCopyChat.innerHTML = orig; btnCopyChat.title = 'Copy chat to clipboard'; }, 1800);
                showToast('Chat copied to clipboard.');
            }).catch(function () { showToast('Could not copy — try selecting text manually.'); });
        });
    }

    // Position a fixed dropdown above its trigger button using screen coordinates.
    // This avoids all overflow:hidden clipping from ancestor containers.
    function positionDropdownAbove(dropdown, trigger) {
        var r = trigger.getBoundingClientRect();
        dropdown.style.left = r.left + 'px';
        dropdown.style.top = '';
        dropdown.style.bottom = '';
        // Show off-screen first so we can measure height
        dropdown.style.visibility = 'hidden';
        dropdown.hidden = false;
        var dh = dropdown.offsetHeight;
        dropdown.hidden = true;
        dropdown.style.visibility = '';
        var topPos = r.top - dh - 6;
        if (topPos < 8) topPos = r.bottom + 6; // flip below if not enough space above
        dropdown.style.top = topPos + 'px';
    }

    function closeAllComposerDropdowns() {
        var el = document.getElementById('model-dropdown');
        if (el) el.hidden = true;
        el = document.getElementById('model-select-trigger');
        if (el) el.setAttribute('aria-expanded', 'false');
        el = document.getElementById('agent-mode-dropdown');
        if (el) el.hidden = true;
        el = document.getElementById('agent-mode-trigger');
        if (el) el.setAttribute('aria-expanded', 'false');
        el = document.getElementById('tools-dropdown-bar');
        if (el) el.hidden = true;
        el = document.getElementById('tools-trigger');
        if (el) el.setAttribute('aria-expanded', 'false');
    }

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
            closeAllComposerDropdowns();
            if (!open) {
                positionDropdownAbove(modelDropdown, modelTrigger);
                modelDropdown.hidden = false;
                modelTrigger.setAttribute('aria-expanded', 'true');
            }
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
        document.addEventListener('click', function () { closeAllComposerDropdowns(); });
    } else if (modelSelect) {
        var saved = localStorage.getItem(STORAGE_MODEL);
        if (saved) modelSelect.value = saved;
        modelSelect.addEventListener('change', function () { localStorage.setItem(STORAGE_MODEL, modelSelect.value); });
    }

    var agentModeSelect = document.getElementById('agent-mode-select');
    var agentModeTrigger = document.getElementById('agent-mode-trigger');
    var agentModeDropdown = document.getElementById('agent-mode-dropdown');
    var agentModeLabel = document.getElementById('agent-mode-label');
    if (agentModeSelect && agentModeTrigger && agentModeDropdown && agentModeLabel) {
        var savedMode = localStorage.getItem(STORAGE_AGENT_MODE) || 'agent';
        if (savedMode === 'ask' || savedMode === 'agent') agentModeSelect.value = savedMode;
        function updateAgentModeLabel() {
            agentModeLabel.textContent = agentModeSelect.value === 'ask' ? 'Ask' : 'Agent';
            agentModeDropdown.querySelectorAll('.model-dropdown-item').forEach(function (btn) {
                btn.setAttribute('aria-selected', btn.getAttribute('data-value') === agentModeSelect.value ? 'true' : 'false');
            });
        }
        updateAgentModeLabel();
        agentModeTrigger.addEventListener('click', function (e) {
            e.stopPropagation();
            var open = !agentModeDropdown.hidden;
            closeAllComposerDropdowns();
            if (!open) {
                positionDropdownAbove(agentModeDropdown, agentModeTrigger);
                agentModeDropdown.hidden = false;
                agentModeTrigger.setAttribute('aria-expanded', 'true');
            }
        });
        agentModeDropdown.addEventListener('click', function (e) { e.stopPropagation(); });
        agentModeDropdown.querySelectorAll('.model-dropdown-item').forEach(function (btn) {
            btn.addEventListener('click', function () {
                agentModeSelect.value = btn.getAttribute('data-value');
                localStorage.setItem(STORAGE_AGENT_MODE, agentModeSelect.value);
                updateAgentModeLabel();
                agentModeDropdown.hidden = true;
                agentModeTrigger.setAttribute('aria-expanded', 'false');
            });
        });
        document.addEventListener('click', function () { closeAllComposerDropdowns(); });
    }

    (function initDevAccess() {
        var toggleBtn = document.getElementById('btn-dev-access-toggle');
        var signInBtn = document.getElementById('btn-go-sign-in');
        var section = document.getElementById('dev-access-section');
        var submitBtn = document.getElementById('btn-dev-access-submit');
        var devInput = document.getElementById('dev-access-input');
        var errorEl = document.getElementById('dev-access-error');
        var successEl = document.getElementById('dev-access-success');
        if (signInBtn) {
            signInBtn.addEventListener('click', function () {
                var next = '/try';
                try {
                    var path = (window.location.pathname || '/try') + (window.location.search || '') + (window.location.hash || '');
                    if (path && path.charAt(0) === '/' && !/^\/welcome(?:\.html)?(?:[?#]|$)/i.test(path)) {
                        next = path;
                    }
                } catch (e) {}
                window.location.href = '/welcome.html?next=' + encodeURIComponent(next);
            });
        }
        if (toggleBtn && section) {
            toggleBtn.addEventListener('click', function () {
                section.hidden = !section.hidden;
                if (errorEl) errorEl.hidden = true;
                if (successEl) successEl.hidden = true;
                if (!section.hidden && devInput) devInput.focus();
            });
        }
        if (submitBtn && devInput) {
            function tryUnlock() {
                var val = String(devInput.value || '').trim().toLowerCase();
                if (val === DEV_KEY.toLowerCase()) {
                    localStorage.setItem('mudrag_dev_unlimited', 'true');
                    try { localStorage.setItem(STORAGE_USAGE, JSON.stringify({ date: new Date().toISOString().slice(0, 10), count: 0 })); } catch (e) {}
                    var modal = document.getElementById('modal-upgrade');
                    if (errorEl) errorEl.hidden = true;
                    if (successEl) successEl.hidden = false;
                    devInput.value = '';
                    setTimeout(function () {
                        if (successEl) successEl.hidden = true;
                        if (modal) modal.hidden = true;
                    }, 900);
                } else {
                    if (successEl) successEl.hidden = true;
                    if (errorEl) { errorEl.hidden = false; errorEl.textContent = 'Invalid key.'; }
                    devInput.value = '';
                    devInput.focus();
                }
            }
            submitBtn.addEventListener('click', tryUnlock);
            devInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); tryUnlock(); }
            });
        }
    })();

    function getActiveProjectName() {
        var project = getProjects().find(function (p) { return p.id === activeProjectId; });
        return (project && project.name) ? project.name : 'Project';
    }

    function runDesktopToolRequest(tool, params) {
        return fetch('/run-tool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: tool, params: params || {} })
        }).then(function (r) {
            if (!r.ok) throw new Error('Desktop tools unavailable');
            return r.json();
        });
    }

    function indexProjectDocsBulk(projectId, docs) {
        var queue = Promise.resolve({ indexed: 0, skipped: 0 });
        (docs || []).forEach(function (doc) {
            queue = queue.then(function (acc) {
                return indexDocumentForProjectRag(projectId, doc, {
                    source: doc.source || 'project-upload',
                    source_meta: doc.source_meta || {}
                }).then(function (ok) {
                    if (ok) acc.indexed += 1;
                    else acc.skipped += 1;
                    return acc;
                });
            });
        });
        return queue;
    }

    function initPmOpsPane() {
        var pane = document.getElementById('pm-ops-pane');
        if (!pane || pane._mudragPmInit) return;
        pane._mudragPmInit = true;

        var refreshBtn = document.getElementById('pm-ops-refresh');
        var statsEl = document.getElementById('pm-ops-stats');
        var boardEl = document.getElementById('pm-ops-board');
        var intelQueryEl = document.getElementById('pm-intel-query');
        var intelSearchBtn = document.getElementById('pm-intel-search');
        var intelAskBtn = document.getElementById('pm-intel-ask-chat');
        var intelReindexBtn = document.getElementById('pm-intel-reindex');
        var intelResultsEl = document.getElementById('pm-intel-results');
        var inboxResultsEl = document.getElementById('pm-inbox-results');
        var inboxMorningBtn = document.getElementById('pm-inbox-morning-review');
        var inboxRfqBtn = document.getElementById('pm-inbox-pull-rfq');
        var inboxPricingBtn = document.getElementById('pm-inbox-unanswered-pricing');
        var inboxRevisionBtn = document.getElementById('pm-inbox-import-revisions');
        var quickBtns = pane.querySelectorAll('[data-pm-quick]');
        var lastIntelQuery = '';

        function renderPmStats(items, dueItems) {
            if (!statsEl) return;
            var openCount = items.filter(function (item) { return PM_OPEN_STATUSES[item.status || '']; }).length;
            var approvalCount = items.filter(function (item) { return PM_APPROVAL_READY[item.status || '']; }).length;
            var approvedCount = items.filter(function (item) { return PM_DONE_STATUSES[item.status || '']; }).length;
            var dueCount = (dueItems || []).length;
            var cards = [
                { label: 'Open', value: openCount },
                { label: 'Due this week', value: dueCount },
                { label: 'Awaiting approval', value: approvalCount },
                { label: 'Approved/Closed', value: approvedCount }
            ];
            statsEl.innerHTML = cards.map(function (card) {
                return '<div class="pm-ops-stat"><span class="pm-ops-stat-label">' + card.label + '</span><span class="pm-ops-stat-value">' + card.value + '</span></div>';
            }).join('');
        }

        function mapWorkflowDocType(item) {
            if (item.doc_type) return item.doc_type;
            var f = item.fields || {};
            return f.doc_type || item.workflow_key || 'rfi';
        }

        function normalizeDueDate(item) {
            var due = String(item.due_date || (item.fields && item.fields.due_date) || '').trim();
            if (!due) return 'No due date';
            return due;
        }

        function nextStatusAction(item) {
            var status = String(item.status || 'open');
            if (status === 'open' || status === 'pending' || status === 'overdue') {
                return { label: 'Move to review', status: 'under_review' };
            }
            if (status === 'submitted' || status === 'under_review') {
                return { label: 'Approve', status: 'approved' };
            }
            if (status === 'approved') {
                return { label: 'Close', status: 'closed' };
            }
            return { label: 'Re-open', status: 'open' };
        }

        function updateWorkflowStatus(item, status) {
            var btnStatus = item._statusBtn;
            if (btnStatus) { btnStatus.disabled = true; btnStatus.textContent = 'Updating…'; }
            return runDesktopToolRequest(item.workflow_tool, {
                action: 'update',
                workflow_id: item.id,
                project_name: item.project_name || getActiveProjectName(),
                status: status
            }).then(function (result) {
                if (!result || result.error) throw new Error((result && result.error) || 'Could not update workflow');
                showToast('Updated ' + (item.workflow_label || 'workflow') + ' to ' + status + '.');
                refreshPmOpsBoard();
            }).catch(function (err) {
                showToast(err.message || 'Could not update workflow.');
            });
        }

        function exportWorkflowDoc(item) {
            var exportBtn = item._exportBtn;
            if (exportBtn) { exportBtn.disabled = true; exportBtn.textContent = 'Exporting…'; }
            var fields = Object.assign({}, item.fields || {}, {
                project_name: item.project_name || getActiveProjectName(),
                due_date: item.due_date || (item.fields && item.fields.due_date) || ''
            });
            if (!fields.number && fields.rfi_number) fields.number = fields.rfi_number;
            if (!fields.number && fields.co_number) fields.number = fields.co_number;
            if (!fields.number && fields.pay_app_number) fields.number = fields.pay_app_number;
            return runDesktopToolRequest('generate_pm_doc', {
                doc_type: mapWorkflowDocType(item),
                fields: fields
            }).then(function (result) {
                if (!result || result.error) throw new Error((result && result.error) || 'Could not export PDF');
                if (result.path && window.mudragDesktop && window.mudragDesktop.openDocSource) {
                    window.mudragDesktop.openDocSource(result.path).catch(function () {});
                }
                showToast('Exported ' + (result.filename || 'document') + '.');
            }).catch(function (err) {
                showToast(err.message || 'Could not export document.');
            }).then(function () {
                if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = 'Export PDF'; }
            });
        }

        function renderPmBoard(items) {
            if (!boardEl) return;
            if (!activeProjectId) {
                boardEl.innerHTML = '<div class="pm-ops-row"><div class="pm-ops-row-title">Open or create a project to use PM Ops.</div></div>';
                return;
            }
            if (!pmOpsState.desktopAvailable) {
                boardEl.innerHTML = '<div class="pm-ops-row"><div class="pm-ops-row-title">Desktop PM tools are not available in this environment.</div><div class="pm-ops-row-meta">Use the desktop app to run workflow automation and PDF exports.</div></div>';
                return;
            }
            if (!items || items.length === 0) {
                boardEl.innerHTML = '<div class="pm-ops-row"><div class="pm-ops-row-title">No PM workflows yet.</div><div class="pm-ops-row-meta">Use Draft actions to create your first RFI, CO, daily report, pay app, or submittal.</div></div>';
                return;
            }
            boardEl.innerHTML = '';
            items.forEach(function (item) {
                var row = document.createElement('div');
                row.className = 'pm-ops-row';
                var due = normalizeDueDate(item);
                var status = String(item.status || 'open');

                var rowTop = document.createElement('div');
                rowTop.className = 'pm-ops-row-top';
                var rowTitle = document.createElement('div');
                rowTitle.className = 'pm-ops-row-title';
                rowTitle.textContent = item.title || (item.workflow_label + ' item');
                var badge = document.createElement('span');
                badge.className = 'pm-ops-badge';
                badge.textContent = item.workflow_label || 'Workflow';
                rowTop.appendChild(rowTitle);
                rowTop.appendChild(badge);

                var rowMeta = document.createElement('div');
                rowMeta.className = 'pm-ops-row-meta';
                var statusSpan = document.createElement('span');
                statusSpan.textContent = 'Status: ' + status;
                var dueSpan = document.createElement('span');
                dueSpan.textContent = 'Due: ' + due;
                rowMeta.appendChild(statusSpan);
                rowMeta.appendChild(dueSpan);

                row.appendChild(rowTop);
                row.appendChild(rowMeta);

                var actions = document.createElement('div');
                actions.className = 'pm-ops-row-actions';

                var statusAction = nextStatusAction(item);
                var statusBtn = document.createElement('button');
                statusBtn.type = 'button';
                statusBtn.className = 'btn-secondary btn-sm';
                statusBtn.textContent = statusAction.label;
                statusBtn.addEventListener('click', function () {
                    updateWorkflowStatus(item, statusAction.status);
                });
                actions.appendChild(statusBtn);
                item._statusBtn = statusBtn;

                var exportBtn = document.createElement('button');
                exportBtn.type = 'button';
                exportBtn.className = 'btn-primary btn-sm';
                exportBtn.textContent = 'Export PDF';
                exportBtn.addEventListener('click', function () {
                    exportWorkflowDoc(item);
                });
                actions.appendChild(exportBtn);
                item._exportBtn = exportBtn;

                var reviewBtn = document.createElement('button');
                reviewBtn.type = 'button';
                reviewBtn.className = 'btn-secondary btn-sm';
                reviewBtn.textContent = 'Review in chat';
                reviewBtn.addEventListener('click', function () {
                    var prompt = 'Review this ' + (item.workflow_label || 'workflow') + ': ' + (item.title || '') + '. Status: ' + status + '. Due: ' + due + '.';
                    if (window.__mudragSend) window.__mudragSend(prompt);
                });
                actions.appendChild(reviewBtn);

                row.appendChild(actions);
                boardEl.appendChild(row);
            });
        }

        function createWorkflowDraft(typeKey) {
            var config = PM_WORKFLOW_CONFIG.find(function (c) { return c.key === typeKey; });
            if (!config) return;
            if (!activeProjectId) { showToast('Open a project first.'); return; }
            if (!pmOpsState.desktopAvailable) { showToast('Desktop PM tools unavailable here.'); return; }
            var projectName = getActiveProjectName();
            var today = new Date().toISOString().slice(0, 10);
            var due = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

            if (typeKey === 'daily_report') {
                runDesktopToolRequest(config.tool, {
                    action: 'autofill',
                    project_name: projectName,
                    save_workflow: true,
                    fields: {
                        date: today,
                        notes: 'Auto-filled from PM Ops Copilot'
                    }
                }).then(function (result) {
                    if (!result || result.error) throw new Error((result && result.error) || 'Could not draft daily report');
                    showToast('Drafted daily report.');
                    refreshPmOpsBoard();
                }).catch(function (err) {
                    showToast(err.message || 'Could not draft daily report.');
                });
                return;
            }

            var desc = prompt('Draft ' + config.label + ' — enter a short description:', config.label + ' item');
            if (!desc) return;
            runDesktopToolRequest(config.tool, {
                action: 'create',
                project_name: projectName,
                due_date: due,
                title: config.label + ': ' + desc,
                fields: {
                    doc_type: config.doc_type,
                    description: desc,
                    date: today
                }
            }).then(function (result) {
                if (!result || result.error) throw new Error((result && result.error) || 'Could not create workflow draft');
                showToast('Drafted ' + config.label + '.');
                refreshPmOpsBoard();
            }).catch(function (err) {
                showToast(err.message || 'Could not create draft.');
            });
        }

        function refreshPmOpsBoard() {
            if (!statsEl || !boardEl) return;
            if (pmOpsRefreshTimer) clearTimeout(pmOpsRefreshTimer);
            if (!activeProjectId) {
                pmOpsState.items = [];
                pmOpsState.dueItems = [];
                renderPmStats([], []);
                renderPmBoard([]);
                return;
            }
            var projectName = getActiveProjectName();
            boardEl.innerHTML = '<div class="pm-ops-row"><div class="pm-ops-row-title">Loading PM workflows…</div></div>';
            var listRequests = PM_WORKFLOW_CONFIG.map(function (cfg) {
                return runDesktopToolRequest(cfg.tool, {
                    action: 'list',
                    project_name: projectName,
                    limit: 80
                }).then(function (data) {
                    return { cfg: cfg, data: data };
                });
            });
            var dueRequests = PM_WORKFLOW_CONFIG.map(function (cfg) {
                return runDesktopToolRequest(cfg.tool, { action: 'due' }).then(function (data) {
                    return { cfg: cfg, data: data };
                });
            });

            Promise.all([Promise.all(listRequests), Promise.all(dueRequests)]).then(function (allData) {
                pmOpsState.desktopAvailable = true;
                var listData = allData[0];
                var dueData = allData[1];
                var items = [];
                listData.forEach(function (row) {
                    var cfg = row.cfg;
                    var arr = (row.data && row.data.items) || [];
                    arr.forEach(function (item) {
                        var enriched = Object.assign({}, item, {
                            workflow_key: cfg.key,
                            workflow_label: cfg.label,
                            workflow_tool: cfg.tool,
                            doc_type: cfg.doc_type
                        });
                        items.push(enriched);
                    });
                });
                var dueItems = [];
                dueData.forEach(function (row) {
                    var cfg = row.cfg;
                    var arr = (row.data && row.data.items) || [];
                    arr.forEach(function (item) {
                        dueItems.push(Object.assign({}, item, { workflow_key: cfg.key, workflow_label: cfg.label }));
                    });
                });
                items.sort(function (a, b) {
                    var ad = Date.parse(a.due_date || '') || 8640000000000000;
                    var bd = Date.parse(b.due_date || '') || 8640000000000000;
                    if (ad !== bd) return ad - bd;
                    return (Date.parse(b.updated_at || b.created_at || '') || 0) - (Date.parse(a.updated_at || a.created_at || '') || 0);
                });
                pmOpsState.items = items;
                pmOpsState.dueItems = dueItems;
                pmOpsState.loadedProjectId = activeProjectId;
                renderPmStats(items, dueItems);
                renderPmBoard(items.slice(0, 60));
            }).catch(function () {
                pmOpsState.desktopAvailable = false;
                pmOpsState.items = [];
                pmOpsState.dueItems = [];
                renderPmStats([], []);
                renderPmBoard([]);
            });
        }

        function renderIntelResults(data, errMsg) {
            if (!intelResultsEl) return;
            intelResultsEl.innerHTML = '';
            function appendCard(title, snippet) {
                var card = document.createElement('div');
                card.className = 'pm-intel-citation';
                var titleEl = document.createElement('div');
                titleEl.className = 'pm-intel-citation-title';
                titleEl.textContent = title || '';
                card.appendChild(titleEl);
                if (snippet) {
                    var snippetEl = document.createElement('div');
                    snippetEl.className = 'pm-intel-citation-snippet';
                    snippetEl.textContent = snippet;
                    card.appendChild(snippetEl);
                }
                intelResultsEl.appendChild(card);
            }
            if (errMsg) {
                appendCard(errMsg, '');
                return;
            }
            var chunks = (data && data.chunks) || [];
            if (chunks.length === 0) {
                appendCard('No grounded matches yet.', 'Try re-indexing project docs, then ask again.');
                return;
            }
            var confidence = String((data && data.confidence) || 'low').toUpperCase();
            chunks.slice(0, 6).forEach(function (c) {
                appendCard(c.title || c.source || 'Source', String(c.snippet || '').slice(0, 340));
            });
            appendCard('Confidence: ' + confidence, chunks.length + ' source snippet' + (chunks.length === 1 ? '' : 's') + ' found.');
        }

        function runProjectIntelSearch() {
            if (!activeProjectId) {
                renderIntelResults(null, 'Open a project first.');
                return;
            }
            var q = String((intelQueryEl && intelQueryEl.value) || '').trim();
            if (!q) {
                renderIntelResults(null, 'Enter a project-doc question.');
                return;
            }
            lastIntelQuery = q;
            renderIntelResults(null, 'Searching indexed project docs…');
            fetch(API_BASE + '/rag-search', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ project_id: activeProjectId, query: q, top_k: 6 })
            }).then(function (r) {
                if (!r.ok) return r.json().then(function (d) { throw new Error((d && d.error) || 'Search failed'); });
                return r.json();
            }).then(function (data) {
                renderIntelResults(data, null);
            }).catch(function (err) {
                renderIntelResults(null, err.message || 'Could not search project docs.');
            });
        }

        function reindexActiveProjectDocs() {
            if (!activeProjectId) { showToast('Open a project first.'); return; }
            getDocuments(activeProjectId).then(function (docs) {
                if (!docs || docs.length === 0) { showToast('No project docs to index.'); return; }
                if (intelResultsEl) intelResultsEl.innerHTML = '<div class="pm-intel-citation"><div class="pm-intel-citation-title">Re-indexing ' + docs.length + ' document(s)…</div></div>';
                return indexProjectDocsBulk(activeProjectId, docs).then(function (summary) {
                    var msg = 'Indexed ' + summary.indexed + ' document' + (summary.indexed === 1 ? '' : 's') + '.';
                    if (summary.skipped) msg += ' Skipped ' + summary.skipped + '.';
                    showToast(msg);
                    if (intelResultsEl) intelResultsEl.innerHTML = '<div class="pm-intel-citation"><div class="pm-intel-citation-title">' + msg + '</div></div>';
                });
            }).catch(function () {
                showToast('Could not re-index project docs.');
            });
        }

        function rankImportantInboxEmails(emails) {
            var now = Date.now();
            return (emails || []).map(function (em) {
                var score = 0;
                var subject = String(em.subject || '').toLowerCase();
                if (em.read === false) score += 4;
                if (em.flagged) score += 3;
                if (/\b(urgent|asap|response|rfi|submittal|change order|pay app|invoice|rfq|pricing|quote|revision|delta)\b/.test(subject)) score += 4;
                var ageMs = now - (Date.parse(em.date || '') || now);
                if (ageMs < 36 * 3600 * 1000) score += 2;
                return Object.assign({}, em, { _rank: score });
            }).sort(function (a, b) {
                if ((b._rank || 0) !== (a._rank || 0)) return (b._rank || 0) - (a._rank || 0);
                return (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0);
            });
        }

        function renderInboxReviewRows(emails) {
            if (!inboxResultsEl) return;
            if (!emails || emails.length === 0) {
                inboxResultsEl.innerHTML = '<div class="pm-intel-citation"><div class="pm-intel-citation-title">No important inbox items found.</div></div>';
                return;
            }
            inboxResultsEl.innerHTML = '';
            emails.slice(0, 12).forEach(function (em) {
                var row = document.createElement('div');
                row.className = 'pm-ops-row';
                var top = document.createElement('div');
                top.className = 'pm-ops-row-top';
                var titleEl = document.createElement('div');
                titleEl.className = 'pm-ops-row-title';
                titleEl.textContent = em.subject || '(no subject)';
                var badge = document.createElement('span');
                badge.className = 'pm-ops-badge';
                badge.textContent = (em.read === false) ? 'Unread' : 'Read';
                top.appendChild(titleEl);
                top.appendChild(badge);
                row.appendChild(top);
                var meta = document.createElement('div');
                meta.className = 'pm-ops-row-meta';
                var sender = document.createElement('span');
                sender.textContent = em.sender || em.sender_address || 'Unknown sender';
                var date = document.createElement('span');
                date.textContent = em.date || '';
                meta.appendChild(sender);
                meta.appendChild(date);
                row.appendChild(meta);
                var actions = document.createElement('div');
                actions.className = 'pm-ops-row-actions';

                var openBtn = document.createElement('button');
                openBtn.type = 'button';
                openBtn.className = 'btn-secondary btn-sm';
                openBtn.textContent = 'Open in Mail';
                openBtn.addEventListener('click', function () {
                    if (window.mudragDesktop && window.mudragDesktop.openMail) {
                        window.mudragDesktop.openMail({ sender: em.sender || em.sender_address, subject: em.subject, index: em.index }).catch(function () {});
                    }
                });
                actions.appendChild(openBtn);

                var importBtn = document.createElement('button');
                importBtn.type = 'button';
                importBtn.className = 'btn-primary btn-sm';
                importBtn.textContent = 'Import attachments';
                importBtn.addEventListener('click', function () {
                    importBtn.disabled = true;
                    importBtn.textContent = 'Importing…';
                    importEmailAttachmentsToProject(em, {}).then(function (summary) {
                        if (summary && summary.ok && summary.imported_count) {
                            var msg = 'Imported ' + summary.imported_count + ' doc' + (summary.imported_count === 1 ? '' : 's');
                            if (summary.suggested_actions && summary.suggested_actions.length) msg += '. Next: ' + summary.suggested_actions[0].label;
                            showToast(msg);
                        } else {
                            showToast((summary && summary.error) || 'No attachments imported.');
                        }
                    }).catch(function () {
                        showToast('Import failed.');
                    }).then(function () {
                        importBtn.disabled = false;
                        importBtn.textContent = 'Import attachments';
                    });
                });
                actions.appendChild(importBtn);

                row.appendChild(actions);
                inboxResultsEl.appendChild(row);
            });
        }

        function runMorningInboxReview() {
            if (!activeProjectId) { showToast('Open a project first.'); return; }
            inboxResultsEl.innerHTML = '<div class="pm-intel-citation"><div class="pm-intel-citation-title">Reviewing inbox…</div></div>';
            runDesktopToolRequest('search_mail', {
                since: 'today',
                inbox_only: true,
                unread_only: false,
                limit: 30
            }).then(function (result) {
                if (!result || result.error) throw new Error((result && result.error) || 'Inbox review unavailable');
                var ranked = rankImportantInboxEmails(result.emails || []);
                renderInboxReviewRows(ranked);
            }).catch(function (err) {
                inboxResultsEl.innerHTML = '<div class="pm-intel-citation"><div class="pm-intel-citation-title">' + (err.message || 'Inbox review unavailable.') + '</div></div>';
            });
        }

        if (refreshBtn) refreshBtn.addEventListener('click', refreshPmOpsBoard);
        if (intelSearchBtn) intelSearchBtn.addEventListener('click', runProjectIntelSearch);
        if (intelQueryEl) {
            intelQueryEl.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); runProjectIntelSearch(); }
            });
        }
        if (intelAskBtn) {
            intelAskBtn.addEventListener('click', function () {
                var q = String((intelQueryEl && intelQueryEl.value) || lastIntelQuery || '').trim();
                if (!q) { showToast('Enter a project intelligence question first.'); return; }
                if (window.__mudragSend) window.__mudragSend(q);
            });
        }
        if (intelReindexBtn) intelReindexBtn.addEventListener('click', reindexActiveProjectDocs);

        if (inboxMorningBtn) inboxMorningBtn.addEventListener('click', runMorningInboxReview);
        if (inboxRfqBtn) inboxRfqBtn.addEventListener('click', function () {
            if (window.__mudragSend) window.__mudragSend('Pull all RFQ attachments for project ' + getActiveProjectName());
        });
        if (inboxPricingBtn) inboxPricingBtn.addEventListener('click', function () {
            if (window.__mudragSend) window.__mudragSend('Find unanswered vendor pricing emails for project ' + getActiveProjectName());
        });
        if (inboxRevisionBtn) inboxRevisionBtn.addEventListener('click', function () {
            if (window.__mudragSend) window.__mudragSend('Import plan/spec revisions and summarize deltas for project ' + getActiveProjectName());
        });

        quickBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var action = btn.getAttribute('data-pm-quick');
                if (action === 'draft-co') {
                    createWorkflowDraft('change_order');
                } else if (action === 'autofill-daily') {
                    createWorkflowDraft('daily_report');
                } else if (action === 'due-rfi') {
                    if (window.__mudragSend) window.__mudragSend('Track all open RFIs due this week for project ' + getActiveProjectName());
                    var dueRfis = (pmOpsState.dueItems || []).filter(function (x) { return x.workflow_key === 'rfi'; });
                    renderPmBoard(dueRfis.map(function (x) {
                        return Object.assign({}, x, { workflow_tool: 'manage_rfi_workflow', doc_type: 'rfi', workflow_label: 'RFI' });
                    }));
                }
            });
        });

        pane._mudragPmRefresh = refreshPmOpsBoard;
        refreshPmOpsBoard();
    }

    function doInit() {
        if (navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().catch(function () {});
        }
        migrateMessages();
        ensureProject();

        // Default home view: chat + sidebar only, right panel hidden, chat visible
        // Only apply these defaults if the user has never set a preference
        if (!localStorage.getItem(STORAGE_MAIN_VIEW)) {
            localStorage.setItem(STORAGE_MAIN_VIEW, 'chat');
        }
        if (!localStorage.getItem(STORAGE_RIGHT_PANEL_VISIBLE)) {
            localStorage.setItem(STORAGE_RIGHT_PANEL_VISIBLE, 'false');
        }
        if (getMainViewPreference() === 'canvas') {
            localStorage.setItem(STORAGE_RIGHT_PANEL_VISIBLE, 'true');
        }
        applyMainViewPreference();
        applyRightPanelVisibility();
        applyChatVisibility();
        initPmOpsPane();
        renderProjects();
        renderChats();
        renderMessages();
        renderDocuments();
        if (chatWindowParam && chatWindowProjectId) {
            document.body.classList.add('chat-window-mode');
            if (mainWrapper) {
                mainWrapper.classList.remove('layout-canvas-main');
                mainWrapper.classList.add('layout-chat-main', 'right-panel-hidden');
            }
            if (activeProjectId !== chatWindowProjectId) {
                switchProject(chatWindowProjectId);
            }
            if (chatWindowChatId && chatWindowChatId !== activeChatId) {
                switchChat(chatWindowProjectId, chatWindowChatId);
            }
        }
    }
    if (isToolServerOrigin || (useDesktopApi && toolPort)) {
        loadStorageProjects(doInit);
    } else {
        doInit();
    }

    (function initMobileSidebar() {
        var sidebar = document.getElementById('projects-sidebar');
        var overlay = document.getElementById('sidebar-overlay');
        var btnToggle = document.getElementById('btn-sidebar-toggle');
        if (!sidebar || !overlay || !btnToggle) return;

        var mql = window.matchMedia('(max-width: 768px)');
        function updateToggleVisibility() {
            btnToggle.hidden = !mql.matches;
        }
        mql.addEventListener('change', updateToggleVisibility);
        updateToggleVisibility();

        function openSidebar() {
            sidebar.classList.add('sidebar-open');
            overlay.classList.add('visible');
            overlay.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
        }
        function closeSidebar() {
            sidebar.classList.remove('sidebar-open');
            overlay.classList.remove('visible');
            overlay.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        }
        function toggleSidebar() {
            if (sidebar.classList.contains('sidebar-open')) closeSidebar();
            else openSidebar();
        }

        btnToggle.addEventListener('click', toggleSidebar);
        overlay.addEventListener('click', closeSidebar);

        sidebar.querySelectorAll('.project-item').forEach(function (el) {
            el.addEventListener('click', function () {
                if (mql.matches) closeSidebar();
            });
        });
    })();

    (function initSidebarResize() {
        var sidebar = document.getElementById('projects-sidebar');
        var handle = document.getElementById('sidebar-resize-handle');
        if (!sidebar || !handle) return;
        var saved = localStorage.getItem(STORAGE_SIDEBAR_WIDTH);
        if (saved) {
            var w = parseInt(saved, 10);
            if (w >= 160 && w <= 400) {
                sidebar.style.setProperty('--sidebar-width', w + 'px');
                document.body.style.setProperty('--sidebar-width', w + 'px');
            }
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
                var px = newW + 'px';
                sidebar.style.setProperty('--sidebar-width', px);
                document.body.style.setProperty('--sidebar-width', px);
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

    (function initSidebarToggleBar() {
        var sidebar = document.getElementById('projects-sidebar');
        var btnDesktop = document.getElementById('btn-sidebar-toggle-bar');
        var btnWeb = document.getElementById('btn-sidebar-toggle-bar-web');
        if (!sidebar) return;

        var saved = localStorage.getItem(STORAGE_SIDEBAR_VISIBLE);
        if (saved === 'false') document.body.classList.add('sidebar-collapsed');

        function toggleSidebar() {
            var collapsed = document.body.classList.toggle('sidebar-collapsed');
            localStorage.setItem(STORAGE_SIDEBAR_VISIBLE, collapsed ? 'false' : 'true');
        }

        if (btnDesktop) btnDesktop.addEventListener('click', toggleSidebar);
        if (btnWeb) btnWeb.addEventListener('click', toggleSidebar);
    })();

    (function initDesktopTools() {
        document.querySelectorAll('.desktop-only-quick').forEach(function (el) {
            el.hidden = !(isToolServerOrigin || isDesktopApp);
        });
        var wrap = document.getElementById('desktop-tools-wrap');
        var btnDesktop = document.getElementById('btn-cleanup-desktop');
        var btnDownloads = document.getElementById('btn-cleanup-downloads');
        var toolsBtnWrap = document.getElementById('tools-btn-wrap');
        var toolsTrigger = document.getElementById('tools-trigger');
        var toolsDropdownBar = document.getElementById('tools-dropdown-bar');
        if (!isDesktopApp && !useDesktopApi) return;
        if (wrap) wrap.hidden = false;
        var toolPort = (function () {
            var m = /[?&]toolPort=(\d+)/.exec(window.location.search || '');
            return m ? parseInt(m[1], 10) : 3847;
        })();
        var TOOL_SERVER = 'http://127.0.0.1:' + toolPort;
        function formatOrganizeResult(data) {
            if (data.error) return 'Error: ' + data.error;
            var moved = data.moved || 0;
            var folders = data.folders || [];
            var projects = data.projects || [];
            var errs = data.errors || [];
            if (moved === 0 && errs.length === 0) return 'Nothing to organize—already tidy.';
            var msg = 'Organized ' + moved + ' file' + (moved === 1 ? '' : 's') + '.';
            if (projects.length) msg += ' Project folders: ' + projects.join(', ') + '.';
            if (folders.length) msg += ' By type: ' + folders.join(', ') + '.';
            if (errs.length) msg += ' (' + errs.length + ' error' + (errs.length === 1 ? '' : 's') + ')';
            return msg;
        }
        function runTool(tool, params, btn) {
            window.__mudragRunTool = runTool;
            if (btn) {
                var orig = btn.textContent;
                btn.disabled = true;
                btn.textContent = 'Running…';
            }
            fetch(TOOL_SERVER + '/run-tool', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tool: tool, params: params || {} })
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (btn) { btn.disabled = false; btn.textContent = orig; }
                var msg;
                if (tool === 'add_to_calendar' || tool === 'add_reminder' || tool === 'quick_note') {
                    msg = data.error ? ('Error: ' + data.error) : ('Added "' + (data.title || 'item') + '"' + (data.app ? ' to ' + data.app : '') + '.');
                } else if (tool === 'weather') {
                    msg = data.error ? ('Error: ' + data.error) : (data.summary || JSON.stringify(data));
                } else if (tool === 'send_email') {
                    if (data.choose_account && data.accounts && data.text) {
                        msg = '[MUDRAG_CHOOSE_EMAIL_ACCOUNT]' + JSON.stringify({
                            accounts: data.accounts,
                            text: data.text,
                            message: data.message || 'Which account do you want to send from?'
                        }) + '[/MUDRAG_CHOOSE_EMAIL_ACCOUNT]';
                    } else {
                        msg = data.error ? ('Error: ' + data.error) : ('Sent email to ' + (data.to || '') + ': ' + (data.subject || ''));
                    }
                } else {
                    msg = formatOrganizeResult(data);
                }
                addMessage('assistant', msg);
                renderMessages();
                scrollToLatest();
            }).catch(function () {
                if (btn) { btn.disabled = false; btn.textContent = orig; }
                addMessage('assistant', 'Could not reach the desktop app. Make sure you\'re running openmud from the .dmg.');
                renderMessages();
                scrollToLatest();
            });
        }
        if (btnDesktop) btnDesktop.addEventListener('click', function () { runTool('cleanup_desktop', {}, btnDesktop); });
        if (btnDownloads) btnDownloads.addEventListener('click', function () { runTool('cleanup_downloads', {}, btnDownloads); });
        if (toolsBtnWrap && toolsTrigger && toolsDropdownBar) {
            toolsBtnWrap.hidden = false;
            toolsTrigger.addEventListener('click', function (e) {
                e.stopPropagation();
                var open = !toolsDropdownBar.hidden;
                closeAllComposerDropdowns();
                if (!open) {
                    positionDropdownAbove(toolsDropdownBar, toolsTrigger);
                    toolsDropdownBar.hidden = false;
                    toolsTrigger.setAttribute('aria-expanded', 'true');
                }
            });
            toolsDropdownBar.addEventListener('click', function (e) { e.stopPropagation(); });
            toolsDropdownBar.querySelectorAll('[data-tool]').forEach(function (item) {
                item.addEventListener('click', function () {
                    var tool = item.getAttribute('data-tool');
                    if (!tool) return;
                    var params = {};
                    var needsText = ['add_to_calendar', 'add_reminder', 'quick_note', 'send_email', 'weather'].indexOf(tool) >= 0;
                    if (needsText) {
                        var inp = document.getElementById('chat-input');
                        var text = (inp && inp.value) ? inp.value.trim() : '';
                        if (!text) {
                            var msgs = getMessages(getActiveId());
                            var lastUser = msgs.filter(function (m) { return m.role === 'user'; }).pop();
                            text = lastUser ? (lastUser.content || '').trim() : '';
                        }
                        params.text = text;
                        if (tool === 'weather') params.location = text;
                    }
                    runTool(tool, params, null);
                    toolsDropdownBar.hidden = true;
                    toolsTrigger.setAttribute('aria-expanded', 'false');
                });
            });
            document.addEventListener('click', function () { closeAllComposerDropdowns(); });
        }
    })();

    var STORAGE_CHAT_HEIGHT = 'mudrag_chatPanelHeight';
    var STORAGE_RIGHT_PANEL_WIDTH = 'mudrag_rightPanelWidth';
    var RIGHT_PANEL_MIN_WIDTH = 400;
    var RIGHT_PANEL_MAX_WIDTH = 720;

    (function initChatResize() {
        var handle = document.getElementById('chat-resize-handle');
        var wrapper = chatPanelWrapper;
        if (!handle || !wrapper || !mainWrapper || !mainContentArea) return;
        var mql = window.matchMedia('(max-width: 768px)');

        function applySavedLayoutSize() {
            if (mql.matches) return;
            var savedW = localStorage.getItem(STORAGE_RIGHT_PANEL_WIDTH);
            if (savedW) {
                var w = parseInt(savedW, 10);
                if (w >= RIGHT_PANEL_MIN_WIDTH && w <= RIGHT_PANEL_MAX_WIDTH) {
                    mainWrapper.style.setProperty('--right-panel-width', w + 'px');
                }
            }
        }

        applySavedLayoutSize();
        window.addEventListener('mudrag-main-view-change', applySavedLayoutSize);
        mql.addEventListener('change', applySavedLayoutSize);

        handle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            if (mql.matches) return;
            var isChatMain = mainWrapper.classList.contains('layout-chat-main');
            var startX = e.clientX;
            var startW = isChatMain ? mainContentArea.offsetWidth : wrapper.offsetWidth;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            function onMove(ev) {
                var dx = ev.clientX - startX;
                var newW = Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, startW - dx));
                mainWrapper.style.setProperty('--right-panel-width', newW + 'px');
            }
            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                localStorage.setItem(STORAGE_RIGHT_PANEL_WIDTH, String(isChatMain ? mainContentArea.offsetWidth : wrapper.offsetWidth));
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    })();

    (function initFocusTabs() {
        var tabs = Array.prototype.slice.call(document.querySelectorAll('.focus-tab'));
        var canvasPane = document.getElementById('canvas-pane');
        var docPane = document.getElementById('document-viewer-pane');
        var pmOpsPane = document.getElementById('pm-ops-pane');

        function setMainFocus(focus) {
            if (canvasPane) canvasPane.hidden = focus !== 'canvas';
            if (docPane) docPane.hidden = focus !== 'document';
            if (pmOpsPane) pmOpsPane.hidden = focus !== 'pm-ops';
            tabs.forEach(function (t) {
                t.classList.toggle('focus-tab-active', t.getAttribute('data-focus') === focus);
            });
            try { localStorage.setItem('mudrag_focus_tab', focus); } catch (e) {}
        }

        window.mudragSetMainFocus = setMainFocus;
        tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                setMainFocus(tab.getAttribute('data-focus') || 'canvas');
            });
        });

        var savedFocus = '';
        try { savedFocus = localStorage.getItem('mudrag_focus_tab') || ''; } catch (e) {}
        if (savedFocus === 'pm-ops') setMainFocus('pm-ops');
        else setMainFocus('canvas');
    })();

    window.mudrag = {
        getActiveProjectId: function () { return activeProjectId; },
        getDocuments: getDocuments,
        saveDocument: saveDocument,
        deleteDocument: deleteDocument,
        renderDocuments: renderDocuments,
        downloadDocument: downloadDocument,
        updateDocumentContent: updateDocumentContent,
        setLastOpenedDocumentId: function (docId) { _lastOpenedDocId = docId || null; },
        getLastOpenedDocumentId: function () { return _lastOpenedDocId; }
    };
    if (window.mudragInitCanvas) window.mudragInitCanvas(window.mudrag);
    if (window.mudragInitDocumentViewer) window.mudragInitDocumentViewer(window.mudrag);
    if (window.mudrag.renderCanvas) window.mudrag.renderCanvas();

    function showOllamaNotification(status, model) {
        // Don't re-show if already dismissed in the last 7 days
        var dismissed = parseInt(localStorage.getItem('mudrag-ollama-dismissed') || '0', 10);
        if (Date.now() - dismissed < 7 * 24 * 60 * 60 * 1000) return;

        var existing = document.getElementById('ollama-setup-banner');
        if (existing) existing.remove();

        // Steps: 1=download, 2=open app, 3=pull model
        var step = status === 'missing' ? 1 : status === 'installed' ? 2 : 3;
        var modelName = model || 'tinyllama';

        var steps = [
            { n: 1, label: 'Download Ollama', done: step > 1 },
            { n: 2, label: 'Open the Ollama app', done: step > 2 },
            { n: 3, label: 'Pull the mud1 model', done: false },
        ];

        var stepsHtml = steps.map(function (s) {
            var active = s.n === step;
            var cls = s.done ? 'ollama-step ollama-step-done' : active ? 'ollama-step ollama-step-active' : 'ollama-step ollama-step-pending';
            var icon = s.done
                ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'
                : '<span>' + s.n + '</span>';
            return '<div class="' + cls + '"><div class="ollama-step-dot">' + icon + '</div><span>' + s.label + '</span></div>';
        }).join('');

        var desc, actionHtml;
        if (step === 1) {
            desc = 'Ollama runs AI models locally on your Mac — it\'s free, private, and powers desktop automations like calendar, reminders, notes, and email.';
            actionHtml = '<button class="ollama-banner-btn ollama-banner-btn-primary" id="ollama-install-btn">Download Ollama</button>';
        } else if (step === 2) {
            desc = 'Ollama is installed. Open it from your Applications folder to start the local AI server — it runs quietly in the menu bar.';
            actionHtml = '<button class="ollama-banner-btn ollama-banner-btn-primary" id="ollama-open-btn">Open Ollama</button>' +
                         '<button class="ollama-banner-btn" id="ollama-recheck-btn">I opened it — check again</button>';
        } else {
            desc = 'Almost there. Run this command in Terminal to download the mud1 model (~637 MB). Only needed once.';
            actionHtml = '<div class="ollama-pull-cmd" id="ollama-pull-cmd"><code>ollama pull ' + modelName + '</code>' +
                         '<button class="ollama-copy-btn" id="ollama-copy-btn" title="Copy">Copy</button></div>' +
                         '<button class="ollama-banner-btn ollama-banner-btn-primary" id="ollama-pull-btn">Pull model automatically</button>' +
                         '<div class="ollama-pull-progress" id="ollama-pull-progress" style="display:none"></div>';
        }

        var banner = document.createElement('div');
        banner.id = 'ollama-setup-banner';
        banner.className = 'ollama-setup-banner ollama-setup-banner-expanded';
        banner.innerHTML =
            '<div class="ollama-banner-top">' +
                '<div class="ollama-banner-title-row">' +
                    '<svg class="ollama-banner-icon-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>' +
                    '<strong class="ollama-banner-title">Set up local AI (Ollama)</strong>' +
                    '<button class="ollama-banner-btn-close" id="ollama-dismiss-btn" title="Dismiss">✕</button>' +
                '</div>' +
                '<p class="ollama-banner-msg">' + desc + '</p>' +
                '<div class="ollama-steps">' + stepsHtml + '</div>' +
            '</div>' +
            '<div class="ollama-banner-actions">' + actionHtml + '</div>';

        var chatMessages = document.getElementById('chat-messages') || document.body;
        if (chatMessages.parentNode) chatMessages.parentNode.insertBefore(banner, chatMessages);
        else document.body.appendChild(banner);

        // Wire buttons
        var installBtn = document.getElementById('ollama-install-btn');
        if (installBtn) installBtn.addEventListener('click', function () {
            if (window.mudragDesktop && window.mudragDesktop.installOllama) window.mudragDesktop.installOllama();
            else window.open('https://ollama.com/download/mac', '_blank');
        });

        var openBtn = document.getElementById('ollama-open-btn');
        if (openBtn) openBtn.addEventListener('click', function () {
            if (window.mudragDesktop && window.mudragDesktop.openExternal) window.mudragDesktop.openExternal('file:///Applications/Ollama.app');
            else if (window.mudragDesktop && window.mudragDesktop.installOllama) window.mudragDesktop.installOllama();
        });

        var recheckBtn = document.getElementById('ollama-recheck-btn');
        if (recheckBtn) recheckBtn.addEventListener('click', function () {
            recheckBtn.textContent = 'Checking…';
            recheckBtn.disabled = true;
            if (window.mudragDesktop && window.mudragDesktop.ollamaStatus) {
                window.mudragDesktop.ollamaStatus().then(function (r) {
                    if (r.status === 'ready') {
                        banner.remove();
                    } else {
                        showOllamaNotification(r.status, r.model);
                    }
                }).catch(function () { recheckBtn.textContent = 'Check again'; recheckBtn.disabled = false; });
            }
        });

        var copyBtn = document.getElementById('ollama-copy-btn');
        if (copyBtn) copyBtn.addEventListener('click', function () {
            navigator.clipboard.writeText('ollama pull ' + modelName).then(function () {
                copyBtn.textContent = 'Copied!';
                setTimeout(function () { copyBtn.textContent = 'Copy'; }, 2000);
            });
        });

        var pullBtn = document.getElementById('ollama-pull-btn');
        var pullProgress = document.getElementById('ollama-pull-progress');
        if (pullBtn) pullBtn.addEventListener('click', function () {
            pullBtn.disabled = true;
            pullBtn.textContent = 'Pulling…';
            if (pullProgress) pullProgress.style.display = 'block';
            if (window.mudragDesktop && window.mudragDesktop.ollamaPullModel) {
                window.mudragDesktop.ollamaPullModel();
            }
        });

        document.getElementById('ollama-dismiss-btn').addEventListener('click', function () {
            banner.remove();
            localStorage.setItem('mudrag-ollama-dismissed', Date.now().toString());
        });
    }

    // ── In-app update notification (Cursor-style bottom-left pill) ────────────
    if (window.mudragDesktop && window.mudragDesktop.onUpdateAvailable) {
        window.mudragDesktop.onUpdateAvailable(function (data) {
            if (!data || !data.version) return;
            var existing = document.getElementById('mudrag-update-pill');
            if (existing) existing.remove();

            var pill = document.createElement('div');
            pill.id = 'mudrag-update-pill';
            pill.innerHTML =
                '<div class="update-pill-inner">' +
                    '<div class="update-pill-dot"></div>' +
                    '<span class="update-pill-text">openmud ' + data.version + ' available</span>' +
                    '<button class="update-pill-btn" id="update-pill-install">Restart to update</button>' +
                    '<button class="update-pill-dismiss" id="update-pill-dismiss" title="Dismiss">✕</button>' +
                '</div>' +
                '<div class="update-pill-bar" id="update-pill-bar" hidden>' +
                    '<div class="update-pill-bar-fill-track"><div class="update-pill-bar-fill" id="update-pill-bar-fill"></div></div>' +
                    '<span class="update-pill-bar-label" id="update-pill-bar-label">Downloading…</span>' +
                '</div>';
            document.body.appendChild(pill);

            // Animate in
            requestAnimationFrame(function () { pill.classList.add('update-pill-visible'); });

            document.getElementById('update-pill-install').addEventListener('click', function () {
                var installBtn = document.getElementById('update-pill-install');
                var dismissBtn = document.getElementById('update-pill-dismiss');
                var barWrap = document.getElementById('update-pill-bar');
                if (installBtn) { installBtn.disabled = true; installBtn.textContent = 'Downloading…'; }
                if (dismissBtn) { dismissBtn.hidden = true; }
                if (barWrap) { barWrap.hidden = false; }

                if (window.mudragDesktop && window.mudragDesktop.onUpdateProgress) {
                    window.mudragDesktop.onUpdateProgress(function (prog) {
                        var fill = document.getElementById('update-pill-bar-fill');
                        var lbl = document.getElementById('update-pill-bar-label');
                        if (fill) fill.style.width = (prog.pct || 0) + '%';
                        if (lbl) lbl.textContent = prog.label || 'Installing…';
                        if (installBtn) installBtn.textContent = prog.label || 'Installing…';
                    });
                }

                window.mudragDesktop.installUpdate().then(function (r) {
                    if (!r || !r.ok) {
                        if (installBtn) { installBtn.disabled = false; installBtn.textContent = 'Restart to update'; }
                        if (barWrap) barWrap.hidden = true;
                        showToast('Update failed: ' + ((r && r.error) || 'Unknown error'));
                    }
                }).catch(function () {
                    if (installBtn) { installBtn.disabled = false; installBtn.textContent = 'Restart to update'; }
                });
            });

            document.getElementById('update-pill-dismiss').addEventListener('click', function () {
                pill.classList.remove('update-pill-visible');
                setTimeout(function () { if (pill.parentNode) pill.remove(); }, 300);
            });
        });
    }

    // Handle pull progress + ready events
    if (window.mudragDesktop && window.mudragDesktop.onSystem) {
        window.mudragDesktop.onSystem(function (data) {
            if (!data) return;
            if (data.type === 'agentic-progress') {
                var statusText = (data.text || '').trim();
                if (data.done) {
                    activeLoadingStatusText = '';
                } else if (statusText) {
                    activeLoadingStatusText = statusText;
                    var statusEl = document.getElementById('chat-loading-status');
                    if (statusEl) statusEl.textContent = activeLoadingStatusText;
                }
            } else if (data.type === 'ollama-setup') {
                showOllamaNotification(data.status, data.model);
            } else if (data.type === 'ollama-pull-progress') {
                var prog = document.getElementById('ollama-pull-progress');
                if (prog) {
                    var txt = (data.text || '').trim();
                    if (txt) { prog.textContent = txt; prog.style.display = 'block'; }
                }
            } else if (data.type === 'ollama-ready') {
                var banner = document.getElementById('ollama-setup-banner');
                if (banner) {
                    banner.innerHTML = '<div class="ollama-banner-top"><div class="ollama-banner-title-row">' +
                        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' +
                        '<strong class="ollama-banner-title" style="color:#22c55e">mud1 is ready</strong>' +
                        '<button class="ollama-banner-btn-close" onclick="this.closest(\'#ollama-setup-banner\').remove()">✕</button>' +
                        '</div><p class="ollama-banner-msg">Local AI is set up. Select <strong>mud1</strong> in the model picker to use it — free, private, no API key needed.</p></div>';
                    setTimeout(function () { if (banner.parentNode) banner.remove(); }, 6000);
                }
            } else if (data.type === 'ollama-pull-error') {
                var prog2 = document.getElementById('ollama-pull-progress');
                if (prog2) { prog2.textContent = 'Pull failed. Run `ollama pull ' + (data.model || 'tinyllama') + '` in Terminal manually.'; prog2.style.color = '#ef4444'; }
                var pb = document.getElementById('ollama-pull-btn');
                if (pb) { pb.disabled = false; pb.textContent = 'Try again'; }
            }
        });
    }
})();
