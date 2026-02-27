/* Company directory data and rendering */
'use strict';

var UTAH_COMPANIES = [
    { name: 'Ames Construction', url: 'https://www.amesconstruction.com', hq: 'Burnsville, MN (major Utah ops)', type: ['heavy-civil'], revenue: '$1B+', ownership: 'Private', tags: ['Private'], desc: 'One of the largest heavy civil contractors in Utah and the Mountain West. Major UDOT work, highways, grading, underground utilities. Known for large earthwork and transportation projects.' },
    { name: 'Geneva Rock Products', url: 'https://www.genevarock.com', hq: 'Orem, UT', type: ['heavy-civil', 'underground'], revenue: '$500M–$1B (est.)', ownership: 'Private', tags: ['Private'], desc: 'Vertically integrated aggregate, asphalt, concrete, and heavy civil contractor. UDOT and local agency work throughout Utah. Aggregate supply gives them a cost advantage on paving work.' },
    { name: 'W.W. Clyde & Co.', url: 'https://www.wwclyde.net', hq: 'Springville, UT', type: ['heavy-civil'], revenue: '$300M–$600M (est.)', ownership: 'Private', tags: ['Private'], desc: 'Utah-based heavy civil contractor with deep roots in highway, bridge, and earthwork. One of the original big Utah contractors. UDOT preferred contractor.' },
    { name: 'Wadsworth Brothers Construction', url: 'https://www.wadsworthbrothers.com', hq: 'Draper, UT', type: ['heavy-civil', 'underground'], revenue: '$200M–$400M (est.)', ownership: 'Private', tags: ['Private'], desc: 'Bridges, culverts, underground utilities, and transportation infrastructure. Active on I-15 corridor and Wasatch Front projects.' },
    { name: 'Big-D Construction', url: 'https://www.big-d.com', hq: 'Salt Lake City, UT', type: ['gc'], revenue: '$1B+ (reported 2023)', ownership: 'Private', tags: ['Private'], desc: 'One of Utah\'s largest general contractors. Commercial, industrial, and some civil. Not primarily underground utility but significant presence in Utah construction market.' },
    { name: 'Okland Corp.', url: 'https://www.okland.com', hq: 'Salt Lake City, UT', type: ['gc'], revenue: '$1B+ (reported 2023)', ownership: 'Private', tags: ['Private'], desc: 'Major Utah GC focused on commercial, healthcare, education, and industrial. Not a heavy civil contractor but one of the largest contractors in the state by revenue.' },
    { name: 'Jordan Valley Water', url: 'https://www.jvwc.com', hq: 'West Jordan, UT', type: ['underground'], revenue: 'Public utility', ownership: 'Public utility', tags: ['Public utility'], desc: 'Major water district and utility owner — not a contractor, but the primary customer for underground water work in the Salt Lake Valley. Understanding their standards and bid process is essential.' },
    { name: 'Velocity Inc.', url: '#', hq: 'Salt Lake City, UT', type: ['underground'], revenue: 'Mid-size', ownership: 'Private', tags: ['Private'], desc: 'Underground utility contractor in the Wasatch Front. Waterline, sewer, storm drain. Active in municipal bid market.' },
    { name: 'Staker Parson Companies', url: 'https://www.stakerparson.com', hq: 'Ogden, UT', type: ['heavy-civil'], revenue: '$300M–$500M (est.)', ownership: 'Subsidiary (Oldcastle Infrastructure)', tags: ['Private', 'Corporate subsidiary'], desc: 'Aggregate, asphalt, concrete, and heavy civil. Owned by Oldcastle (CRH plc). Strong in paving, base course, and road construction throughout Utah.' },
    { name: 'Layne Christensen (Granite)', url: 'https://www.graniteconstruction.com', hq: 'Operationally based regionally', type: ['underground', 'heavy-civil'], revenue: 'Part of Granite (GVA)', ownership: 'Public', tags: ['Public', 'NYSE: GVA'], desc: 'Water well drilling, dewatering, and underground utility work. Acquired by Granite Construction. Active in municipal water projects throughout the West.' },
    { name: 'Sundt Construction', url: 'https://www.sundt.com', hq: 'Tempe, AZ (Utah ops)', type: ['gc', 'heavy-civil'], revenue: '$2B+ nationally (reported)', ownership: 'ESOP', tags: ['ESOP', '100% Employee-Owned'], desc: 'One of the largest ESOP contractors in the West. Commercial, industrial, and some civil. Employee-owned since 1990. Active in Utah on commercial and mission critical work.' },
];

var MW_COMPANIES = [
    { name: 'Granite Construction', url: 'https://www.graniteconstruction.com', hq: 'Watsonville, CA', type: ['heavy-civil'], revenue: '$4.3B (2024)', ownership: 'Public', tags: ['Public', 'NYSE: GVA'], desc: 'Major publicly traded heavy civil contractor. Active throughout the Mountain West. UDOT and regional DOT work, highways, bridges, underground. Just won $111M Utah DOT project.' },
    { name: 'Kiewit Corporation', url: 'https://www.kiewit.com', hq: 'Omaha, NE', type: ['heavy-civil', 'underground'], revenue: '$14B+ (2024 est.)', ownership: 'Private / ESOP', tags: ['Private', 'Employee-Owned'], desc: 'One of the largest private contractors in North America. Heavy civil, mining, power, oil & gas, building. Major presence in Mountain West on highway and infrastructure projects.' },
    { name: 'Hensel Phelps', url: 'https://www.henselphelps.com', hq: 'Greeley, CO', type: ['gc'], revenue: '$5B+ (est.)', ownership: 'Private', tags: ['Private', 'Employee-Owned'], desc: 'Large employee-owned general contractor. Commercial, federal, and infrastructure work. Active in Mountain West.' },
    { name: 'Saunders Construction', url: 'https://www.saundersconstruction.com', hq: 'Centennial, CO', type: ['gc'], revenue: '$1.5B+ (est.)', ownership: 'Private', tags: ['Private'], desc: 'Colorado-based GC with active Mountain West operations. Commercial, healthcare, and infrastructure work.' },
    { name: 'Achen-Gardner Construction', url: 'https://www.achengardner.com', hq: 'Maricopa, AZ', type: ['underground', 'heavy-civil'], revenue: '$300M+ (est.)', ownership: 'ESOP', tags: ['ESOP', '100% Employee-Owned'], desc: '100% employee-owned heavy civil and underground contractor. Part of ESS Companies. Water, sewer, storm drain, roadwork throughout the Southwest.' },
    { name: 'ESCO Construction', url: 'https://www.escoconstruction.com', hq: 'Meridian, ID', type: ['underground', 'heavy-civil'], revenue: '$200M+ (est.)', ownership: 'ESOP', tags: ['ESOP', '100% Employee-Owned'], desc: 'Employee-owned heavy civil and underground utility contractor based in Idaho. Part of ESS Companies. Active in Mountain West water and sewer work.' },
    { name: 'Rummel Construction', url: 'https://www.rummelconstruction.com', hq: 'Flagstaff, AZ', type: ['heavy-civil', 'underground'], revenue: '$300M+ (est.)', ownership: 'ESOP', tags: ['ESOP', '100% Employee-Owned'], desc: 'ESOP heavy civil contractor. Roads, utilities, earthwork. Part of ESS Companies. 750+ employee-owners.' },
    { name: 'Emery Sapp & Sons', url: 'https://www.emerysapp.com', hq: 'Columbia, MO', type: ['heavy-civil', 'underground'], revenue: '$500M+ (est.)', ownership: 'ESOP', tags: ['ESOP', '100% Employee-Owned'], desc: 'Parent company of ESS Companies. Turnkey heavy civil contractor. 1,600+ employee-owners. Highways, bridges, underground utilities, earthwork.' },
];

var NATIONAL_COMPANIES = [
    { name: 'Bechtel Group', url: 'https://www.bechtel.com', hq: 'Reston, VA', revenue: '$23.5B (2024 est.)', ownership: 'Private', tags: ['Private'], desc: 'Largest private engineering and construction firm in the world. Infrastructure, nuclear, oil & gas, mining. Major federal and international projects.' },
    { name: 'Turner Construction', url: 'https://www.turnerconstruction.com', hq: 'New York, NY', revenue: '$16B (2024 est.)', ownership: 'Subsidiary (HOCHTIEF)', tags: ['Corporate subsidiary'], desc: 'Leading commercial general contractor. Major buildings, data centers, healthcare. Not heavy civil focus but enormous scale.' },
    { name: 'Fluor Corporation', url: 'https://www.fluor.com', hq: 'Irving, TX', revenue: '$15.6B (2024)', ownership: 'Public', tags: ['Public', 'NYSE: FLR'], desc: 'Publicly traded engineering and construction firm. Industrial, infrastructure, energy, government. Large-scale project focus.' },
    { name: 'Kiewit Corporation', url: 'https://www.kiewit.com', hq: 'Omaha, NE', revenue: '$14B+ (2024 est.)', ownership: 'Private', tags: ['Private', 'Employee-Owned'], desc: 'Top private heavy civil and industrial contractor. Mining, power, water, transportation. ENR consistent top-3 contractor.' },
    { name: 'EMCOR Group', url: 'https://www.emcorgroup.com', hq: 'Norwalk, CT', revenue: '$14.3B (2024)', ownership: 'Public', tags: ['Public', 'NYSE: EME'], desc: 'Mechanical and electrical contractor. Electrical, HVAC, plumbing, fire protection. Strong data center and industrial focus.' },
    { name: 'Jacobs Solutions', url: 'https://www.jacobs.com', hq: 'Dallas, TX', revenue: '$10.7B (2024)', ownership: 'Public', tags: ['Public', 'NYSE: J'], desc: 'Engineering, design, and construction management. Strong in water, transportation, defense, and government infrastructure.' },
    { name: 'Skanska USA', url: 'https://www.skanska.com/en-us/', hq: 'New York, NY', revenue: '$8B+ (US revenue)', ownership: 'Subsidiary (Skanska AB, Sweden)', tags: ['Public parent'], desc: 'Swedish-based multinational. Major US presence in civil infrastructure, tunnels, bridges, and commercial building.' },
    { name: 'Walsh Group', url: 'https://www.walshgroup.com', hq: 'Chicago, IL', revenue: '$7B+ (2024 est.)', ownership: 'Private', tags: ['Private'], desc: 'One of the largest private GCs. Heavy civil, building, design-build. Transportation, water, federal work across the US.' },
    { name: 'Granite Construction', url: 'https://www.graniteconstruction.com', hq: 'Watsonville, CA', revenue: '$4.3B (2024)', ownership: 'Public', tags: ['Public', 'NYSE: GVA'], desc: 'Publicly traded heavy civil contractor. Transportation, tunnels, mining, water. ENR Top 400 consistent top 10.' },
    { name: 'MYR Group', url: 'https://www.myrgroup.com', hq: 'Downers Grove, IL', revenue: '$3.6B (2024)', ownership: 'Public', tags: ['Public', 'NASDAQ: MYRG'], desc: 'Electrical construction and maintenance. Commercial, industrial, transmission & distribution. Strong renewable energy focus.' },
    { name: 'Primoris Services', url: 'https://www.primoriscorp.com', hq: 'Dallas, TX', revenue: '$5.6B (2024)', ownership: 'Public', tags: ['Public', 'NASDAQ: PRIM'], desc: 'Specialty contractor in utilities, pipelines, and civil construction. Strong in underground pipeline and energy infrastructure.' },
    { name: 'Sundt Construction', url: 'https://www.sundt.com', hq: 'Tempe, AZ', revenue: '$2B+ (2024 est.)', ownership: 'ESOP', tags: ['ESOP', '100% Employee-Owned'], desc: '100% employee-owned since 1990. Building, industrial, civil. One of the most recognized ESOP success stories in construction.' },
];

var ESOP_COMPANIES = [
    { name: 'Emery Sapp & Sons (ESS Companies)', url: 'https://www.emerysapp.com', hq: 'Columbia, MO', revenue: '$500M+', ownership: 'ESOP', tags: ['ESOP', '100% Employee-Owned', '1,600+ owners'], desc: 'Flagship ESOP heavy civil contractor. Parent of ESS Companies portfolio. Turnkey heavy civil: highways, bridges, underground utilities, earthwork throughout the US.' },
    { name: 'Achen-Gardner Construction', url: 'https://www.achengardner.com', hq: 'Maricopa, AZ', revenue: '$300M+', ownership: 'ESOP', tags: ['ESOP', '100% Employee-Owned', '350+ owners'], desc: 'Underground utility and heavy civil. Water, sewer, storm drain, roadwork. Part of ESS Companies. Southwest focus.' },
    { name: 'Rummel Construction', url: 'https://www.rummelconstruction.com', hq: 'Flagstaff, AZ', revenue: '$300M+', ownership: 'ESOP', tags: ['ESOP', '100% Employee-Owned', '750+ owners'], desc: 'Heavy civil, roads, utilities, earthwork. Part of ESS Companies. Mountain West and Southwest operations.' },
    { name: 'ESCO Construction', url: 'https://www.escoconstruction.com', hq: 'Meridian, ID', revenue: '$200M+', ownership: 'ESOP', tags: ['ESOP', '100% Employee-Owned', '175+ owners', 'Founded 1944'], desc: 'Underground utility and heavy civil contractor. Water, sewer, storm, earthwork. Part of ESS Companies. Mountain West.' },
    { name: 'Monks Construction', url: 'https://www.monksconstruction.com', hq: 'Colorado Springs, CO', revenue: '$100M+', ownership: 'ESOP', tags: ['ESOP', '100% Employee-Owned', '150+ owners', 'Founded 1958'], desc: 'Colorado-based heavy civil. Roads, underground utilities, earthwork. Part of ESS Companies. Western region focus.' },
    { name: 'Kiewit Corporation', url: 'https://www.kiewit.com', hq: 'Omaha, NE', revenue: '$14B+', ownership: 'Private/ESOP', tags: ['Employee-Owned'], desc: 'One of the largest contractors in North America, employee-owned. Not a traditional ESOP structure but employee ownership is core to the company model.' },
    { name: 'Sundt Construction', url: 'https://www.sundt.com', hq: 'Tempe, AZ', revenue: '$2B+', ownership: 'ESOP', tags: ['ESOP', '100% Employee-Owned', 'Since 1990'], desc: 'ESOP since 1990. One of the longest-running and most successful ESOP contractors. Building, industrial, civil. Active in the West.' },
    { name: 'Hensel Phelps', url: 'https://www.henselphelps.com', hq: 'Greeley, CO', revenue: '$5B+', ownership: 'Employee-Owned', tags: ['Employee-Owned'], desc: 'Large employee-owned GC. Federal, commercial, infrastructure. One of the largest employee-owned contractors in the US.' },
    { name: 'MegaKC', url: 'https://www.megakc.com', hq: 'Kansas City, MO', revenue: '$40M+', ownership: 'ESOP', tags: ['ESOP', '100% Employee-Owned', 'Since 2018', '85 owners'], desc: 'Smaller ESOP contractor showing the model works at all scales. Heavy civil and underground utility. $40M+ annual projects.' },
];

var PUBLIC_COMPANIES = [
    { name: 'Granite Construction (GVA)', url: 'https://www.graniteconstruction.com', hq: 'Watsonville, CA', revenue: '$4.3B (2024)', ownership: 'Public', tags: ['NYSE: GVA', 'Heavy civil'], desc: 'Pure-play publicly traded heavy civil contractor. Transportation, tunnels, mining, water. Best proxy for heavy civil industry financials.' },
    { name: 'EMCOR Group (EME)', url: 'https://www.emcorgroup.com', hq: 'Norwalk, CT', revenue: '$14.3B (2024)', ownership: 'Public', tags: ['NYSE: EME', 'Mechanical & Electrical'], desc: 'Mechanical and electrical specialty contractor. Strong data center, industrial, and healthcare focus. S&P 500 company.' },
    { name: 'MYR Group (MYRG)', url: 'https://www.myrgroup.com', hq: 'Downers Grove, IL', revenue: '$3.6B (2024)', ownership: 'Public', tags: ['NASDAQ: MYRG', 'Electrical'], desc: 'Electrical construction for commercial, industrial, and T&D. Strong renewable energy and EV infrastructure exposure.' },
    { name: 'Primoris Services (PRIM)', url: 'https://www.primoriscorp.com', hq: 'Dallas, TX', revenue: '$5.6B (2024)', ownership: 'Public', tags: ['NASDAQ: PRIM', 'Underground & Pipeline'], desc: 'Underground pipeline, utility, and civil contractor. Good proxy for underground utility industry trends.' },
    { name: 'Tutor Perini (TPC)', url: 'https://www.tutorperini.com', hq: 'Sylmar, CA', revenue: '$4.5B (2024)', ownership: 'Public', tags: ['NYSE: TPC', 'Civil & Building'], desc: 'Civil, building, and specialty construction. Tunnels, transit, airports. Large transit project exposure.' },
    { name: 'Jacobs Solutions (J)', url: 'https://www.jacobs.com', hq: 'Dallas, TX', revenue: '$10.7B (2024)', ownership: 'Public', tags: ['NYSE: J', 'Engineering & CM'], desc: 'Engineering, design, and CM. Water, transportation, defense. More engineering than construction but significant project management work.' },
    { name: 'Fluor (FLR)', url: 'https://www.fluor.com', hq: 'Irving, TX', revenue: '$15.6B (2024)', ownership: 'Public', tags: ['NYSE: FLR', 'Industrial & Infrastructure'], desc: 'Large-scale industrial and infrastructure EPC contractor. Oil & gas, government, infrastructure. International focus.' },
];

var UNDERGROUND_COMPANIES = [
    { name: 'Primoris Services (PRIM)', url: 'https://www.primoriscorp.com', hq: 'Dallas, TX', revenue: '$5.6B (2024)', ownership: 'Public', tags: ['Public', 'NASDAQ: PRIM', 'Pipeline & utilities'], desc: 'One of the largest underground pipeline and utility contractors in the US. Gas distribution, water, electrical distribution. Publicly traded, great for benchmarking.' },
    { name: 'Achen-Gardner Construction', url: 'https://www.achengardner.com', hq: 'Maricopa, AZ', revenue: '$300M+', ownership: 'ESOP', tags: ['ESOP', 'Southwest'], desc: 'Water, sewer, and storm drain specialist. 350+ employee-owners. One of the best underground utility contractors in the Southwest.' },
    { name: 'ESCO Construction', url: 'https://www.escoconstruction.com', hq: 'Meridian, ID', revenue: '$200M+', ownership: 'ESOP', tags: ['ESOP', 'Mountain West'], desc: 'Underground utility and heavy civil. Founded 1944. Water, sewer, storm, earthwork in the Mountain West.' },
    { name: 'Premier Underground Construction', url: 'https://www.youtube.com/channel/UCfTxKG43eo2gSqObNLjW_Ng', hq: 'Regional', revenue: 'N/A', ownership: 'Private', tags: ['Private', 'YouTube'], desc: 'Well-known on YouTube for authentic underground utility construction footage. Good to follow for real field operations.' },
    { name: 'MYR Group — Harlan Electric', url: 'https://www.myrgroup.com', hq: 'Multiple', revenue: 'Part of MYR ($3.6B)', ownership: 'Public', tags: ['Public', 'Electrical distribution'], desc: 'Electrical distribution underground. Part of MYR Group. Good for understanding the electrical underground side of utility work.' },
    { name: 'Geneva Rock Products', url: 'https://www.genevarock.com', hq: 'Orem, UT', revenue: '$500M–$1B (est.)', ownership: 'Private', tags: ['Private', 'Utah'], desc: 'Vertically integrated Utah contractor with significant underground utility work alongside aggregate and paving operations.' },
    { name: 'Wadsworth Brothers', url: 'https://www.wadsworthbrothers.com', hq: 'Draper, UT', revenue: '$200M–$400M (est.)', ownership: 'Private', tags: ['Private', 'Utah'], desc: 'Utah-based with strong underground utility and transportation infrastructure capabilities.' },
];

function renderCards(containerId, data) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = data.map(function(co) {
        return '<div class="company-card" data-type="' + (co.type || []).join(' ') + '">' +
            '<div class="company-name">' + (co.url && co.url !== '#' ? '<a href="' + co.url + '" target="_blank" rel="noopener">' + co.name + ' ↗</a>' : co.name) + '</div>' +
            '<div class="company-location">' + co.hq + '</div>' +
            '<div class="company-meta">' +
            co.tags.map(function(t) {
                var cls = 'company-tag';
                if (t.includes('ESOP') || t.includes('Employee')) cls += ' tag-esop';
                else if (t.includes('NYSE') || t.includes('NASDAQ') || t === 'Public') cls += ' tag-public';
                else if (t.includes('PE') || t.includes('equity')) cls += ' tag-pe';
                return '<span class="' + cls + '">' + t + '</span>';
            }).join('') +
            '</div>' +
            '<div class="company-revenue">' + co.revenue + '</div>' +
            '<div class="company-desc">' + co.desc + '</div>' +
            '</div>';
    }).join('');
}

function filterCompanies(gridId, type, btn) {
    document.querySelectorAll('.co-filter').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    document.querySelectorAll('#' + gridId + '-grid .company-card').forEach(function(card) {
        card.style.display = (type === 'all' || card.dataset.type.includes(type)) ? '' : 'none';
    });
}

// Render all grids
renderCards('utah-grid', UTAH_COMPANIES);
renderCards('mw-grid', MW_COMPANIES);
renderCards('national-grid', NATIONAL_COMPANIES);
renderCards('esop-grid', ESOP_COMPANIES);
renderCards('public-grid', PUBLIC_COMPANIES);
renderCards('underground-grid', UNDERGROUND_COMPANIES);
