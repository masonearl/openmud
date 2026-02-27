/* Resources & Companies page navigation */
'use strict';

(function initNav() {
    document.querySelectorAll('.res-nav-link').forEach(function(link) {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            showSection(this.dataset.section);
        });
    });
    var hash = window.location.hash.replace('#', '');
    if (hash && document.getElementById('section-' + hash)) {
        showSection(hash);
    }
})();

function showSection(id) {
    document.querySelectorAll('.res-section').forEach(function(s) { s.classList.remove('active'); });
    document.querySelectorAll('.res-nav-link').forEach(function(l) { l.classList.remove('active'); });
    var section = document.getElementById('section-' + id);
    var link = document.querySelector('[data-section="' + id + '"]');
    if (section) { section.classList.add('active'); }
    if (link) { link.classList.add('active'); }
    // Sync mobile select
    var sel = document.querySelector('.res-mobile-select');
    if (sel) sel.value = id;
    var main = document.querySelector('.res-main');
    if (main) main.scrollTop = 0;
    window.location.hash = id;
}

/* Glossary */
var GLOSSARY = [
    { term: '811', def: 'The national "call before you dig" number. Required before any excavation. Connects to your regional one-call center (Blue Stakes in Utah).' },
    { term: 'AASHTO', def: 'American Association of State Highway and Transportation Officials. Sets standards for highway design and construction materials.' },
    { term: 'Angle of repose', def: 'The steepest angle at which loose material (soil, gravel) will remain stable without slipping. Critical for spoil pile placement and trench sloping.' },
    { term: 'APWA', def: 'American Public Works Association. Sets utility color codes and other public works standards.' },
    { term: 'As-builts', def: 'Drawings that reflect the actual constructed conditions, including field changes made during construction. Required for record on most public projects.' },
    { term: 'AWWA', def: 'American Water Works Association. Sets standards for water pipe, fittings, and water system design (C900, C151, etc.).' },
    { term: 'Backfill', def: 'Material used to refill a trench or excavation after pipe or structure installation. Usually compacted in lifts.' },
    { term: 'BCY', def: 'Bank Cubic Yards — soil volume measured in its natural, undisturbed state. The baseline for earthwork calculations.' },
    { term: 'Bedding', def: 'Granular material placed below and around a pipe to provide uniform support and protect the pipe from point loads.' },
    { term: 'Blue stakes', def: 'Utah\'s 811 one-call utility locating program. Call or go online at bluestakes.org at least 3 business days before digging.' },
    { term: 'Bore', def: 'Horizontal directional drilling (HDD) or jack-and-bore method to install pipe under roads, rivers, or structures without open cutting.' },
    { term: 'Butt fusion', def: 'Method of joining HDPE pipe by heating both ends and pressing them together. Creates a joint as strong as the pipe itself.' },
    { term: 'CCY', def: 'Compacted Cubic Yards — soil volume after compaction. Typically 10–20% less than BCY due to void reduction.' },
    { term: 'Change order', def: 'A written document that modifies the original contract scope, price, or schedule. All changes should be documented before work is performed.' },
    { term: 'CIP', def: 'Cast Iron Pipe. Older water distribution pipe material, mostly replaced by DIP or PVC in modern construction.' },
    { term: 'CMP', def: 'Corrugated Metal Pipe. Common for culverts and storm drain. High Manning\'s n (0.024). Subject to corrosion in acidic soils.' },
    { term: 'Competent person', def: 'OSHA-defined: someone capable of identifying existing and predictable hazards in excavations. Must be present during all excavation work.' },
    { term: 'Compaction', def: 'Mechanical densification of soil to reduce voids and increase strength. Typically measured as percent of Standard Proctor (ASTM D698) max dry density.' },
    { term: 'Confined space', def: 'A space large enough to bodily enter, not designed for continuous occupancy, and with limited entry/exit. Manholes and vaults are typical examples in underground utility work.' },
    { term: 'D/B', def: 'Design-Build. A project delivery method where one entity provides both design and construction services under a single contract.' },
    { term: 'Dewatering', def: 'Removal of groundwater from an excavation to maintain stable working conditions. Methods include well points, eductor wells, and sump pumping.' },
    { term: 'DIP', def: 'Ductile Iron Pipe. High-strength pipe used for water and sewer under pressure. Push-on or mechanical joints; restrained joints required at fittings.' },
    { term: 'DR', def: 'Dimension Ratio (or Standard Dimension Ratio — SDR). Pipe OD divided by wall thickness. Lower DR = thicker wall = higher pressure rating.' },
    { term: 'EPR', def: 'Electronic Positive Response. The system utility owners use to confirm they\'ve responded to your 811 locate request. Check before digging.' },
    { term: 'ESOP', def: 'Employee Stock Ownership Plan. A qualified retirement plan that holds company stock for employees, making them beneficial owners of the company.' },
    { term: 'Force main', def: 'A pressurized sewer pipe that carries sewage using pump pressure, as opposed to gravity flow. Used when terrain doesn\'t allow gravity drainage.' },
    { term: 'GVW', def: 'Gross Vehicle Weight. The total weight of a loaded vehicle. Relevant for haul truck load calculations and road restrictions.' },
    { term: 'Haunching', def: 'Bedding material placed at the sides of a pipe from the bedding to the springline (centerline). Critical for rigid pipe support.' },
    { term: 'HDD', def: 'Horizontal Directional Drilling. Trenchless method to install pipe, conduit, or cable by drilling horizontally underground. Used for road crossings and stream crossings.' },
    { term: 'HDPE', def: 'High-Density Polyethylene pipe. Flexible, fully restrained joints via fusion. Excellent for directional drill, force mains, and rough soil conditions.' },
    { term: 'HMA', def: 'Hot Mix Asphalt. Standard asphalt pavement material. Density ~145 lb/CF, placed hot and compacted.' },
    { term: 'IIJA', def: 'Infrastructure Investment and Jobs Act (2021). $1.2 trillion federal infrastructure bill. $55B for water, $110B for roads/bridges, $65B for broadband.' },
    { term: 'Infiltration', def: 'Groundwater entering a sewer system through pipe joints, cracks, or manholes. Increases treatment costs and can overwhelm systems.' },
    { term: 'Inflow', def: 'Stormwater entering a sanitary sewer through illicit connections, open manholes, or direct connections. Distinct from infiltration.' },
    { term: 'Invert', def: 'The lowest interior point of a pipe or channel. Invert elevations control flow direction and slope in gravity systems.' },
    { term: 'Jack-and-bore', def: 'Trenchless installation method using a casing pipe jacked through soil while the bore head is steered. Used for steel casing under roads.' },
    { term: 'LCY', def: 'Loose Cubic Yards — soil volume after excavation, before compaction. Typically 10–40% more than BCY due to swell.' },
    { term: 'LEL', def: 'Lower Explosive Limit. The minimum concentration of gas that can ignite. OSHA requires atmosphere below 10% LEL for worker entry into confined spaces.' },
    { term: 'Lift', def: 'A single layer of compacted fill material. Typical lift thickness: 6"–12" depending on compactor type and spec.' },
    { term: 'Manning\'s n', def: 'Roughness coefficient used in Manning\'s equation to calculate open-channel and pipe flow. Lower n = smoother pipe = more flow.' },
    { term: 'Manhole', def: 'A structure providing access to underground utilities. Typically precast concrete. Consider as a confined space — always test atmosphere before entry.' },
    { term: 'Mechanical joint', def: 'A type of pipe joint using a gland, bolts, and gasket. Used on DIP. Can be restrained or unrestrained.' },
    { term: 'MEP', def: 'Mechanical, Electrical, Plumbing. The building systems trades. Sometimes used broadly to refer to any underground utilities.' },
    { term: 'NTP', def: 'Notice to Proceed. The owner\'s written authorization for the contractor to begin work. The contract clock starts here.' },
    { term: 'O&P', def: 'Overhead and Profit. The markup added to direct costs on change orders and estimates. Industry standard: 10–20% combined.' },
    { term: 'Pay app', def: 'Payment Application. The monthly invoice submitted by the contractor to the owner for work completed. Based on schedule of values.' },
    { term: 'PCF', def: 'Pounds per cubic foot. Standard unit for soil density. Standard Proctor max dry densities typically 100–135 PCF.' },
    { term: 'PEL', def: 'Permissible Exposure Limit. OSHA\'s maximum allowable concentration of an airborne contaminant over an 8-hour workday.' },
    { term: 'Potholing', def: 'Hand-excavating or vacuum-excavating to expose underground utilities and verify location before mechanical excavation.' },
    { term: 'Prevailing wage', def: 'Minimum wage rates set by government for workers on public projects. Varies by trade, region, and project type. Required on most federal and many state contracts.' },
    { term: 'PSI', def: 'Pounds per square inch. Unit of pressure. Used for pipe pressure ratings, test pressures, and soil bearing capacity (when expressed as PSF: lb/sq ft).' },
    { term: 'PVC', def: 'Polyvinyl Chloride pipe. Most common water and sewer pipe material. C900 for pressure water, SDR 35 for gravity sewer.' },
    { term: 'RCP', def: 'Reinforced Concrete Pipe. Standard for storm drain and culverts. Gravity only. Classified by D-load strength (ASTM C76).' },
    { term: 'RFI', def: 'Request for Information. A formal document asking the engineer/owner to clarify plans or specs. Document everything.' },
    { term: 'ROW', def: 'Right of Way. The legal corridor within which a contractor is authorized to work. Typically includes the road and adjacent easement.' },
    { term: 'Schedule of values', def: 'A breakdown of the contract price by work item. Used as the basis for monthly pay applications.' },
    { term: 'Shoring', def: 'A system of supports (hydraulic or timber) used to prevent trench wall collapse. Alternative to sloping or benching.' },
    { term: 'Springline', def: 'The point at the widest diameter of a circular pipe (the "equator"). Haunch zone extends from bedding to springline.' },
    { term: 'Spoil', def: 'Excavated material removed from a trench or excavation. Must be placed minimum 2 ft from trench edge per OSHA.' },
    { term: 'Submittal', def: 'Product data, shop drawings, or material samples submitted to the engineer for review and approval before installation.' },
    { term: 'Subgrade', def: 'The prepared natural soil surface on which pavement, fill, or structure is placed. Must be tested and approved before covering.' },
    { term: 'Swell', def: 'Volume increase of soil when excavated from its natural state. Sandy soils: 10–15%. Clay: 25–35%. Rock: 30–50%.' },
    { term: 'T&M', def: 'Time and Materials. A change order or contract method where payment is based on actual labor, equipment, and material costs plus markup.' },
    { term: 'Thrust block', def: 'Concrete structure placed against a pipe fitting to resist hydraulic thrust forces. Required at bends, tees, and dead ends.' },
    { term: 'Tolerance zone', def: 'The area within 24 inches of each side of a utility locate mark. Hand excavation only within the tolerance zone.' },
    { term: 'Trench box', def: 'A steel or aluminum shielding system dropped into a trench to protect workers. Can be used in all soil types.' },
    { term: 'Trenching', def: 'Excavation that is deeper than it is wide (at the bottom). Regulated by OSHA 29 CFR 1926 Subpart P.' },
    { term: 'TSF', def: 'Tons per square foot. Unit for soil bearing capacity and unconfined compressive strength used in OSHA soil classification.' },
    { term: 'Unconfined compressive strength', def: 'The load at which a soil sample fails under compression. Used to classify soil type per OSHA (Type A ≥1.5 tsf, Type B 0.5–1.5 tsf, Type C <0.5 tsf).' },
    { term: 'Void', def: 'An empty space underground — can be a utility corridor, a collapsed pipe, or natural void. Potholing finds them.' },
    { term: 'VCP', def: 'Vitrified Clay Pipe. Common in older sewer systems. Chemically inert and durable, but brittle and difficult to cut.' },
    { term: 'Water table', def: 'The level below ground at which the soil is saturated with water. Trenching into the water table requires dewatering.' },
    { term: 'Work zone', def: 'The area of a construction project that affects traffic. Regulated by MUTCD. Requires traffic control plan on most public projects.' },
];

function buildGlossary() {
    var grid = document.getElementById('glossary-grid');
    if (!grid) return;
    grid.innerHTML = GLOSSARY.map(function(g) {
        return '<div class="glossary-entry" data-term="' + g.term.toLowerCase() + '">' +
            '<div class="glossary-term">' + g.term + '</div>' +
            '<div class="glossary-def">' + g.def + '</div>' +
            '</div>';
    }).join('');
}

function filterGlossary() {
    var q = document.getElementById('glossary-search').value.toLowerCase();
    document.querySelectorAll('.glossary-entry').forEach(function(el) {
        var match = !q || el.dataset.term.includes(q) || el.querySelector('.glossary-def').textContent.toLowerCase().includes(q);
        el.style.display = match ? '' : 'none';
    });
}

buildGlossary();
