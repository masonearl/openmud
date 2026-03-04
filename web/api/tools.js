/**
 * Construction tools API - runs estimating tools (material, labor, equipment, full estimate).
 * Used by chat when in Agent mode. Web version uses JS; desktop uses local Python.
 */
const MATERIAL_PRICING = {
  pipe: { '4_inch': 8.5, '6_inch': 12, '8_inch': 18 },
  concrete: { '3000_psi': 166, '4000_psi': 180 },
  rebar: { '4_rebar': 1.25, '5_rebar': 1.75 },
};
const LABOR_RATES = { operator: 85, laborer: 35, foreman: 55, electrician: 65, ironworker: 55 };
const EQUIPMENT_RATES = { excavator: 400, auger: 450, compactor: 100 };

function calculateMaterialCost(materialType, quantity, size) {
  const type = (materialType || '').toLowerCase();
  if (type === 'pipe') {
    const key = size ? `${size}_inch` : '8_inch';
    const unitCost = MATERIAL_PRICING.pipe[key] || MATERIAL_PRICING.pipe['8_inch'];
    const total = quantity * unitCost;
    return { material: `${size || 8}-inch pipe`, quantity, unit: 'linear feet', unit_cost: unitCost, total_cost: Math.round(total * 100) / 100, waste_factor: '10%', total_with_waste: Math.round(total * 1.1 * 100) / 100 };
  }
  if (type === 'concrete') {
    const psi = size || '3000_psi';
    const unitCost = MATERIAL_PRICING.concrete[psi] || MATERIAL_PRICING.concrete['3000_psi'];
    const total = quantity * unitCost;
    return { material: `Concrete ${psi.replace('_', ' ')}`, quantity, unit: 'cubic yards', unit_cost: unitCost, total_cost: Math.round(total * 100) / 100, waste_factor: '10%', total_with_waste: Math.round(total * 1.1 * 100) / 100 };
  }
  if (type === 'rebar') {
    const key = size ? `${size}_rebar` : '4_rebar';
    const unitCost = MATERIAL_PRICING.rebar[key] || MATERIAL_PRICING.rebar['4_rebar'];
    const total = quantity * unitCost;
    return { material: `Rebar #${size || 4}`, quantity, unit: 'linear feet', unit_cost: unitCost, total_cost: Math.round(total * 100) / 100, waste_factor: '10%', total_with_waste: Math.round(total * 1.1 * 100) / 100 };
  }
  return { error: `Material type '${materialType}' not found` };
}

function calculateLaborCost(laborType, hours) {
  const rate = LABOR_RATES[(laborType || '').toLowerCase()];
  if (!rate) return { error: `Labor type '${laborType}' not found` };
  return { labor_type: laborType, hours, hourly_rate: rate, total_cost: Math.round(hours * rate * 100) / 100 };
}

function calculateEquipmentCost(equipmentType, days) {
  const rate = EQUIPMENT_RATES[(equipmentType || '').toLowerCase()];
  if (!rate) return { error: `Equipment type '${equipmentType}' not found` };
  return { equipment: equipmentType, days, daily_rate: rate, total_cost: Math.round(days * rate * 100) / 100 };
}

function estimateProjectCost(materials, labor, equipment, markup = 0.15) {
  let materialTotal = 0, laborTotal = 0, equipmentTotal = 0;
  const materialBreakdown = [];
  (materials || []).forEach((m) => {
    const r = calculateMaterialCost(m.type, m.quantity, m.size);
    if (r.total_with_waste != null) {
      materialTotal += r.total_with_waste;
      materialBreakdown.push(r);
    }
  });
  const laborBreakdown = [];
  (labor || []).forEach((l) => {
    const r = calculateLaborCost(l.type, l.hours);
    if (r.total_cost != null) {
      laborTotal += r.total_cost;
      laborBreakdown.push(r);
    }
  });
  const equipmentBreakdown = [];
  (equipment || []).forEach((e) => {
    const r = calculateEquipmentCost(e.type, e.days);
    if (r.total_cost != null) {
      equipmentTotal += r.total_cost;
      equipmentBreakdown.push(r);
    }
  });
  const subtotal = materialTotal + laborTotal + equipmentTotal;
  const overheadProfit = subtotal * markup;
  const total = subtotal + overheadProfit;
  return {
    materials: { breakdown: materialBreakdown, subtotal: Math.round(materialTotal * 100) / 100 },
    labor: { breakdown: laborBreakdown, subtotal: Math.round(laborTotal * 100) / 100 },
    equipment: { breakdown: equipmentBreakdown, subtotal: Math.round(equipmentTotal * 100) / 100 },
    subtotal: Math.round(subtotal * 100) / 100,
    overhead_profit: Math.round(overheadProfit * 100) / 100,
    markup_percentage: markup * 100,
    total: Math.round(total * 100) / 100,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { tool, params = {} } = req.body || {};
    if (!tool) return res.status(400).json({ error: 'tool required' });

    let result;
    if (tool === 'calculate_material_cost') {
      result = calculateMaterialCost(params.material_type, params.quantity, params.size);
    } else if (tool === 'calculate_labor_cost') {
      result = calculateLaborCost(params.labor_type, params.hours);
    } else if (tool === 'calculate_equipment_cost') {
      result = calculateEquipmentCost(params.equipment_type, params.days);
    } else if (tool === 'estimate_project_cost') {
      result = estimateProjectCost(params.materials, params.labor, params.equipment, params.markup);
    } else {
      return res.status(400).json({ error: 'Unknown tool: ' + tool });
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error('Tools error:', err);
    return res.status(500).json({ error: err.message || 'Tool execution failed' });
  }
};
