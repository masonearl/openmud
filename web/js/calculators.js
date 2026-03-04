/* openmud Construction Calculators */
'use strict';

// ─── Navigation ───────────────────────────────────────────────────────────────

(function initNav() {
    var links = document.querySelectorAll('.calc-nav-link');
    links.forEach(function(link) {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            showPanel(this.dataset.panel);
        });
    });
})();

function showPanel(id) {
    document.querySelectorAll('.calc-panel').forEach(function(p) { p.classList.remove('active'); });
    document.querySelectorAll('.calc-nav-link').forEach(function(l) { l.classList.remove('active'); });
    var panel = document.getElementById('panel-' + id);
    var link = document.querySelector('[data-panel="' + id + '"]');
    if (panel) panel.classList.add('active');
    if (link) link.classList.add('active');
    // Sync mobile select
    var sel = document.querySelector('.calc-mobile-select');
    if (sel) sel.value = id;
    var main = document.querySelector('.calc-main');
    if (main) main.scrollTop = 0;
    if (window.location.hash !== '#' + id) window.location.hash = id;
}

function showPanelFromHash() {
    var hash = decodeURIComponent(window.location.hash || '').replace(/^#/, '').trim();
    if (!hash) return;
    if (document.getElementById('panel-' + hash)) showPanel(hash);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(id) { return parseFloat(document.getElementById(id).value) || 0; }
function s(id) { return document.getElementById(id).value; }
function fmt(v, dec) { return v.toLocaleString('en-US', { minimumFractionDigits: dec === undefined ? 2 : dec, maximumFractionDigits: dec === undefined ? 2 : dec }); }
function fmtDollar(v) { return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function results(containerId, rows) {
    var el = document.getElementById(containerId);
    el.innerHTML = rows.map(function(r) {
        if (r.section) return '<div class="result-section"><p class="result-section-title">' + r.section + '</p></div>';
        var cls = 'result-value' + (r.primary ? ' result-primary' : '') + (r.warn ? ' result-warn' : '') + (r.ok ? ' result-ok' : '') + (r.bad ? ' result-bad' : '');
        return '<div class="result-row"><span class="result-label">' + r.label + '</span><span class="' + cls + '">' + r.value + '</span></div>';
    }).join('');
}

// ─── TAKEOFF CALCULATORS ──────────────────────────────────────────────────────

function calcTrenchVolume() {
    var len = n('tv-length'), width = n('tv-width'), depth = n('tv-depth');
    var pipeOD = n('tv-pipe-od') / 12; // convert inches to ft
    var bedding = n('tv-bedding') / 12;
    var swell = n('tv-swell') / 100;
    var needImport = s('tv-import') === 'yes';

    var excavCF = len * width * depth;
    var excavCY = excavCF / 27;

    // Pipe void volume
    var pipeRadius = pipeOD / 2;
    var pipeVoidCF = Math.PI * pipeRadius * pipeRadius * len;
    var pipeVoidCY = pipeVoidCF / 27;

    // Bedding volume (rectangular prism below pipe, full trench width)
    var beddingCF = len * width * bedding;
    var beddingCY = beddingCF / 27;

    // Backfill needed = excavation - pipe void - bedding already placed
    var backfillCY = excavCY - pipeVoidCY - beddingCY;

    // Spoil haul (native soil with swell)
    var spoilCY = needImport ? excavCY * (1 + swell) : (excavCY - backfillCY) * (1 + swell);

    results('tv-results', [
        { label: 'Excavation volume', value: fmt(excavCY) + ' CY', primary: true },
        { label: 'Pipe void (deduct)', value: fmt(pipeVoidCY) + ' CY' },
        { label: 'Bedding material', value: fmt(beddingCY) + ' CY' },
        { label: 'Backfill required', value: fmt(backfillCY) + ' CY', primary: true },
        { section: 'Haul' },
        { label: 'Spoil to haul (' + n('tv-swell') + '% swell)', value: fmt(spoilCY) + ' CY' },
        { label: 'Spoil weight (est. 1.4 T/CY)', value: fmt(spoilCY * 1.4) + ' tons' },
        { section: 'Cross-check' },
        { label: 'Trench volume (CF)', value: fmt(excavCF, 0) + ' CF' },
        { label: 'Trench volume (BCY)', value: fmt(excavCY) + ' BCY' },
    ]);
}

var currentConcreteTab = 'slab';
function showConcreteTab(tab, btn) {
    ['slab', 'wall', 'cylinder'].forEach(function(t) {
        document.getElementById('concrete-' + t).style.display = t === tab ? '' : 'none';
    });
    document.querySelectorAll('#panel-concrete-volume .calc-tab').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    currentConcreteTab = tab;
}

function calcConcreteVolume() {
    var waste = 1 + n('cv-waste') / 100;
    var psiPrices = { '3000': 166, '4000': 180, '5000': 195 };
    var psi = s('cv-psi');
    var price = psiPrices[psi] || 180;
    var vol, label;

    if (currentConcreteTab === 'slab') {
        var l = n('cv-slab-l'), w = n('cv-slab-w'), t = n('cv-slab-t') / 12;
        vol = l * w * t / 27;
        label = fmt(l, 0) + '×' + fmt(w, 0) + ' ft slab';
    } else if (currentConcreteTab === 'wall') {
        var wl = n('cv-wall-l'), wh = n('cv-wall-h'), wt = n('cv-wall-t') / 12;
        vol = wl * wh * wt / 27;
        label = 'Wall';
    } else {
        var od = n('cv-cyl-od'), id2 = n('cv-cyl-id'), ch = n('cv-cyl-h');
        var area = Math.PI / 4 * (od * od - id2 * id2);
        vol = area * ch / 27;
        label = 'Cylinder / manhole';
    }

    var volWithWaste = vol * waste;
    results('cv-results', [
        { label: label + ' – net volume', value: fmt(vol) + ' CY' },
        { label: 'With ' + n('cv-waste') + '% waste factor', value: fmt(volWithWaste) + ' CY', primary: true },
        { section: 'Cost estimate' },
        { label: 'Concrete @ ' + fmtDollar(price) + '/CY', value: fmtDollar(volWithWaste * price) },
        { label: 'Per truck load (~10 CY)', value: fmt(volWithWaste / 10, 1) + ' loads' },
    ]);
}

function calcAsphalt() {
    var area = n('at-area'), thickness = n('at-thickness') / 12, density = n('at-density'), price = n('at-price');
    var waste = 1 + n('at-waste') / 100;
    var cf = area * thickness;
    var lbs = cf * density;
    var tons = lbs / 2000;
    var tonsWithWaste = tons * waste;
    results('at-results', [
        { label: 'Net volume', value: fmt(cf, 0) + ' CF' },
        { label: 'Net tonnage', value: fmt(tons) + ' tons' },
        { label: 'Tonnage with ' + n('at-waste') + '% waste', value: fmt(tonsWithWaste) + ' tons', primary: true },
        { section: 'Cost' },
        { label: 'Material @ ' + fmtDollar(price) + '/ton', value: fmtDollar(tonsWithWaste * price) },
    ]);
}

function calcPipeQuantity() {
    var len = n('pq-length'), dia = n('pq-diameter'), jointLen = n('pq-joint');
    var elbows90 = n('pq-90'), elbows45 = n('pq-45'), tees = n('pq-tees'), couplings = n('pq-couplings');
    var beddingDepth = n('pq-bedding') / 12, trenchW = n('pq-tw');
    var material = s('pq-material');

    var numJoints = Math.ceil(len / jointLen);
    var beddingCF = len * trenchW * beddingDepth;
    var beddingCY = beddingCF / 27;
    var beddingTons = beddingCY * 1.35; // approx 1.35 T/CY for crushed rock

    results('pq-results', [
        { label: 'Pipe length (' + material + ', ' + dia + '")', value: fmt(len, 0) + ' LF', primary: true },
        { label: 'Joints / bells', value: fmt(numJoints, 0) + ' EA' },
        { section: 'Fittings' },
        { label: '90° elbows', value: elbows90 + ' EA' },
        { label: '45° elbows', value: elbows45 + ' EA' },
        { label: 'Tees', value: tees + ' EA' },
        { label: 'Couplings / repair sleeves', value: couplings + ' EA' },
        { section: 'Bedding (' + n('pq-bedding') + '" depth, ' + trenchW + ' ft wide)' },
        { label: 'Bedding volume', value: fmt(beddingCY) + ' CY' },
        { label: 'Crushed rock bedding (est.)', value: fmt(beddingTons) + ' tons' },
    ]);
}

// ─── ENGINEERING CALCULATORS ──────────────────────────────────────────────────

document.getElementById('pf-n').addEventListener('change', function() {
    document.getElementById('pf-n-custom-row').style.display = this.value === 'custom' ? '' : 'none';
});
document.getElementById('pf-depth').addEventListener('change', function() {
    document.getElementById('pf-depth-custom-row').style.display = this.value === 'custom' ? '' : 'none';
});
document.getElementById('tb-soil').addEventListener('change', function() {
    document.getElementById('tb-soil-custom-row').style.display = this.value === 'custom' ? '' : 'none';
});

function calcPipeFlow() {
    var diaIn = n('pf-diameter');
    var slope = n('pf-slope');
    var nSel = s('pf-n');
    var mann = nSel === 'custom' ? n('pf-n-custom') : parseFloat(nSel);
    var depthSel = s('pf-depth');
    var dRatio = depthSel === 'custom' ? n('pf-depth-custom') : parseFloat(depthSel);

    var D = diaIn / 12; // diameter in feet
    var r = D / 2; // radius

    // Full pipe hydraulic properties
    var A_full = Math.PI * r * r;
    var P_full = Math.PI * D;
    var R_full = A_full / P_full; // D/4

    // Partial flow (use lookup ratio tables or trig for partial depth)
    var theta = 2 * Math.acos(1 - 2 * dRatio); // central angle for partial depth
    var A_partial = (r * r / 2) * (theta - Math.sin(theta));
    var P_partial = r * theta;
    var R_partial = A_partial / P_partial;

    var Q_full = (1.0 / mann) * A_full * Math.pow(R_full, 2/3) * Math.pow(slope, 0.5);
    var V_full = Q_full / A_full;

    var Q_partial = (1.0 / mann) * A_partial * Math.pow(R_partial, 2/3) * Math.pow(slope, 0.5);
    var V_partial = Q_partial / A_partial;

    var slopeIn = slope * 12; // inches drop per foot
    var velWarn = V_partial < 2.0 ? 'result-bad' : (V_partial < 2.5 ? 'result-warn' : 'result-ok');

    results('pf-results', [
        { label: 'Flow rate at ' + (dRatio * 100).toFixed(0) + '% full', value: fmt(Q_partial * 449, 0) + ' GPM = ' + fmt(Q_partial, 3) + ' CFS', primary: true },
        { label: 'Velocity at ' + (dRatio * 100).toFixed(0) + '% full', value: fmt(V_partial, 2) + ' ft/s', [velWarn]: true },
        { section: 'Full pipe (reference)' },
        { label: 'Full pipe capacity', value: fmt(Q_full * 449, 0) + ' GPM = ' + fmt(Q_full, 3) + ' CFS' },
        { label: 'Full pipe velocity', value: fmt(V_full, 2) + ' ft/s' },
        { section: 'Pipe parameters' },
        { label: 'Pipe diameter', value: diaIn + ' in = ' + fmt(D, 3) + ' ft' },
        { label: 'Slope', value: (slope * 100).toFixed(3) + '% = ' + fmt(slopeIn, 3) + ' in/ft' },
        { label: 'Manning\'s n', value: mann },
        { label: 'Flow area (at d/D=' + dRatio + ')', value: fmt(A_partial, 4) + ' SF' },
    ]);
}

function calcMinSlope() {
    var diaIn = n('ms-diameter');
    var mann = parseFloat(s('ms-n'));
    var targetV = parseFloat(s('ms-velocity'));
    var D = diaIn / 12;
    var r = D / 2;
    var A = Math.PI * r * r;
    var R = D / 4;
    // V = (1/n) * R^(2/3) * S^(1/2)  →  S = (V * n / R^(2/3))^2
    var minSlope = Math.pow((targetV * mann) / Math.pow(R, 2/3), 2);
    var slopePct = minSlope * 100;
    var drop100 = minSlope * 100 * 12; // inches of drop per 100 ft

    results('ms-results', [
        { label: 'Minimum slope (ft/ft)', value: minSlope.toFixed(5), primary: true },
        { label: 'Minimum slope (%)', value: slopePct.toFixed(4) + '%', primary: true },
        { label: 'Drop per 100 LF', value: fmt(minSlope * 100, 3) + ' ft = ' + fmt(drop100, 2) + ' in' },
        { label: 'Target velocity', value: targetV + ' ft/s at full flow' },
        { label: 'Pipe diameter', value: diaIn + '"' },
        { label: 'Manning\'s n', value: mann },
    ]);
}

function calcTrenchSafety() {
    var depth = n('ts-depth');
    var soil = s('ts-soil');
    var method = s('ts-method');

    var slopes = { A: '3/4:1 (0.75H:1V)', B: '1:1 (1H:1V)', C: '1.5:1 (1.5H:1V)' };
    var hRatios = { A: 0.75, B: 1.0, C: 1.5 };
    var hRatio = hRatios[soil];

    if (depth <= 4) {
        results('ts-results', [
            { label: 'Depth ≤ 4 ft', value: 'Protective system not required by OSHA', ok: true },
            { label: 'Note', value: 'Competent person must still evaluate site conditions' },
        ]);
        return;
    }

    var rows = [
        { label: 'Trench depth', value: fmt(depth, 1) + ' ft' },
        { label: 'Soil classification', value: 'Type ' + soil },
    ];

    if (method === 'slope') {
        var slopeRatio = slopes[soil];
        var setback = depth * hRatio;
        var totalWidth = 2 * setback;
        rows = rows.concat([
            { label: 'Required slope (max)', value: slopeRatio, primary: true },
            { label: 'Horizontal setback each side', value: fmt(setback, 1) + ' ft' },
            { label: 'Total trench width at top', value: fmt(totalWidth, 1) + ' ft (bottom width + ' + fmt(2 * setback, 1) + ' ft)', primary: true },
        ]);
        if (soil === 'C') rows.push({ label: 'Warning', value: 'Type C requires 1.5:1 slope — significant ROW may be needed for deep trenches', warn: true });
    } else if (method === 'bench') {
        if (soil === 'C') {
            rows.push({ label: 'Benching not permitted', value: 'Type C soil cannot be benched per OSHA 1926 App B', bad: true });
        } else {
            var benchH = soil === 'A' ? 4 : 4; // initial slope height
            rows = rows.concat([
                { label: 'Maximum initial bench height', value: '4 ft (initial vertical cut)', primary: true },
                { label: 'Bench slope', value: soil === 'A' ? '3/4:1 to vertical at top' : '1:1 (Type B)' },
                { label: 'Each bench width minimum', value: '4 ft horizontal' },
            ]);
        }
    } else if (method === 'shield') {
        rows = rows.concat([
            { label: 'Trench shield / box permitted', value: 'Yes – for all soil types', ok: true },
            { label: 'Shield must extend', value: '18 inches above unstable soil or to within 2 ft of surface' },
            { label: 'Spoil setback from edge', value: 'Minimum 2 ft from trench edge', primary: true },
            { label: 'No personnel in shield during movement', value: 'Workers must exit before repositioning', warn: true },
        ]);
    }

    rows.push({ label: '⚠ Always consult competent person on site', value: 'OSHA 29 CFR 1926.652', warn: true });
    results('ts-results', rows);
}

function calcThrustBlock() {
    var diaIn = n('tb-diameter');
    var pressure = n('tb-pressure');
    var fitting = s('tb-fitting');
    var soilSel = s('tb-soil');
    var soilBearing = soilSel === 'custom' ? n('tb-soil-custom') : parseFloat(soilSel);

    var D = diaIn / 12; // ft
    var A = Math.PI * (D / 2) * (D / 2); // pipe cross-sectional area, SF
    var pressurePSF = pressure * 144; // PSI → PSF

    var thrust, fittingLabel;
    if (fitting === 'dead') {
        thrust = pressurePSF * A;
        fittingLabel = 'Dead end / cap (T = P×A)';
    } else if (fitting === 'tee') {
        thrust = pressurePSF * A;
        fittingLabel = 'Tee branch';
    } else {
        var angle = parseFloat(fitting);
        thrust = 2 * pressurePSF * A * Math.sin((angle / 2) * Math.PI / 180);
        fittingLabel = angle + '° bend (T = 2PA·sin(θ/2))';
    }

    var bearingAreaSF = thrust / soilBearing;
    var bearingAreaSF_design = bearingAreaSF * 1.5; // safety factor
    var blockDim = Math.sqrt(bearingAreaSF_design); // approx square block

    results('tb-results', [
        { label: 'Thrust force', value: fmt(thrust, 0) + ' lbf', primary: true },
        { label: 'Fitting type', value: fittingLabel },
        { section: 'Block sizing' },
        { label: 'Soil bearing capacity', value: fmt(soilBearing, 0) + ' PSF' },
        { label: 'Minimum bearing area', value: fmt(bearingAreaSF, 2) + ' SF' },
        { label: 'With 1.5 safety factor', value: fmt(bearingAreaSF_design, 2) + ' SF', primary: true },
        { label: 'Approx square block', value: fmt(blockDim, 1) + ' ft × ' + fmt(blockDim, 1) + ' ft' },
        { label: 'Block volume (18" thick)', value: fmt(bearingAreaSF_design * 1.5 / 27, 2) + ' CY concrete' },
    ]);
}

var currentGradeTab = 'from-percent';
function showGradeTab(tab, btn) {
    ['from-percent', 'from-elevations'].forEach(function(t) {
        document.getElementById('grade-' + t).style.display = t === tab ? '' : 'none';
    });
    document.querySelectorAll('#panel-grade-slope .calc-tab').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    currentGradeTab = tab;
}

function calcGrade() {
    var rows;
    if (currentGradeTab === 'from-percent') {
        var pct = n('gs-pct');
        var dist = n('gs-dist');
        var ftft = pct / 100;
        var rise = ftft * dist;
        var deg = Math.atan(ftft) * 180 / Math.PI;
        rows = [
            { label: 'Grade', value: pct + '% = ' + ftft.toFixed(5) + ' ft/ft', primary: true },
            { label: 'Rise over ' + fmt(dist, 0) + ' ft', value: fmt(rise, 3) + ' ft = ' + fmt(rise * 12, 2) + ' in', primary: true },
            { label: 'Angle', value: fmt(deg, 3) + '°' },
            { label: 'Slope ratio', value: '1:' + fmt(1 / ftft, 1) + ' (H:V)' },
        ];
    } else {
        var start = n('gs-elev-start'), end2 = n('gs-elev-end'), dist2 = n('gs-elev-dist');
        var rise2 = start - end2;
        var ftft2 = rise2 / dist2;
        var pct2 = ftft2 * 100;
        var deg2 = Math.atan(Math.abs(ftft2)) * 180 / Math.PI;
        rows = [
            { label: 'Elevation change', value: (rise2 >= 0 ? '-' : '+') + fmt(Math.abs(rise2), 3) + ' ft (' + (rise2 >= 0 ? 'fall' : 'rise') + ')' },
            { label: 'Grade (ft/ft)', value: ftft2.toFixed(5), primary: true },
            { label: 'Grade (%)', value: fmt(Math.abs(pct2), 3) + '%', primary: true },
            { label: 'Drop/rise per 100 ft', value: fmt(Math.abs(ftft2) * 100, 3) + ' ft' },
            { label: 'Angle', value: fmt(deg2, 3) + '°' },
        ];
    }
    results('gs-results', rows);
}

var currentCompTab = 'relative';
function showCompTab(tab, btn) {
    ['relative', 'lifts'].forEach(function(t) {
        document.getElementById('comp-' + t).style.display = t === tab ? '' : 'none';
    });
    document.querySelectorAll('#panel-compaction .calc-tab').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    currentCompTab = tab;
}

function calcCompaction() {
    if (currentCompTab === 'relative') {
        var mdd = n('comp-mdd'), fdd = n('comp-fdd');
        var req = parseFloat(s('comp-req'));
        var rc = (fdd / mdd) * 100;
        var pass = rc >= req;
        results('comp-results', [
            { label: 'Field dry density', value: fmt(fdd, 1) + ' pcf' },
            { label: 'Max dry density (Proctor)', value: fmt(mdd, 1) + ' pcf' },
            { label: 'Relative compaction', value: fmt(rc, 1) + '%', primary: true, [pass ? 'ok' : 'bad']: true },
            { label: 'Required compaction', value: req + '%' },
            { label: 'Result', value: pass ? 'PASSES – ' + fmt(rc - req, 1) + '% above minimum' : 'FAILS – ' + fmt(req - rc, 1) + '% below minimum', [pass ? 'ok' : 'bad']: true },
        ]);
    } else {
        var fill = n('comp-fill');
        var liftInStr = s('comp-type');
        var liftIn = parseFloat(liftInStr);
        var liftFt = liftIn / 12;
        var numLifts = Math.ceil(fill / liftFt);
        results('comp-results', [
            { label: 'Total fill depth', value: fmt(fill, 1) + ' ft' },
            { label: 'Lift thickness', value: liftIn + ' inches' },
            { label: 'Number of lifts', value: numLifts + ' lifts', primary: true },
            { label: 'Actual lift (last)', value: fmt(((fill % liftFt) || liftFt) * 12, 1) + ' inches' },
            { label: 'Note', value: 'Verify lift thickness with compactor manufacturer specs and soil type', warn: true },
        ]);
    }
}

// ─── COST CALCULATORS ─────────────────────────────────────────────────────────

var currentMarkupTab = 'cost-to-bid';
function showMarkupTab(tab, btn) {
    ['cost-to-bid', 'bid-to-cost'].forEach(function(t) {
        document.getElementById('markup-' + t).style.display = t === tab ? '' : 'none';
    });
    document.querySelectorAll('#panel-markup .calc-tab').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    currentMarkupTab = tab;
}

function calcMarkup() {
    if (currentMarkupTab === 'cost-to-bid') {
        var cost = n('mk-cost'), oh = n('mk-oh') / 100, profit = n('mk-profit') / 100;
        var overhead = cost * oh;
        var loadedCost = cost + overhead;
        var profitDollar = loadedCost * profit;
        var bid = loadedCost + profitDollar;
        var totalMarkup = (bid / cost - 1) * 100;
        results('mk-results', [
            { label: 'Direct cost', value: fmtDollar(cost) },
            { label: 'Overhead (' + (oh * 100) + '%)', value: fmtDollar(overhead) },
            { label: 'Overhead-loaded cost', value: fmtDollar(loadedCost) },
            { label: 'Profit (' + (profit * 100) + '%)', value: fmtDollar(profitDollar) },
            { label: 'Bid price', value: fmtDollar(bid), primary: true },
            { label: 'Total markup on cost', value: fmt(totalMarkup, 1) + '%' },
        ]);
    } else {
        var bid2 = n('mk-bid'), oh2 = n('mk-oh2') / 100, profit2 = n('mk-profit2') / 100;
        // bid = cost * (1 + oh) * (1 + profit)  →  cost = bid / ((1+oh)*(1+profit))
        var divisor = (1 + oh2) * (1 + profit2);
        var cost2 = bid2 / divisor;
        var overhead2 = cost2 * oh2;
        var profitDollar2 = (cost2 + overhead2) * profit2;
        results('mk-results', [
            { label: 'Bid price', value: fmtDollar(bid2) },
            { label: 'Implied direct cost', value: fmtDollar(cost2), primary: true },
            { label: 'Overhead (' + (oh2 * 100) + '%)', value: fmtDollar(overhead2) },
            { label: 'Profit (' + (profit2 * 100) + '%)', value: fmtDollar(profitDollar2) },
            { label: 'Margin on bid', value: fmt((profitDollar2 / bid2) * 100, 1) + '%' },
        ]);
    }
}

function calcUnitPrice() {
    var mat = n('up-material'), lab = n('up-labor'), eq = n('up-equipment'), sub = n('up-sub');
    var oh = n('up-oh') / 100, profit = n('up-profit') / 100;
    var qty = n('up-qty');
    var unit = s('up-unit');

    var direct = mat + lab + eq + sub;
    var overhead = direct * oh;
    var loaded = direct + overhead;
    var profitAmt = loaded * profit;
    var unitPrice = loaded + profitAmt;
    results('up-results', [
        { label: 'Material', value: fmtDollar(mat) + '/' + unit },
        { label: 'Labor', value: fmtDollar(lab) + '/' + unit },
        { label: 'Equipment', value: fmtDollar(eq) + '/' + unit },
        { label: 'Subcontractor', value: fmtDollar(sub) + '/' + unit },
        { label: 'Direct cost', value: fmtDollar(direct) + '/' + unit },
        { label: 'Overhead (' + n('up-oh') + '%)', value: fmtDollar(overhead) + '/' + unit },
        { label: 'Profit (' + n('up-profit') + '%)', value: fmtDollar(profitAmt) + '/' + unit },
        { label: 'Unit bid price', value: fmtDollar(unitPrice) + '/' + unit, primary: true },
        { section: 'Total for ' + fmt(qty, 0) + ' ' + unit },
        { label: 'Total bid', value: fmtDollar(unitPrice * qty), primary: true },
    ]);
}

var currentCOTab = 'tm';
function showCOTab(tab, btn) {
    ['tm', 'unit'].forEach(function(t) {
        document.getElementById('co-' + t).style.display = t === tab ? '' : 'none';
    });
    document.querySelectorAll('#panel-change-order .calc-tab').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    currentCOTab = tab;
}

function calcChangeOrder() {
    var markup = n('co-markup') / 100;
    var bond = n('co-bond') / 100;
    var subtotal, rows;

    if (currentCOTab === 'tm') {
        var superCost = n('co-super-hrs') * n('co-super-rate');
        var labCost = n('co-lab-hrs') * n('co-lab-rate');
        var eqCost = n('co-eq-hrs') * n('co-eq-rate');
        var mat = n('co-mat');
        subtotal = superCost + labCost + eqCost + mat;
        rows = [
            { label: 'Superintendent', value: fmtDollar(superCost) },
            { label: 'Labor', value: fmtDollar(labCost) },
            { label: 'Equipment', value: fmtDollar(eqCost) },
            { label: 'Materials', value: fmtDollar(mat) },
        ];
    } else {
        var qty = n('co-qty'), unitP = n('co-unit-price');
        subtotal = qty * unitP;
        rows = [
            { label: s('co-desc') || 'Work item', value: fmt(qty, 0) + ' ' + s('co-unit-uom') + ' × ' + fmtDollar(unitP) },
        ];
    }

    var markupAmt = subtotal * markup;
    var subtotalPlusMarkup = subtotal + markupAmt;
    var bondAmt = subtotalPlusMarkup * bond;
    var total = subtotalPlusMarkup + bondAmt;

    results('co-results', rows.concat([
        { label: 'Subtotal', value: fmtDollar(subtotal) },
        { label: 'O&P (' + n('co-markup') + '%)', value: fmtDollar(markupAmt) },
        { label: 'Bond (' + n('co-bond') + '%)', value: fmtDollar(bondAmt) },
        { label: 'Change Order Total', value: fmtDollar(total), primary: true },
    ]));
}

var defaultRates = { 'pipe-install': 250, 'excavation': 450, 'backfill': 600, 'pavement': 800, 'custom': 250 };
var defaultUOMs = { 'pipe-install': 'LF', 'excavation': 'LF', 'backfill': 'LF', 'pavement': 'SF', 'custom': 'LF' };
function fillProductionDefaults() {
    var type = s('pr-type');
    document.getElementById('pr-rate').value = defaultRates[type] || 250;
    var uomSel = document.getElementById('pr-uom');
    for (var i = 0; i < uomSel.options.length; i++) {
        if (uomSel.options[i].value === (defaultUOMs[type] || 'LF')) { uomSel.selectedIndex = i; break; }
    }
}

function calcProductionRate() {
    var rate = n('pr-rate'), qty = n('pr-qty'), crewSize = n('pr-crew');
    var crewRate = n('pr-crew-rate'), hours = n('pr-hours'), equip = n('pr-equip');
    var uom = s('pr-uom');

    var days = qty / rate;
    var crewCostPerDay = crewSize * crewRate * hours;
    var totalDayCost = crewCostPerDay + equip;
    var costPerUnit = totalDayCost / rate;
    var totalProjectCost = costPerUnit * qty;

    results('pr-results', [
        { label: 'Production rate', value: fmt(rate, 0) + ' ' + uom + '/day' },
        { label: 'Total quantity', value: fmt(qty, 0) + ' ' + uom },
        { label: 'Duration', value: fmt(days, 1) + ' work days', primary: true },
        { section: 'Daily cost breakdown' },
        { label: 'Crew cost (' + crewSize + ' workers × ' + fmtDollar(crewRate) + '/hr × ' + hours + ' hrs)', value: fmtDollar(crewCostPerDay) },
        { label: 'Equipment', value: fmtDollar(equip) },
        { label: 'Total day cost', value: fmtDollar(totalDayCost) },
        { section: 'Unit economics' },
        { label: 'Cost per ' + uom, value: fmtDollar(costPerUnit), primary: true },
        { label: 'Total project cost (direct)', value: fmtDollar(totalProjectCost), primary: true },
    ]);
}

// Crew day calculator
function addCrewRow() {
    var row = document.createElement('div');
    row.className = 'crew-row';
    row.innerHTML = '<input type="text" placeholder="Role" class="crew-role"><input type="number" class="crew-hrs" value="10" min="0"><input type="number" class="crew-rate" value="55" min="0"><span class="crew-remove" onclick="removeCrewRow(this)">×</span>';
    document.getElementById('crew-rows').appendChild(row);
}
function removeCrewRow(el) { el.parentElement.remove(); }

function addEquipRow() {
    var row = document.createElement('div');
    row.className = 'crew-row';
    row.innerHTML = '<input type="text" placeholder="Equipment" class="crew-role"><input type="number" class="crew-hrs" value="1" min="0" style="display:none"><input type="number" class="crew-rate" value="300" min="0" placeholder="$/day"><span class="crew-remove" onclick="removeEquipRow(this)">×</span>';
    document.getElementById('equip-rows').appendChild(row);
}
function removeEquipRow(el) { el.parentElement.remove(); }

function calcCrewDay() {
    var laborTotal = 0;
    var laborRows = [];
    document.querySelectorAll('#crew-rows .crew-row').forEach(function(row) {
        var role = row.querySelector('.crew-role').value || 'Worker';
        var hrs = parseFloat(row.querySelector('.crew-hrs').value) || 0;
        var rate = parseFloat(row.querySelector('.crew-rate').value) || 0;
        var cost = hrs * rate;
        laborTotal += cost;
        laborRows.push({ label: role + ' (' + hrs + ' hrs × $' + rate + '/hr)', value: fmtDollar(cost) });
    });

    var equipTotal = 0;
    var equipRows = [];
    document.querySelectorAll('#equip-rows .crew-row').forEach(function(row) {
        var name = row.querySelector('.crew-role').value || 'Equipment';
        var rate = parseFloat(row.querySelector('.crew-rate').value) || 0;
        equipTotal += rate;
        equipRows.push({ label: name, value: fmtDollar(rate) });
    });

    var tools = n('cd-tools'), oh = n('cd-oh') / 100;
    var subtotal = laborTotal + equipTotal + tools;
    var overhead = subtotal * oh;
    var total = subtotal + overhead;

    var rows = [{ section: 'Labor' }].concat(laborRows)
        .concat([{ section: 'Equipment' }]).concat(equipRows)
        .concat([
            { section: 'Summary' },
            { label: 'Labor subtotal', value: fmtDollar(laborTotal) },
            { label: 'Equipment subtotal', value: fmtDollar(equipTotal) },
            { label: 'Small tools / consumables', value: fmtDollar(tools) },
            { label: 'Subtotal', value: fmtDollar(subtotal) },
            { label: 'Overhead burden (' + n('cd-oh') + '%)', value: fmtDollar(overhead) },
            { label: 'Total day cost', value: fmtDollar(total), primary: true },
        ]);
    results('cd-results', rows);
}

// ─── UNIT CONVERTER ───────────────────────────────────────────────────────────

var ucUnits = {
    volume: [
        ['Cubic yards (CY)', 1],
        ['Cubic feet (CF)', 27],
        ['Cubic inches (CI)', 46656],
        ['Gallons', 201.974],
        ['Liters', 764.555],
    ],
    area: [
        ['Square feet (SF)', 1],
        ['Square yards (SY)', 1/9],
        ['Square inches (SI)', 144],
        ['Acres', 1/43560],
        ['Hectares', 1/107639],
        ['Square meters (SM)', 1/10.764],
    ],
    weight: [
        ['Pounds (lbs)', 1],
        ['Tons (short)', 1/2000],
        ['Tons (metric)', 1/2204.62],
        ['Kilograms', 1/2.20462],
        ['Ounces', 16],
    ],
    pressure: [
        ['PSI', 1],
        ['PSF (lb/ft²)', 144],
        ['Bar', 1/14.5038],
        ['kPa', 1/0.145038],
        ['MPa', 1/145.038],
        ['ft of water', 1/0.43353],
        ['m of water', 1/1.42233],
    ],
    length: [
        ['Feet (ft)', 1],
        ['Inches (in)', 12],
        ['Yards (yd)', 1/3],
        ['Miles (mi)', 1/5280],
        ['Meters (m)', 1/3.28084],
        ['Kilometers (km)', 1/3280.84],
        ['Millimeters (mm)', 304.8],
    ],
    flow: [
        ['Gallons per minute (GPM)', 1],
        ['Cubic feet per second (CFS)', 1/448.831],
        ['Liters per second (L/s)', 1/15.8503],
        ['Million gallons per day (MGD)', 1/694.444],
        ['Acre-feet per day', 1/226.286],
    ],
    earthwork: [
        ['Bank CY (BCY)', 1],
        ['Loose CY (LCY) – 25% swell', 1.25],
        ['Loose CY (LCY) – 30% swell', 1.30],
        ['Compacted CY (CCY) – 10% shrink', 0.90],
        ['Compacted CY (CCY) – 15% shrink', 0.85],
        ['Cubic feet (BCF)', 27],
    ],
};

function updateUCUnits() {
    var cat = s('uc-category');
    var units = ucUnits[cat] || [];
    ['uc-from', 'uc-to'].forEach(function(id, i) {
        var sel = document.getElementById(id);
        sel.innerHTML = units.map(function(u, idx) {
            return '<option value="' + idx + '"' + (idx === i ? ' selected' : '') + '>' + u[0] + '</option>';
        }).join('');
    });
    document.getElementById('uc-to').selectedIndex = 1;
}

function calcConverter() {
    var cat = s('uc-category');
    var units = ucUnits[cat] || [];
    var val = n('uc-value');
    var fromIdx = parseInt(s('uc-from'));
    var toIdx = parseInt(s('uc-to'));
    var fromUnit = units[fromIdx];
    var toUnit = units[toIdx];
    if (!fromUnit || !toUnit) return;

    // Convert to base unit first, then to target
    var inBase = val / fromUnit[1];
    var result = inBase * toUnit[1];

    results('uc-results', [
        { label: val + ' ' + fromUnit[0], value: '=', primary: false },
        { label: toUnit[0], value: fmt(result, result < 0.01 ? 6 : result < 1 ? 4 : 3), primary: true },
        { label: 'Rounded', value: fmt(result, 2) + ' ' + toUnit[0].split(' ')[0] },
    ]);
}

// ─── PIPE REFERENCE TABLE ─────────────────────────────────────────────────────

var pipeData = [
    // [Material, NomSize, OD_in, Wall_in, Weight_lbft, PressureClass, Standard]
    ['PVC', '4"', '4.500', '0.237', '1.12', 'C900 DR18 (165 PSI)', 'AWWA C900'],
    ['PVC', '6"', '6.625', '0.280', '1.96', 'C900 DR18 (165 PSI)', 'AWWA C900'],
    ['PVC', '8"', '8.625', '0.322', '2.95', 'C900 DR18 (165 PSI)', 'AWWA C900'],
    ['PVC', '10"', '10.750', '0.402', '4.59', 'C900 DR18 (165 PSI)', 'AWWA C900'],
    ['PVC', '12"', '12.750', '0.476', '6.45', 'C900 DR18 (165 PSI)', 'AWWA C900'],
    ['PVC', '4"', '4.215', '0.240', '1.07', 'SDR 35 (Gravity)', 'ASTM D3034'],
    ['PVC', '6"', '6.275', '0.258', '1.70', 'SDR 35 (Gravity)', 'ASTM D3034'],
    ['PVC', '8"', '8.400', '0.338', '3.00', 'SDR 35 (Gravity)', 'ASTM D3034'],
    ['PVC', '10"', '10.500', '0.422', '4.68', 'SDR 35 (Gravity)', 'ASTM D3034'],
    ['PVC', '12"', '12.500', '0.500', '6.64', 'SDR 35 (Gravity)', 'ASTM D3034'],
    ['HDPE', '4"', '4.500', '0.409', '1.94', 'DR11 (200 PSI)', 'ASTM D3035'],
    ['HDPE', '6"', '6.625', '0.602', '4.21', 'DR11 (200 PSI)', 'ASTM D3035'],
    ['HDPE', '8"', '8.625', '0.784', '7.13', 'DR11 (200 PSI)', 'ASTM D3035'],
    ['HDPE', '10"', '10.750', '0.977', '11.07', 'DR11 (200 PSI)', 'ASTM D3035'],
    ['HDPE', '12"', '12.750', '1.159', '15.56', 'DR11 (200 PSI)', 'ASTM D3035'],
    ['HDPE', '4"', '4.500', '0.265', '1.26', 'DR17 (100 PSI)', 'ASTM D3035'],
    ['HDPE', '6"', '6.625', '0.390', '2.73', 'DR17 (100 PSI)', 'ASTM D3035'],
    ['HDPE', '8"', '8.625', '0.507', '4.62', 'DR17 (100 PSI)', 'ASTM D3035'],
    ['DIP', '4"', '4.800', '0.290', '13.35', 'Pressure Class 350', 'AWWA C151'],
    ['DIP', '6"', '6.900', '0.310', '19.50', 'Pressure Class 350', 'AWWA C151'],
    ['DIP', '8"', '9.050', '0.330', '27.75', 'Pressure Class 350', 'AWWA C151'],
    ['DIP', '10"', '11.100', '0.350', '36.68', 'Pressure Class 350', 'AWWA C151'],
    ['DIP', '12"', '13.200', '0.370', '47.03', 'Pressure Class 350', 'AWWA C151'],
    ['DIP', '16"', '17.400', '0.400', '66.95', 'Pressure Class 250', 'AWWA C151'],
    ['RCP', '12"', '14.0', '1.0', '79', 'Wall B / Class III', 'ASTM C76'],
    ['RCP', '15"', '17.0', '1.25', '118', 'Wall B / Class III', 'ASTM C76'],
    ['RCP', '18"', '21.0', '1.50', '174', 'Wall B / Class III', 'ASTM C76'],
    ['RCP', '24"', '27.0', '1.875', '289', 'Wall B / Class III', 'ASTM C76'],
    ['RCP', '30"', '33.0', '2.0', '404', 'Wall B / Class III', 'ASTM C76'],
    ['RCP', '36"', '39.0', '2.25', '563', 'Wall B / Class III', 'ASTM C76'],
    ['Steel', '4"', '4.500', '0.237', '10.79', 'AWWA C200', 'AWWA C200'],
    ['Steel', '6"', '6.625', '0.280', '18.97', 'AWWA C200', 'AWWA C200'],
    ['Steel', '8"', '8.625', '0.322', '28.55', 'AWWA C200', 'AWWA C200'],
    ['Steel', '10"', '10.750', '0.365', '40.48', 'AWWA C200', 'AWWA C200'],
    ['Steel', '12"', '12.750', '0.375', '49.56', 'AWWA C200', 'AWWA C200'],
];

function buildPipeTable() {
    var tbody = document.getElementById('pipe-ref-tbody');
    if (!tbody) return;
    tbody.innerHTML = pipeData.map(function(row) {
        return '<tr data-material="' + row[0] + '"><td>' + row.join('</td><td>') + '</td></tr>';
    }).join('');
}

function filterPipeTable() {
    var filter = s('pipe-ref-filter');
    document.querySelectorAll('#pipe-ref-tbody tr').forEach(function(row) {
        row.style.display = (filter === 'all' || row.dataset.material === filter) ? '' : 'none';
    });
}

// ─── Project Estimator ────────────────────────────────────────────────────────

var MAT_SIZE_OPTIONS = {
    pipe: [
        { value: '8', label: '8" pipe ($18/LF)' },
        { value: '6', label: '6" pipe ($12/LF)' },
        { value: '4', label: '4" pipe ($8.50/LF)' },
    ],
    concrete: [
        { value: '4000_psi', label: '4,000 PSI ($180/CY)' },
        { value: '3000_psi', label: '3,000 PSI ($166/CY)' },
    ],
    rebar: [
        { value: '5_rebar', label: '#5 rebar ($1.75/LF)' },
        { value: '4_rebar', label: '#4 rebar ($1.25/LF)' },
    ],
};

function updateMatSizes(typeSelect) {
    var row = typeSelect.closest('.est-row');
    var sizeSelect = row.querySelector('.est-mat-size');
    var type = typeSelect.value;
    var options = MAT_SIZE_OPTIONS[type] || [];
    sizeSelect.innerHTML = options.map(function(o) {
        return '<option value="' + o.value + '">' + o.label + '</option>';
    }).join('');
}

function addEstMaterialRow() {
    var row = document.createElement('div');
    row.className = 'est-row';
    row.innerHTML =
        '<select class="est-mat-type" onchange="updateMatSizes(this)">' +
        '<option value="pipe">Pipe</option>' +
        '<option value="concrete">Concrete</option>' +
        '<option value="rebar">Rebar</option></select>' +
        '<select class="est-mat-size">' +
        '<option value="8">8" pipe ($18/LF)</option>' +
        '<option value="6">6" pipe ($12/LF)</option>' +
        '<option value="4">4" pipe ($8.50/LF)</option></select>' +
        '<input type="number" class="est-mat-qty" placeholder="Qty" value="100" min="0">' +
        '<span class="crew-remove" onclick="removeEstRow(this, \'material\')">×</span>';
    document.getElementById('est-material-rows').appendChild(row);
}

function addEstLaborRow() {
    var row = document.createElement('div');
    row.className = 'est-row';
    row.innerHTML =
        '<select class="est-lab-type">' +
        '<option value="operator">Operator ($85/hr)</option>' +
        '<option value="laborer">Laborer ($35/hr)</option>' +
        '<option value="foreman">Foreman ($55/hr)</option>' +
        '<option value="electrician">Electrician ($65/hr)</option>' +
        '<option value="ironworker">Ironworker ($55/hr)</option></select>' +
        '<input type="number" class="est-lab-hrs" placeholder="Hours" value="40" min="0">' +
        '<span class="crew-remove" onclick="removeEstRow(this, \'labor\')">×</span>';
    document.getElementById('est-labor-rows').appendChild(row);
}

function addEstEquipRow() {
    var row = document.createElement('div');
    row.className = 'est-row';
    row.innerHTML =
        '<select class="est-eq-type">' +
        '<option value="excavator">Excavator ($400/day)</option>' +
        '<option value="compactor">Compactor ($100/day)</option>' +
        '<option value="auger">Auger ($450/day)</option></select>' +
        '<input type="number" class="est-eq-days" placeholder="Days" value="3" min="0">' +
        '<span class="crew-remove" onclick="removeEstRow(this, \'equipment\')">×</span>';
    document.getElementById('est-equip-rows').appendChild(row);
}

function removeEstRow(el, type) {
    var containerId = type === 'material' ? 'est-material-rows' :
                      type === 'labor' ? 'est-labor-rows' : 'est-equip-rows';
    var container = document.getElementById(containerId);
    if (container.children.length > 1) el.closest('.est-row').remove();
}

async function calcProjectEstimate() {
    var resultsEl = document.getElementById('est-results');
    resultsEl.innerHTML = '<p style="color:var(--text-secondary);font-size:0.8125rem">Calculating via Python engine...</p>';

    var materials = [];
    document.querySelectorAll('#est-material-rows .est-row').forEach(function(row) {
        var type = row.querySelector('.est-mat-type').value;
        var size = row.querySelector('.est-mat-size').value;
        var qty = parseFloat(row.querySelector('.est-mat-qty').value) || 0;
        if (qty > 0) materials.push({ type: type, quantity: qty, size: size });
    });

    var labor = [];
    document.querySelectorAll('#est-labor-rows .est-row').forEach(function(row) {
        var type = row.querySelector('.est-lab-type').value;
        var hrs = parseFloat(row.querySelector('.est-lab-hrs').value) || 0;
        if (hrs > 0) labor.push({ type: type, hours: hrs });
    });

    var equipment = [];
    document.querySelectorAll('#est-equip-rows .est-row').forEach(function(row) {
        var type = row.querySelector('.est-eq-type').value;
        var days = parseFloat(row.querySelector('.est-eq-days').value) || 0;
        if (days > 0) equipment.push({ type: type, days: days });
    });

    var markup = (parseFloat(document.getElementById('est-markup').value) || 15) / 100;
    var region = document.getElementById('est-region').value || 'national';

    try {
        var res = await fetch('/api/python/estimate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ materials: materials, labor: labor, equipment: equipment, markup: markup, region: region }),
        });
        var data = await res.json();
        if (data.error) { resultsEl.innerHTML = '<p style="color:#f87171">' + data.error + '</p>'; return; }

        var rows = '<div class="result-row"><span class="result-label">Region</span><span class="result-value" style="font-size:0.8rem">' + (data.region_label || data.region) + '</span></div>';
        if (data.wage_type) rows += '<div class="result-row"><span class="result-label">Wage type</span><span class="result-value" style="font-size:0.8rem">' + data.wage_type.replace(/_/g, ' ') + '</span></div>';
        if (data.materials && data.materials.breakdown.length) {
            rows += '<div class="result-section"><div class="result-section-title">Materials</div>';
            data.materials.breakdown.forEach(function(m) {
                rows += '<div class="result-row"><span class="result-label">' + m.material + ' (' + m.quantity + ' ' + m.unit + ')</span><span class="result-value">$' + m.total_with_waste.toLocaleString() + '</span></div>';
            });
            rows += '<div class="result-row"><span class="result-label">Material subtotal</span><span class="result-value result-primary">$' + data.materials.subtotal.toLocaleString() + '</span></div></div>';
        }
        if (data.labor && data.labor.breakdown.length) {
            rows += '<div class="result-section"><div class="result-section-title">Labor</div>';
            data.labor.breakdown.forEach(function(l) {
                rows += '<div class="result-row"><span class="result-label">' + l.labor_type + ' (' + l.hours + ' hrs @ $' + l.hourly_rate + '/hr)</span><span class="result-value">$' + l.total_cost.toLocaleString() + '</span></div>';
            });
            rows += '<div class="result-row"><span class="result-label">Labor subtotal</span><span class="result-value result-primary">$' + data.labor.subtotal.toLocaleString() + '</span></div></div>';
        }
        if (data.equipment && data.equipment.breakdown.length) {
            rows += '<div class="result-section"><div class="result-section-title">Equipment</div>';
            data.equipment.breakdown.forEach(function(e) {
                rows += '<div class="result-row"><span class="result-label">' + e.equipment + ' (' + e.days + ' days @ $' + e.daily_rate + '/day)</span><span class="result-value">$' + e.total_cost.toLocaleString() + '</span></div>';
            });
            rows += '<div class="result-row"><span class="result-label">Equipment subtotal</span><span class="result-value result-primary">$' + data.equipment.subtotal.toLocaleString() + '</span></div></div>';
        }
        rows += '<div class="result-section">' +
            '<div class="result-row"><span class="result-label">Direct cost subtotal</span><span class="result-value">$' + data.subtotal.toLocaleString() + '</span></div>' +
            '<div class="result-row"><span class="result-label">Overhead & profit (' + data.markup_percentage + '%)</span><span class="result-value">$' + data.overhead_profit.toLocaleString() + '</span></div>' +
            '<div class="result-row"><span class="result-label" style="font-weight:700;color:var(--text)">Total bid</span><span class="result-value result-primary" style="font-size:1.125rem">$' + data.total.toLocaleString() + '</span></div>' +
            '</div>';
        resultsEl.innerHTML = rows;

    } catch (err) {
        resultsEl.innerHTML = '<p style="color:#f87171;font-size:0.8125rem">API unavailable. Make sure the Python endpoint is running.</p>';
    }
}

// ─── Schedule Builder ─────────────────────────────────────────────────────────

async function buildProjectSchedule() {
    var resultsEl = document.getElementById('sched-results');
    resultsEl.innerHTML = '<p style="color:var(--text-secondary);font-size:0.8125rem">Building schedule via Python engine...</p>';

    var name = document.getElementById('sched-name').value.trim() || 'Project';
    var start = document.getElementById('sched-start').value;
    var duration = parseInt(document.getElementById('sched-duration').value) || 30;
    var phasesInput = document.getElementById('sched-phases').value.trim();

    try {
        var res = await fetch('/api/python/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                project_name: name,
                start_date: start || null,
                duration_days: duration,
                phases: phasesInput || '',
            }),
        });
        var data = await res.json();
        if (data.error) { resultsEl.innerHTML = '<p style="color:#f87171">' + data.error + '</p>'; return; }

        var html = '<div class="result-section-title">' + data.project_name + ' — ' + data.duration + ' days</div>';
        html += '<table class="sched-table"><thead><tr><th>Phase</th><th>Start</th><th>End</th><th>Days</th></tr></thead><tbody>';
        data.phases.forEach(function(p) {
            html += '<tr><td>' + p.phase + '</td><td>' + p.start + '</td><td>' + p.end + '</td><td>' + p.days + '</td></tr>';
        });
        html += '</tbody></table>';
        resultsEl.innerHTML = html;

    } catch (err) {
        resultsEl.innerHTML = '<p style="color:#f87171;font-size:0.8125rem">API unavailable. Make sure the Python endpoint is running.</p>';
    }
}

// Set today as default start date
(function setSchedDefaultDate() {
    var el = document.getElementById('sched-start');
    if (el) el.value = new Date().toISOString().slice(0, 10);
})();

// ─── Proposal Generator ───────────────────────────────────────────────────────

var _proposalHTML = '';

async function generateProposal() {
    var resultsEl = document.getElementById('prop-results');
    resultsEl.innerHTML = '<p style="color:var(--text-secondary);font-size:0.8125rem">Generating proposal via Python engine...</p>';
    document.getElementById('prop-download-btn').disabled = true;

    var payload = {
        client: document.getElementById('prop-client').value,
        scope: document.getElementById('prop-scope').value,
        total: parseFloat(document.getElementById('prop-total').value) || 0,
        duration: parseInt(document.getElementById('prop-duration').value) || null,
        assumptions: document.getElementById('prop-assumptions').value,
        exclusions: document.getElementById('prop-exclusions').value,
    };

    try {
        var res = await fetch('/api/python/proposal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        var data = await res.json();
        if (data.error) { resultsEl.innerHTML = '<p style="color:#f87171">' + data.error + '</p>'; return; }

        _proposalHTML = data.html;

        // Show preview in iframe
        var preview = document.getElementById('prop-preview');
        var iframe = document.getElementById('prop-iframe');
        preview.style.display = 'block';
        iframe.srcdoc = '<html><body style="margin:0;font-family:Georgia,serif;">' + data.html + '</body></html>';

        resultsEl.innerHTML =
            '<div class="result-row"><span class="result-label">Status</span><span class="result-value result-ok">Generated</span></div>' +
            '<div class="result-row"><span class="result-label">Client</span><span class="result-value">' + (payload.client || '—') + '</span></div>' +
            '<div class="result-row"><span class="result-label">Total</span><span class="result-value result-primary">$' + (payload.total || 0).toLocaleString() + '</span></div>' +
            '<p class="result-note ok" style="margin-top:12px">Preview shown below. Click Download PDF to save.</p>';
        document.getElementById('prop-download-btn').disabled = false;

    } catch (err) {
        resultsEl.innerHTML = '<p style="color:#f87171;font-size:0.8125rem">API unavailable. Make sure the Python endpoint is running.</p>';
    }
}

function downloadProposalPDF() {
    if (!_proposalHTML) return;
    var iframe = document.getElementById('prop-iframe');
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
    }
}

// ─── Hash routing on load and change ─────────────────────────────────────────
window.addEventListener('hashchange', showPanelFromHash);
window.addEventListener('DOMContentLoaded', function() {
    // Defer so layout is ready before panel swap.
    setTimeout(showPanelFromHash, 0);
    setTimeout(showPanelFromHash, 100);
});
window.addEventListener('load', showPanelFromHash);
window.addEventListener('pageshow', showPanelFromHash);

// Init data-dependent UI (must run after ucUnits and pipeData are defined)
updateUCUnits();
buildPipeTable();
