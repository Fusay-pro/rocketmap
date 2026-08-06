import type {
  CaseDemandTest,
  CaseQuote,
  FieldValidationError,
  InvestmentCase,
  PublishValidationResult,
} from "@/lib/types/investment-case";

function evidenceTagRequirementError(
  field: "sellPrice" | "targetVolume",
  tag: InvestmentCase["sellPriceTag"],
  sourceNote: string,
  plannedTest: string,
): FieldValidationError | null {
  if (tag === "Quoted" && sourceNote.trim().length === 0) {
    return { field, message: `${field} is tagged Quoted but has no source note` };
  }
  if (tag === "Untested" && plannedTest.trim().length === 0) {
    return { field, message: `${field} is tagged Untested but has no planned test` };
  }
  return null;
}

/** Spec §5 — Publish tier. Draft save has no validation; this is the only gate. */
export function validateForPublish(
  investmentCase: InvestmentCase,
  quotes: CaseQuote[],
  demandTest: CaseDemandTest | null,
): PublishValidationResult {
  const errors: FieldValidationError[] = [];

  // Uniqueness is normally maintained by unsetOtherPrimaryQuotes on write, but
  // that is a read-then-write with no constraint behind it: two concurrent
  // "make primary" calls, or a manual console edit, can leave two rows flagged.
  // Picking whichever happened to sort first would silently publish numbers
  // derived from a quote the founder didn't choose, so refuse instead.
  const primaries = quotes.filter((q) => q.isPrimary);
  if (primaries.length > 1) {
    errors.push({
      field: "quotes",
      message: `${primaries.length} quotes are marked primary (${primaries
        .map((q) => q.supplierName)
        .join(", ")}) — exactly one must be`,
    });
  }

  const primary = primaries[0];
  if (!primary) {
    errors.push({ field: "quotes", message: "No primary quote is set" });
  } else {
    if (primary.fobPerUnit <= 0) errors.push({ field: "quotes.fobPerUnit", message: "Primary quote is missing FOB" });
    if (primary.freightValue < 0) errors.push({ field: "quotes.freightValue", message: "Primary quote is missing freight" });
    if (primary.dutyValue < 0) errors.push({ field: "quotes.dutyValue", message: "Primary quote is missing duty" });
    if (!primary.attachmentFileId) {
      errors.push({ field: "quotes.attachmentFileId", message: "Primary quote has no attached document" });
    }
  }

  const sellPriceError = evidenceTagRequirementError(
    "sellPrice",
    investmentCase.sellPriceTag,
    investmentCase.sellPriceSourceNote,
    investmentCase.sellPricePlannedTest,
  );
  if (sellPriceError) errors.push(sellPriceError);

  const targetVolumeError = evidenceTagRequirementError(
    "targetVolume",
    investmentCase.targetVolumeTag,
    investmentCase.targetVolumeSourceNote,
    investmentCase.targetVolumePlannedTest,
  );
  if (targetVolumeError) errors.push(targetVolumeError);

  const measuredTagUsed =
    investmentCase.sellPriceTag === "Measured" || investmentCase.targetVolumeTag === "Measured";
  if (measuredTagUsed) {
    const hasEvidence =
      Boolean(demandTest?.evidenceFileId) || Boolean(demandTest?.hypothesis?.trim());
    if (!demandTest || !hasEvidence) {
      errors.push({
        field: "demandTest",
        message: "A Measured tag requires a demand test with evidence or a linking hypothesis",
      });
    }
  }

  if (investmentCase.killDemandMetric.trim().length > 0) {
    if (!demandTest) {
      errors.push({ field: "demandTest.metricName", message: "killDemandMetric is set but no demand test exists" });
    } else {
      if (demandTest.metricName !== investmentCase.killDemandMetric) {
        errors.push({
          field: "demandTest.metricName",
          message: "Demand test metricName does not match killDemandMetric",
        });
      }
      if (demandTest.threshold !== investmentCase.killDemandThreshold) {
        errors.push({
          field: "demandTest.threshold",
          message: "Demand test threshold is out of sync with killDemandThreshold",
        });
      }
    }
  }

  if (investmentCase.verdict === "unset") {
    errors.push({ field: "verdict", message: "Founder must set a verdict before publishing" });
  }

  return { valid: errors.length === 0, errors };
}
