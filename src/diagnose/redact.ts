import type { DiagnosisEvidence, DiagnosisEvidenceKind } from "../core/types";

export interface CloudEvidenceItem {
  id: string;
  kind: DiagnosisEvidenceKind;
  subject: string;
}

export interface CloudDiagnosisPayload {
  subject: string;
  symptoms: string;
  evidence: CloudEvidenceItem[];
}

const EVIDENCE_KINDS = new Set<DiagnosisEvidenceKind>([
  "service", "task", "run_key", "shell_namespace", "process",
  "uninstaller", "startup_folder", "target",
]);
const EVIDENCE_ID_RE = /^ev_[A-Za-z0-9_-]{8,90}$/;

export function redactForCloud(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
    .replace(/\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/gi, "<mac>")
    .replace(/\b[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}\b/gi, "<product-key>")
    .replace(/\b(?:sk|pk)-[A-Za-z0-9_-]{16,}\b/g, "<redacted>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer <redacted>")
    .replace(/\b(api[_-]?key|token|secret|password|passwd|client[_-]?secret|access[_-]?key)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=<redacted>")
    .replace(/\b[A-F0-9]{32,}\b/gi, "<redacted>")
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "<redacted>")
    .replace(/\\\\[^\r\n;；，,。]+/g, "<network-path>")
    .replace(/[A-Za-z]:\\[^\r\n;；，,。]+/g, (path) => {
      if (/\\(?:Users|Documents and Settings)\\/i.test(path)) return "<user-path>";
      if (/\\Program Files(?: \(x86\))?\\/i.test(path)) return "<program-files-path>";
      if (/\\AppData\\/i.test(path)) return "<appdata-path>";
      return "<path>";
    })
    .replace(/\/(?:home|Users)\/[^\s;；，,。]+/gi, "<user-path>")
    .replace(/%USERPROFILE%|%HOMEPATH%|\$env:USERPROFILE/gi, "<user-profile>")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function buildCloudDiagnosisPayload(input: {
  subject: string;
  symptoms: string;
  evidence: DiagnosisEvidence[];
}): CloudDiagnosisPayload {
  const seen = new Set<string>();
  const evidence: CloudEvidenceItem[] = [];
  for (const item of input.evidence) {
    if (!EVIDENCE_ID_RE.test(item.id) || !EVIDENCE_KINDS.has(item.kind) || seen.has(item.id)) {
      throw new Error("本地诊断证据清单无效，拒绝上云。");
    }
    seen.add(item.id);
    evidence.push({
      id: item.id,
      kind: item.kind,
      subject: redactForCloud(item.subject).slice(0, 120),
    });
  }
  return {
    subject: redactForCloud(input.subject).slice(0, 200),
    symptoms: redactForCloud(input.symptoms).slice(0, 1200),
    evidence,
  };
}
