import type {
  QuoteClientInput,
  QuoteEngineData,
  QuoteResult,
  QuoteRecommendation,
  ExcludedProduct,
  QEProduct,
  QECarrier,
  QEBenefitType,
  ApprovalFitLabel,
  RecommendationLabel,
  ProductScore,
} from "./quoteEngineTypes";

export function runQuoteEngine(input: QuoteClientInput, data: QuoteEngineData): QuoteResult {
  const warnings: string[] = [];
  const excluded: ExcludedProduct[] = [];
  const eligible: QuoteRecommendation[] = [];

  if (data.products.length === 0) {
    warnings.push("No products loaded. Recommendation quality limited by missing verified carrier data.");
    return emptyResult(warnings);
  }

  if (data.rateTables.length === 0) {
    warnings.push("No rate data loaded. Recommendation quality limited by missing verified carrier data.");
  }

  // Check sufficient health input
  const hasHealthData = input.conditions.length > 0 || input.medications.length > 0;

  const activeProducts = data.products.filter(p => p.is_active);
  const activeCarriers = new Map(data.carriers.filter(c => c.is_active).map(c => [c.id, c]));

  for (const product of activeProducts) {
    const carrier = activeCarriers.get(product.carrier_id);
    if (!carrier) {
      excluded.push({ carrier: { id: product.carrier_id, name: "Unknown", logo_url: null, is_active: false }, product, exclusionReason: "Carrier not active", ruleTriggered: "carrier_active", sourceVersion: null });
      continue;
    }

    // Gate 1: Hard Eligibility
    const gate1 = checkGate1(input, product, data);
    if (gate1.excluded) {
      excluded.push({ carrier, product, exclusionReason: gate1.reason!, ruleTriggered: gate1.rule!, sourceVersion: null });
      continue;
    }

    // Gate 2: Underwriting Fit
    const gate2 = checkGate2(input, product, data);
    let benefitType: QEBenefitType = 'immediate';
    if (gate2.excluded) {
      excluded.push({ carrier, product, exclusionReason: gate2.reason!, ruleTriggered: gate2.rule!, sourceVersion: null });
      continue;
    }
    if (gate2.routeTo) {
      benefitType = gate2.routeTo;
    }

    // Gate 3: Rate Lookup
    const rate = findRate(input, product, data);
    const rateFound = rate !== null;
    let monthlyPremium = rate?.monthly_premium ?? null;
    let faceAmount = input.faceAmount;

    if (input.solveMode === 'premium' && faceAmount && !rateFound) {
      monthlyPremium = null; // Can't solve without rate data
    }
    if (input.solveMode === 'face_amount' && input.premium && !rateFound) {
      faceAmount = null;
    }

    const needsVerification = product.needs_verification || (rate?.needs_verification ?? true);

    // Gate 4: Scoring
    const scores = calculateScores(input, product, carrier, data, benefitType, monthlyPremium, rateFound);

    // Payment options
    const payMethods = data.paymentMethods.filter(pm => pm.product_id === product.id && pm.is_supported).map(pm => pm.method);
    const badges = data.badges.filter(b => b.product_id === product.id);

    // Determine labels
    const approvalFitLabel = getApprovalFitLabel(scores.approvalScore, benefitType);
    const commissionValue = calculateCommission(monthlyPremium, product, data);

    const advantages: string[] = [];
    const risks: string[] = [];

    if (benefitType === 'immediate') advantages.push("Immediate full benefit coverage");
    if (benefitType === 'graded') { advantages.push("Available despite health concerns"); risks.push("Graded benefit period applies"); }
    if (benefitType === 'guaranteed_issue') { advantages.push("No health questions required"); risks.push("Higher premium, graded benefits"); }
    if (rateFound) advantages.push("Verified rate available");
    if (!rateFound) risks.push("Rate needs carrier-source verification");
    if (needsVerification) risks.push("Product data needs verification");
    if (payMethods.includes('ss_billing')) advantages.push("Social Security billing supported");

    const rec: QuoteRecommendation = {
      rank: 0,
      carrier,
      product,
      monthlyPremium,
      faceAmount: faceAmount ?? null,
      benefitType,
      approvalFitLabel,
      recommendationLabel: 'Strong Backup', // Will be set after ranking
      scores,
      reasonSummary: buildReasonSummary(carrier, product, benefitType, scores, rateFound),
      advantages,
      risks,
      whyNotFirst: null,
      commissionValue,
      firstYearPct: getFirstYearPct(product, data),
      paymentOptions: payMethods,
      badges,
      needsVerification,
      rateFound,
    };

    eligible.push(rec);
  }

  // Sort by overall score descending
  eligible.sort((a, b) => b.scores.overallScore - a.scores.overallScore);

  // Assign ranks and labels
  eligible.forEach((rec, idx) => {
    rec.rank = idx + 1;
    if (idx === 0) {
      rec.recommendationLabel = 'Recommend First';
      rec.whyNotFirst = null;
    } else if (idx === 1) {
      rec.recommendationLabel = 'Strong Backup';
      rec.whyNotFirst = `Scored ${((eligible[0].scores.overallScore - rec.scores.overallScore) * 100).toFixed(0)}% lower overall than #1`;
    } else if (rec.scores.commissionScore > eligible[0].scores.commissionScore) {
      rec.recommendationLabel = 'Commission Play';
      rec.whyNotFirst = "Higher commission but lower overall fit";
    } else if (rec.scores.premiumScore > eligible[0].scores.premiumScore) {
      rec.recommendationLabel = 'Cheapest Viable';
      rec.whyNotFirst = "Lower premium but weaker approval odds";
    } else if (rec.approvalFitLabel === 'Fallback Only') {
      rec.recommendationLabel = 'Fallback Only';
      rec.whyNotFirst = "Low approval probability";
    } else {
      rec.recommendationLabel = 'Strong Backup';
      rec.whyNotFirst = `Ranked #${idx + 1} by overall score`;
    }
  });

  if (!hasHealthData && eligible.length > 0) {
    warnings.push("More underwriting details required before recommendation. Results shown are based on basic eligibility only.");
  }

  // Categorize
  const bestOverall = eligible[0] ?? null;
  const bestApproval = [...eligible].sort((a, b) => b.scores.approvalScore - a.scores.approvalScore)[0] ?? null;
  const bestCommission = [...eligible].sort((a, b) => b.scores.commissionScore - a.scores.commissionScore)[0] ?? null;
  const lowestPremium = [...eligible].filter(r => r.monthlyPremium !== null).sort((a, b) => (a.monthlyPremium ?? Infinity) - (b.monthlyPremium ?? Infinity))[0] ?? null;
  const immediateOption = eligible.find(r => r.benefitType === 'immediate') ?? null;
  const gradedOption = eligible.find(r => r.benefitType === 'graded' || r.benefitType === 'modified') ?? null;
  const giFallback = eligible.find(r => r.benefitType === 'guaranteed_issue') ?? null;

  const hasVerifiedData = eligible.some(r => !r.needsVerification && r.rateFound);

  return {
    bestOverall,
    bestApproval,
    bestCommission,
    lowestPremium,
    immediateOption,
    gradedOption,
    giFallback,
    allEligible: eligible,
    excluded,
    warnings,
    hasVerifiedData,
  };
}

function emptyResult(warnings: string[]): QuoteResult {
  return {
    bestOverall: null, bestApproval: null, bestCommission: null, lowestPremium: null,
    immediateOption: null, gradedOption: null, giFallback: null,
    allEligible: [], excluded: [], warnings, hasVerifiedData: false,
  };
}

function checkGate1(input: QuoteClientInput, product: QEProduct, data: QuoteEngineData): { excluded: boolean; reason?: string; rule?: string } {
  // Age
  if (input.age < product.min_age || input.age > product.max_age) {
    return { excluded: true, reason: `Age ${input.age} outside range ${product.min_age}-${product.max_age}`, rule: "age_range" };
  }

  // Category
  if (input.categories.length > 0 && !input.categories.includes(product.category)) {
    return { excluded: true, reason: `Category ${product.category} not selected`, rule: "category_filter" };
  }

  // State
  if (input.state) {
    const stateAvail = data.productStates.find(ps => ps.product_id === product.id && ps.state_code === input.state);
    if (stateAvail && !stateAvail.is_available) {
      return { excluded: true, reason: `Not available in ${input.state}`, rule: "state_availability" };
    }
  }

  // Face amount
  if (input.faceAmount !== null) {
    if (input.faceAmount < product.min_face) {
      return { excluded: true, reason: `Face amount $${input.faceAmount} below minimum $${product.min_face}`, rule: "min_face" };
    }
    if (input.faceAmount > product.max_face) {
      return { excluded: true, reason: `Face amount $${input.faceAmount} above maximum $${product.max_face}`, rule: "max_face" };
    }
  }

  // Payment method
  if (input.paymentMethod) {
    const pm = data.paymentMethods.find(p => p.product_id === product.id && p.method === input.paymentMethod);
    if (pm && !pm.is_supported) {
      return { excluded: true, reason: `${input.paymentMethod} not supported`, rule: "payment_method" };
    }
  }

  // Build chart
  if (input.heightFeet > 0 && input.weight > 0) {
    const totalInches = input.heightFeet * 12 + input.heightInches;
    const buildEntries = data.buildCharts.filter(bc => bc.product_id === product.id && (bc.gender === 'unisex' || bc.gender === input.sex) && bc.height_inches === totalInches);
    if (buildEntries.length > 0) {
      const inRange = buildEntries.some(bc => input.weight >= bc.min_weight && input.weight <= bc.max_weight);
      if (!inRange) {
        return { excluded: true, reason: `Build (${totalInches}" / ${input.weight}lbs) outside acceptable range`, rule: "build_chart" };
      }
    }
  }

  return { excluded: false };
}

function checkGate2(input: QuoteClientInput, product: QEProduct, data: QuoteEngineData): { excluded: boolean; reason?: string; rule?: string; routeTo?: QEBenefitType } {
  const knockouts = data.knockouts.filter(k => k.product_id === product.id);
  let routeTo: QEBenefitType | undefined;

  // Check conditions
  for (const cond of input.conditions) {
    const matchingKnockouts = knockouts.filter(k => k.rule_type === 'condition' && k.rule_key.toLowerCase() === cond.name.toLowerCase());
    for (const ko of matchingKnockouts) {
      if (ko.lookback_months && cond.recencyMonths !== undefined && cond.recencyMonths > ko.lookback_months) {
        continue; // Outside lookback period
      }
      if (ko.severity === 'knockout') {
        return { excluded: true, reason: `Condition "${cond.name}" is a knockout`, rule: `knockout_condition:${ko.rule_key}` };
      }
      if (ko.routes_to) {
        routeTo = ko.routes_to;
      }
    }
  }

  // Check medications
  for (const med of input.medications) {
    const matchingKnockouts = knockouts.filter(k => k.rule_type === 'medication' && k.rule_key.toLowerCase() === med.name.toLowerCase());
    for (const ko of matchingKnockouts) {
      if (ko.severity === 'knockout') {
        return { excluded: true, reason: `Medication "${med.name}" is a knockout`, rule: `knockout_medication:${ko.rule_key}` };
      }
      if (ko.routes_to) {
        routeTo = ko.routes_to;
      }
    }
  }

  // Check hard qualifiers
  if (input.dialysis) {
    const dialysisKO = knockouts.find(k => k.rule_key === 'dialysis');
    if (dialysisKO?.severity === 'knockout') return { excluded: true, reason: "Dialysis is a knockout", rule: "knockout_dialysis" };
  }
  if (input.oxygenUse) {
    const o2KO = knockouts.find(k => k.rule_key === 'oxygen_use');
    if (o2KO?.severity === 'knockout') return { excluded: true, reason: "Oxygen use is a knockout", rule: "knockout_oxygen" };
  }
  if (input.nursingHome) {
    const nhKO = knockouts.find(k => k.rule_key === 'nursing_home');
    if (nhKO?.severity === 'knockout') return { excluded: true, reason: "Nursing home/assisted living is a knockout", rule: "knockout_nursing_home" };
  }

  // Check graded routing rules
  const gradedRules = data.gradedRules.filter(gr => gr.product_id === product.id);
  for (const cond of input.conditions) {
    const match = gradedRules.find(gr => gr.condition_key.toLowerCase() === cond.name.toLowerCase());
    if (match) {
      routeTo = match.routes_to;
    }
  }

  return { excluded: false, routeTo };
}

function findRate(input: QuoteClientInput, product: QEProduct, data: QuoteEngineData): QERateRow | null {
  const tobaccoClass = input.tobacco ? 'tobacco' : 'non_tobacco';
  const candidates = data.rateTables.filter(r => {
    if (r.product_id !== product.id) return false;
    if (r.age !== input.age) return false;
    if (r.gender !== 'unisex' && r.gender !== input.sex) return false;
    if (r.tobacco_class !== 'all' && r.tobacco_class !== tobaccoClass) return false;
    if (input.state && r.state_code && r.state_code !== input.state) return false;
    return true;
  });

  if (input.solveMode === 'premium' && input.faceAmount !== null) {
    const exact = candidates.find(r => r.face_amount === input.faceAmount);
    return exact ?? candidates[0] ?? null;
  }

  if (input.solveMode === 'face_amount' && input.premium !== null) {
    // Find closest rate to target premium
    const sorted = candidates.sort((a, b) => Math.abs(a.monthly_premium - input.premium!) - Math.abs(b.monthly_premium - input.premium!));
    return sorted[0] ?? null;
  }

  return candidates[0] ?? null;
}

function calculateScores(
  input: QuoteClientInput, product: QEProduct, carrier: QECarrier,
  data: QuoteEngineData, benefitType: QEBenefitType,
  monthlyPremium: number | null, rateFound: boolean
): ProductScore {
  const weights = data.weights;

  // Approval Score (0-100)
  let approvalScore = 80;
  if (benefitType === 'immediate') approvalScore = 90;
  if (benefitType === 'graded') approvalScore = 70;
  if (benefitType === 'modified') approvalScore = 60;
  if (benefitType === 'guaranteed_issue') approvalScore = 95; // GI always approves
  if (input.conditions.length > 3) approvalScore -= 10;
  if (input.medications.length > 5) approvalScore -= 5;
  if (product.needs_verification) approvalScore -= 10;
  approvalScore = Math.max(0, Math.min(100, approvalScore));

  // Suitability Score
  let suitabilityScore = 70;
  if (benefitType === 'immediate') suitabilityScore = 90;
  if (benefitType === 'guaranteed_issue') suitabilityScore = 40;
  suitabilityScore = Math.max(0, Math.min(100, suitabilityScore));

  // Premium Competitiveness Score
  let premiumScore = 50;
  if (rateFound && monthlyPremium !== null) {
    // Without comparison data, base score on rate existence
    premiumScore = 70;
  }

  // Commission Score
  let commissionScore = 50;
  const comm = data.commissions.find(c => c.product_id === product.id);
  if (comm) {
    commissionScore = Math.min(100, comm.first_year_pct);
  }

  // Placement Score
  let placementScore = 60;
  if (rateFound) placementScore += 20;
  if (!product.needs_verification) placementScore += 10;
  placementScore = Math.min(100, placementScore);

  // Persistency Score
  let persistencyScore = 60;
  if (benefitType === 'immediate') persistencyScore = 75;
  if (benefitType === 'guaranteed_issue') persistencyScore = 40;

  const overallScore =
    weights.approval_weight * approvalScore +
    weights.suitability_weight * suitabilityScore +
    weights.premium_weight * premiumScore +
    weights.commission_weight * commissionScore +
    weights.placement_weight * placementScore +
    weights.persistency_weight * persistencyScore;

  return { approvalScore, suitabilityScore, premiumScore, commissionScore, placementScore, persistencyScore, overallScore };
}

function getApprovalFitLabel(approvalScore: number, benefitType: QEBenefitType): ApprovalFitLabel {
  if (benefitType === 'guaranteed_issue') return 'Fallback Only';
  if (approvalScore >= 85) return 'Strong Fit';
  if (approvalScore >= 70) return 'Good Fit';
  if (approvalScore >= 55) return 'Borderline';
  return 'Not Eligible';
}

function calculateCommission(monthlyPremium: number | null, product: QEProduct, data: QuoteEngineData): number | null {
  if (monthlyPremium === null) return null;
  const comm = data.commissions.find(c => c.product_id === product.id);
  if (!comm) return null;
  const annualPremium = monthlyPremium * 12;
  return Math.round(annualPremium * (comm.first_year_pct / 100) * 100) / 100;
}

function getFirstYearPct(product: QEProduct, data: QuoteEngineData): number | null {
  return data.commissions.find(c => c.product_id === product.id)?.first_year_pct ?? null;
}

function buildReasonSummary(carrier: QECarrier, product: QEProduct, benefitType: QEBenefitType, scores: ProductScore, rateFound: boolean): string {
  const parts: string[] = [];
  parts.push(`${carrier.name} ${product.name}`);
  if (benefitType !== 'immediate') parts.push(`(${benefitType.replace('_', ' ')} benefit)`);
  if (scores.approvalScore >= 85) parts.push("— strong approval odds");
  else if (scores.approvalScore >= 70) parts.push("— good approval odds");
  else parts.push("— borderline approval");
  if (!rateFound) parts.push("• Rate needs verification");
  return parts.join(" ");
}
