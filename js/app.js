(function () {
    'use strict';

    var API_BASE = 'https://www.masonearl.com/api/contech';
    var STORAGE_PROJECTS = 'rockmud_projects';
    var STORAGE_ACTIVE = 'rockmud_activeProject';
    var STORAGE_MESSAGES = 'rockmud_messages';

    var WELCOME_MSG = "Hi, I'm the Rockmud assistant. Ask me about cost estimates, project types (waterline, sewer, storm, gas, electrical), or anything construction—e.g. \"Estimate 1500 LF of 8 inch sewer in clay.\"";

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
    var modalEstimate = document.getElementById('modal-estimate');
    var formEstimate = document.getElementById('form-estimate');
    var btnEstimate = document.getElementById('btn-estimate');
    var btnCloseEstimate = document.getElementById('btn-close-estimate');
    var estimateResult = document.getElementById('estimate-result');
    var estimateFeedback = document.getElementById('estimate-feedback');
    var formFeedback = document.getElementById('form-feedback');
    var inputActualCost = document.getElementById('input-actual-cost');

    var activeProjectId = null;
    var lastEstimatePayload = null;

    function addMessage(role, content, projectId) {
        projectId = projectId || activeProjectId;
        if (!projectId) return;
        var msgs = getMessages(projectId);
        msgs.push({ role: role, content: content });
        setMessages(projectId, msgs);
        if (projectId === activeProjectId) renderMessages();
    }

    function renderMessages() {
        messagesEl.innerHTML = '';
        var msgs = activeProjectId ? getMessages(activeProjectId) : [];
        if (msgs.length === 0) {
            msgs = [{ role: 'assistant', content: WELCOME_MSG }];
        }
        msgs.forEach(function (m) {
            var wrap = document.createElement('div');
            wrap.className = 'msg msg-' + m.role;
            var p = document.createElement('p');
            p.textContent = m.content;
            wrap.appendChild(p);
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

    function switchProject(id) {
        activeProjectId = id;
        setActiveId(id);
        renderProjects();
        renderMessages();
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
        sendBtn.textContent = on ? '…' : 'Send';
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var text = (input.value || '').trim();
        if (!text || !activeProjectId) return;

        addMessage('user', text);
        input.value = '';
        setLoading(true);

        var msgs = getMessages(activeProjectId);
        var history = msgs.map(function (m) { return { role: m.role, content: m.content }; }).slice(-20);

        fetch(API_BASE + '/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: history, temperature: 0.7, max_tokens: 256 })
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                addMessage('assistant', data.response || 'No response.');
            })
            .catch(function () {
                addMessage('assistant', 'Sorry, I couldn\'t reach the assistant right now. Try again or use the Contech tool at masonearl.com.');
            })
            .then(function () {
                setLoading(false);
                scrollToLatest();
            });
    });

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            form.dispatchEvent(new Event('submit'));
        }
    });

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

    btnEstimate.addEventListener('click', function () {
        modalEstimate.hidden = false;
        estimateResult.hidden = true;
        estimateFeedback.hidden = true;
        lastEstimatePayload = null;
    });

    btnCloseEstimate.addEventListener('click', function () {
        modalEstimate.hidden = true;
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
                estimateResult.innerHTML = html;
                estimateResult.hidden = false;
                estimateFeedback.hidden = false;
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

    modalEstimate.addEventListener('click', function (e) {
        if (e.target === modalEstimate) modalEstimate.hidden = true;
    });

    modalNewProject.addEventListener('click', function (e) {
        if (e.target === modalNewProject) modalNewProject.hidden = true;
    });

    ensureProject();
    renderProjects();
    renderMessages();
})();
