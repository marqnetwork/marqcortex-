/**
 * CORTEX CORE — DEPENDENCY ENGINE (dependency_engine_v1)
 *
 * ROI Dependency Validation Spec — roi-dependency-spec.md
 *
 * Enforces:
 *   §1 — Dependency Model (requires / enables / enhances)
 *   §2 — Overlap Protection (gain_category deduplication)
 *   §3 — Enforcement Logic (topological sort + gain validation)
 *   §4 — Double Counting Prevention Algorithm (claimed_gain_registry)
 *   §5 — Cross-Recommendation Revenue Lock (one attribution per causal chain)
 *   §6 — Portfolio Gain = SUM(validated gains) — never sum before cleanup
 *   §7 — Circular Dependency Detection
 *   §8 — Visual Transparency (dependency chain, removed categories, reasons)
 *   §9 — Edge Case: flag if overlap removal drops ROI below confidence floor
 *
 * Math decides priority. No inflation stacking. Deterministic validation.
 */

import type {
  RecommendationV2,
  RecommendationROI,
  CrossDependency,
  DependencyValidationResult,
  DepartmentKey,
} from './types';

// ════════════════════════════════════════════════════════════════════════════════
// AUTO-DERIVE GAIN CATEGORIES
// ════════════════════════════════════════════════════════════════════════════════
// If a recommendation doesn't declare gain_categories, derive from impact_type + department

function deriveGainCategories(rec: RecommendationV2): string[] {
  if (rec.gain_categories && rec.gain_categories.length > 0) {
    return rec.gain_categories;
  }

  const dept = rec.core_problem.problem_id;
  const types = rec.impact_profile.impact_type;
  const categories: string[] = [];

  for (const t of types) {
    categories.push(`${t}_${dept}`);
  }

  return categories;
}

// ════════════════════════════════════════════════════════════════════════════════
// §1 — BUILD DEPENDENCY GRAPH
// ════════════════════════════════════════════════════════════════════════════════

interface DepEdge {
  parent: string;
  child: string;
  type: 'requires' | 'enables' | 'enhances';
}

function buildDependencyGraph(
  recs: RecommendationV2[],
  crossDeps: CrossDependency[],
): DepEdge[] {
  const edges: DepEdge[] = [];
  const recIds = new Set(recs.map(r => r.recommendation_id));

  // From recommendation.depends_on declarations
  for (const rec of recs) {
    if (rec.depends_on && rec.depends_on.length > 0) {
      for (const parentId of rec.depends_on) {
        if (recIds.has(parentId)) {
          edges.push({
            parent: parentId,
            child: rec.recommendation_id,
            type: rec.dependency_type ?? 'enhances',
          });
        }
      }
    }
  }

  // From cross_dependencies (map to dependency types)
  for (const dep of crossDeps) {
    if (recIds.has(dep.source_recommendation_id) && recIds.has(dep.target_recommendation_id)) {
      // Avoid duplicates
      const exists = edges.some(
        e => e.parent === dep.source_recommendation_id && e.child === dep.target_recommendation_id,
      );
      if (!exists) {
        const type: DepEdge['type'] =
          dep.dependency_type === 'required_before' ? 'requires'
          : dep.dependency_type === 'enhances' ? 'enhances'
          : 'enhances'; // reduces-risk → treat as enhances for gain validation
        edges.push({
          parent: dep.source_recommendation_id,
          child: dep.target_recommendation_id,
          type,
        });
      }
    }
  }

  return edges;
}

// ════════════════════════════════════════════════════════════════════════════════
// §7 — CIRCULAR DEPENDENCY DETECTION + TOPOLOGICAL SORT
// ════════════════════════════════════════════════════════════════════════════════

function topologicalSort(
  recIds: string[],
  edges: DepEdge[],
): { order: string[]; isCircular: boolean } {
  // Kahn's algorithm
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of recIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const edge of edges) {
    adj.get(edge.parent)?.push(edge.child);
    inDegree.set(edge.child, (inDegree.get(edge.child) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const child of adj.get(node) ?? []) {
      const newDeg = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  return {
    order,
    isCircular: order.length !== recIds.length,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// §3 — GET DEPENDENCY CHAIN (ancestors) for a recommendation
// ════════════════════════════════════════════════════════════════════════════════

function getDependencyChain(
  recId: string,
  edges: DepEdge[],
  visited: Set<string> = new Set(),
): string[] {
  if (visited.has(recId)) return [];
  visited.add(recId);

  const parents = edges.filter(e => e.child === recId).map(e => e.parent);
  const chain: string[] = [];
  for (const p of parents) {
    chain.push(...getDependencyChain(p, edges, visited), p);
  }
  return chain;
}

// ════════════════════════════════════════════════════════════════════════════════
// §5 — REVENUE LOCK: Find which rec in a causal chain owns revenue
// ════════════════════════════════════════════════════════════════════════════════

function findRevenueOwner(
  recId: string,
  rec: RecommendationV2,
  edges: DepEdge[],
  recsById: Map<string, RecommendationV2>,
): string | null {
  // Revenue is attributed to the recommendation directly tied to the KPI change
  const hasRevenueImpact = rec.impact_profile.impact_type.includes('revenue_growth');
  if (!hasRevenueImpact) return null;

  // Check if any parent in the chain also claims revenue
  const chain = getDependencyChain(recId, edges);
  for (const parentId of chain) {
    const parent = recsById.get(parentId);
    if (parent?.impact_profile.impact_type.includes('revenue_growth')) {
      // Parent already claims revenue — this child should NOT double-claim
      // unless dependency_type is 'enhances'
      const edge = edges.find(e => e.parent === parentId && e.child === recId);
      if (edge && edge.type !== 'enhances') {
        return parentId; // parent owns revenue
      }
    }
  }

  return recId; // this rec owns its own revenue
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: validateDependencies
// ════════════════════════════════════════════════════════════════════════════════
// Runs the full dependency validation pass on recommendations + their ROIs.
// Returns the validation result AND mutates the ROIs in-place with
// dependency_validation transparency data.

export function validateDependencies(
  recs: RecommendationV2[],
  rois: RecommendationROI[],
  crossDeps: CrossDependency[],
  confidenceFloor: number,
): DependencyValidationResult {
  const recIds = recs.map(r => r.recommendation_id);
  const recsById = new Map(recs.map(r => [r.recommendation_id, r]));
  const roisById = new Map(rois.map(r => [r.recommendation_id, r]));

  // §1 — Build dependency graph
  const edges = buildDependencyGraph(recs, crossDeps);

  // §7 — Circular dependency detection + topological sort
  const { order: topoOrder, isCircular } = topologicalSort(recIds, edges);

  if (isCircular) {
    return {
      status: 'invalid_dependency_graph',
      error: 'circular_dependency_detected',
      topological_order: [],
      claimed_gain_registry: {},
      overlap_removals: [],
      warnings: ['Circular dependency detected — ROI blocked for all recommendations in cycle.'],
    };
  }

  // §4 — Double Counting Prevention Algorithm
  // Initialize claimed_gain_registry
  const claimedRegistry: Record<string, string> = {}; // gain_category → rec_id that owns it
  const overlapRemovals: DependencyValidationResult['overlap_removals'] = [];
  const warnings: string[] = [];

  // Process in topological order (parent first, child after)
  for (const recId of topoOrder) {
    const rec = recsById.get(recId);
    const roi = roisById.get(recId);
    if (!rec || !roi) continue;

    const declaredCategories = deriveGainCategories(rec);
    const removedCategories: string[] = [];
    const removalReasons: string[] = [];
    const validatedCategories: string[] = [];
    const chain = getDependencyChain(recId, edges);

    // Get edges where this rec is the child
    const parentEdges = edges.filter(e => e.child === recId);

    // §3 — Enforcement Logic per dependency type
    for (const edge of parentEdges) {
      const parentRoi = roisById.get(edge.parent);
      const parentRec = recsById.get(edge.parent);

      // Case A — requires: parent must be included
      if (edge.type === 'requires') {
        if (!parentRoi || !parentRoi.is_roi_eligible) {
          roi.is_roi_eligible = false;
          roi.roi_locked_reason = `Required parent ${edge.parent} not included or not eligible`;
          roi.display.gain_90d = 'Not Calculable';
          roi.display.gain_12mo = 'Not Calculable';
          roi.display.adjusted_roi_label = 'Blocked';
          roi.display.assumptions.push(`§3A: ROI blocked — parent ${edge.parent} required but not eligible`);
        }
      }

      // Case B — enables: child revenue valid only if parent efficiency active
      if (edge.type === 'enables') {
        const parentHasEfficiency = parentRec?.impact_profile.impact_type.includes('efficiency')
          || parentRec?.impact_profile.impact_type.includes('cost_reduction');
        if (!parentHasEfficiency || !parentRoi?.is_roi_eligible) {
          // Zero out child's revenue gain
          if (roi.impact_calculations.revenue_impact) {
            const lostGain = roi.impact_calculations.revenue_impact.projected_gain;
            roi.impact_calculations.total_projected_gain = Math.max(
              0, roi.impact_calculations.total_projected_gain - lostGain,
            );
            roi.impact_calculations.revenue_impact = undefined;
            removalReasons.push(`§3B: Revenue gain zeroed — parent ${edge.parent} efficiency not active`);

            // Find and remove revenue categories
            for (const cat of declaredCategories) {
              if (cat.startsWith('revenue_growth')) {
                removedCategories.push(cat);
              }
            }
          }
        }
      }

      // Case C — enhances: remove overlapping gain categories
      if (edge.type === 'enhances' && parentRec) {
        const parentCategories = deriveGainCategories(parentRec);
        for (const cat of declaredCategories) {
          if (parentCategories.includes(cat) && !removedCategories.includes(cat)) {
            removedCategories.push(cat);
            removalReasons.push(`§3C: Category '${cat}' overlaps with parent ${edge.parent} — removed from child`);
          }
        }
      }
    }

    // §4 — Claimed gain registry: no stacking
    for (const cat of declaredCategories) {
      if (removedCategories.includes(cat)) continue;

      if (claimedRegistry[cat]) {
        // Category already claimed by another recommendation
        const existingOwner = claimedRegistry[cat];
        const edge = parentEdges.find(e => e.parent === existingOwner);
        if (edge?.type === 'enhances') {
          // Enhances relationship allows shared categories — skip removal
          validatedCategories.push(cat);
        } else {
          removedCategories.push(cat);
          removalReasons.push(
            `§4: Gain category '${cat}' already claimed by ${existingOwner} — removed to prevent double counting`,
          );
          overlapRemovals.push({
            recommendation_id: recId,
            removed_category: cat,
            reason: `Already claimed by ${existingOwner}`,
          });
        }
      } else {
        claimedRegistry[cat] = recId;
        validatedCategories.push(cat);
      }
    }

    // §5 — Cross-Recommendation Revenue Lock
    const revenueOwner = findRevenueOwner(recId, rec, edges, recsById);
    if (revenueOwner !== null && revenueOwner !== recId) {
      // Revenue should be attributed to parent, not this rec
      if (roi.impact_calculations.revenue_impact) {
        const lostGain = roi.impact_calculations.revenue_impact.projected_gain;
        roi.impact_calculations.total_projected_gain = Math.max(
          0, roi.impact_calculations.total_projected_gain - lostGain,
        );
        roi.impact_calculations.revenue_impact = undefined;
        removalReasons.push(`§5: Revenue attribution locked to ${revenueOwner} in causal chain`);

        for (const cat of declaredCategories) {
          if (cat.startsWith('revenue_growth') && !removedCategories.includes(cat)) {
            removedCategories.push(cat);
          }
        }
      }
    }

    // Apply gain reduction to range
    if (removedCategories.length > 0 && roi.is_roi_eligible) {
      // Estimate proportion of gain removed
      const totalCategories = declaredCategories.length || 1;
      const remainingRatio = Math.max(0, (totalCategories - removedCategories.length) / totalCategories);

      roi.roi_range.low_case.gain = Math.round(roi.roi_range.low_case.gain * remainingRatio);
      roi.roi_range.mid_case.gain = Math.round(roi.roi_range.mid_case.gain * remainingRatio);
      roi.roi_range.high_case.gain = Math.round(roi.roi_range.high_case.gain * remainingRatio);

      // Recalc ROI percents
      const inv = roi.inputs.investment_cost;
      if (inv > 0) {
        roi.roi_range.low_case.roi_percent = Math.round((roi.roi_range.low_case.gain - inv) / inv * 100);
        roi.roi_range.mid_case.roi_percent = Math.round((roi.roi_range.mid_case.gain - inv) / inv * 100);
        roi.roi_range.high_case.roi_percent = Math.round((roi.roi_range.high_case.gain - inv) / inv * 100);
        roi.adjusted_roi_percent = roi.roi_range.mid_case.roi_percent;
      }

      // Update display
      roi.display.gain_12mo = `$${Math.round(roi.roi_range.mid_case.gain / 1000)}K`;
      roi.display.gain_90d = `$${Math.round(roi.roi_range.mid_case.gain * 0.25 / 1000)}K`;
      roi.display.adjusted_roi_label = `${roi.adjusted_roi_percent}%`;
    }

    // §9 — Edge Case: flag if overlap removal drops ROI below confidence floor
    if (removedCategories.length > 0 && roi.is_roi_eligible) {
      if (roi.inputs.confidence_score < confidenceFloor) {
        warnings.push(
          `roi_reduced_due_to_overlap_validation: ${recId} ROI reduced by dependency cleanup and confidence (${roi.inputs.confidence_score}) is below floor (${confidenceFloor})`,
        );
      }
    }

    // §8 — Store transparency on the ROI record
    roi.dependency_validation = {
      dependency_chain: chain,
      gain_categories_declared: declaredCategories,
      gain_categories_removed: removedCategories,
      gain_categories_validated: validatedCategories,
      removal_reasons: removalReasons,
      warnings: removedCategories.length > 0
        ? [`${removedCategories.length} gain categories removed due to dependency overlap`]
        : [],
    };

    // Add to display assumptions
    if (removedCategories.length > 0) {
      roi.display.assumptions.push(
        `Dependency validation: ${removedCategories.length} overlapping gain categories removed`,
      );
      for (const reason of removalReasons) {
        roi.display.assumptions.push(reason);
      }
    }
    if (chain.length > 0) {
      roi.display.assumptions.push(`Dependency chain: ${[...chain, recId].join(' → ')}`);
    }
  }

  return {
    status: 'valid',
    topological_order: topoOrder,
    claimed_gain_registry: claimedRegistry,
    overlap_removals: overlapRemovals,
    warnings,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORT: getExecutionOrder
// ════════════════════════════════════════════════════════════════════════════════
// Returns topologically sorted execution order, or null if circular.

export function getExecutionOrder(
  recs: RecommendationV2[],
  crossDeps: CrossDependency[],
): string[] | null {
  const edges = buildDependencyGraph(recs, crossDeps);
  const { order, isCircular } = topologicalSort(
    recs.map(r => r.recommendation_id),
    edges,
  );
  return isCircular ? null : order;
}
