import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  DecisionTableVerificationMissingDiagnostics,
  DecisionTableVerificationRecordDiagnostics,
  TelemetryEmitter,
} from "./telemetry-protocol.js";

export const DECISION_TABLE_VERIFICATION_RELATIVE_PATH = path.join(
  ".closedloop-ai",
  "decision-table-verifications.jsonl",
);

const TIMESTAMP_PRECISION_TOLERANCE_MS = 1_000;

const decisionTableVerificationSchema = z.object({
  timestamp: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  workdir: z.string(),
  decision_table_path: z.string(),
  final_status: z.enum([
    "aligned",
    "aligned_with_clarifications",
    "verification_failed",
  ]),
  iterations: z.number().int().nonnegative(),
  drift_kind_counts: z.object({
    code_drift: z.number().int().nonnegative(),
    test_drift: z.number().int().nonnegative(),
    plan_ambiguity: z.number().int().nonnegative(),
  }),
  fixes_attempted: z.number().int().nonnegative(),
  parse_failures: z.number().int().nonnegative(),
  verifier_invocations: z.number().int().nonnegative(),
  phase_duration_ms: z.number().int().nonnegative(),
});

type RawDecisionTableVerification = z.infer<
  typeof decisionTableVerificationSchema
>;

export type DecisionTableVerificationScanResult = {
  filePath: string;
  filePresent: boolean;
  linesRead: number;
  invalidLines: number;
  records: DecisionTableVerificationRecordDiagnostics[];
  missing?: DecisionTableVerificationMissingDiagnostics;
};

export type DecisionTableVerificationEmissionSummary = {
  filePath: string;
  emittedRecords: number;
  emittedMissing: boolean;
  linesRead: number;
  invalidLines: number;
  missingReason?: DecisionTableVerificationMissingDiagnostics["missingReason"];
};

/**
 * Read Phase 5.5 verifier JSONL from a ClosedLoop workdir and return only
 * records that belong to the current EXECUTE process window.
 */
export function scanDecisionTableVerificationTelemetry(
  closedLoopWorkDir: string,
  options: { sinceMs?: number } = {},
): DecisionTableVerificationScanResult {
  const filePath = path.join(
    closedLoopWorkDir,
    DECISION_TABLE_VERIFICATION_RELATIVE_PATH,
  );
  const sinceMs =
    options.sinceMs !== undefined
      ? options.sinceMs - TIMESTAMP_PRECISION_TOLERANCE_MS
      : undefined;
  const sinceIso =
    options.sinceMs !== undefined
      ? new Date(options.sinceMs).toISOString()
      : undefined;

  if (!existsSync(filePath)) {
    return {
      filePath,
      filePresent: false,
      linesRead: 0,
      invalidLines: 0,
      records: [],
      missing: {
        telemetryStatus: "missing",
        telemetryFilePath: filePath,
        filePresent: false,
        linesRead: 0,
        invalidLines: 0,
        missingReason: "file_not_found",
        ...(sinceIso ? { sinceIso } : {}),
      },
    };
  }

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    return {
      filePath,
      filePresent: true,
      linesRead: 0,
      invalidLines: 0,
      records: [],
      missing: {
        telemetryStatus: "missing",
        telemetryFilePath: filePath,
        filePresent: true,
        linesRead: 0,
        invalidLines: 0,
        missingReason: "read_error",
        readError: err instanceof Error ? err.message : String(err),
        ...(sinceIso ? { sinceIso } : {}),
      },
    };
  }

  const records: DecisionTableVerificationRecordDiagnostics[] = [];
  let linesRead = 0;
  let invalidLines = 0;

  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    linesRead += 1;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(line);
    } catch {
      invalidLines += 1;
      continue;
    }

    const parsed = decisionTableVerificationSchema.safeParse(parsedJson);
    if (!parsed.success) {
      invalidLines += 1;
      continue;
    }

    const recordTimestampMs = Date.parse(parsed.data.timestamp);
    if (sinceMs !== undefined && recordTimestampMs < sinceMs) {
      continue;
    }

    records.push(toTelemetryRecord(parsed.data, filePath, index + 1));
  }

  const missingReason =
    linesRead === 0 ? "empty" : records.length === 0 ? "no_current_run_records" : null;

  return {
    filePath,
    filePresent: true,
    linesRead,
    invalidLines,
    records,
    ...(missingReason
      ? {
          missing: {
            telemetryStatus: "missing",
            telemetryFilePath: filePath,
            filePresent: true,
            linesRead,
            invalidLines,
            missingReason,
            ...(sinceIso ? { sinceIso } : {}),
          },
        }
      : {}),
  };
}

/**
 * Emit Datadog-bound telemetry for the decision-table verifier JSONL generated
 * by the just-finished EXECUTE command.
 */
export function emitDecisionTableVerificationTelemetry(args: {
  telemetry: TelemetryEmitter;
  commandId?: string;
  operationId?: string;
  loopId: string;
  closedLoopWorkDir: string;
  sinceMs?: number;
}): DecisionTableVerificationEmissionSummary {
  const scan = scanDecisionTableVerificationTelemetry(args.closedLoopWorkDir, {
    sinceMs: args.sinceMs,
  });

  for (const record of scan.records) {
    args.telemetry.emit({
      severity: record.finalStatus === "verification_failed" ? "warn" : "info",
      category: "job.decision_table_verification",
      message: `Decision-table verification ${record.finalStatus}`,
      trace: {
        commandId: args.commandId,
        operationId: args.operationId,
        loopId: args.loopId,
        jobId: args.loopId,
      },
      diagnostics: { decisionTableVerification: record },
    });
  }

  if (scan.records.length === 0 && scan.missing) {
    emitMissingTelemetry(args, scan.missing);
  }

  return {
    filePath: scan.filePath,
    emittedRecords: scan.records.length,
    emittedMissing: scan.records.length === 0 && scan.missing !== undefined,
    linesRead: scan.linesRead,
    invalidLines: scan.invalidLines,
    ...(scan.missing ? { missingReason: scan.missing.missingReason } : {}),
  };
}

function emitMissingTelemetry(
  args: {
    telemetry: TelemetryEmitter;
    commandId?: string;
    operationId?: string;
    loopId: string;
  },
  diagnostic: DecisionTableVerificationMissingDiagnostics,
): void {
  args.telemetry.emit({
    severity: "info",
    category: "job.decision_table_verification",
    message: `Decision-table verification telemetry ${diagnostic.missingReason}`,
    trace: {
      commandId: args.commandId,
      operationId: args.operationId,
      loopId: args.loopId,
      jobId: args.loopId,
    },
    diagnostics: { decisionTableVerification: diagnostic },
  });
}

function toTelemetryRecord(
  record: RawDecisionTableVerification,
  filePath: string,
  lineNumber: number,
): DecisionTableVerificationRecordDiagnostics {
  return {
    telemetryStatus: "reported",
    telemetryFilePath: filePath,
    lineNumber,
    timestamp: record.timestamp,
    workdir: record.workdir,
    decisionTablePath: record.decision_table_path,
    finalStatus: record.final_status,
    iterations: record.iterations,
    driftKindCounts: {
      codeDrift: record.drift_kind_counts.code_drift,
      testDrift: record.drift_kind_counts.test_drift,
      planAmbiguity: record.drift_kind_counts.plan_ambiguity,
    },
    fixesAttempted: record.fixes_attempted,
    parseFailures: record.parse_failures,
    verifierInvocations: record.verifier_invocations,
    phaseDurationMs: record.phase_duration_ms,
  };
}
