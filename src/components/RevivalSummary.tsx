import { Stethoscope, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REVIVAL_LABEL, rebuildMechanisms } from "@/src/core/constants";
import type { OwnerGroup } from "@/src/core/types";

export interface RevivalSummaryProps {
  groups: OwnerGroup[];
  onDiagnose: (group: OwnerGroup) => void;
}

export function RevivalSummary({ groups, onDiagnose }: RevivalSummaryProps) {
  if (groups.length === 0) return null;
  return (
    <div className="dc-panel dc-rail dc-tone-review flex flex-wrap items-start gap-3 rounded-xl px-4 py-3">
      <TriangleAlert aria-hidden className="dc-tone-text mt-0.5 size-4 shrink-0" />
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="dc-display text-sm font-semibold tracking-wide">{groups.length} 个软件存在删后重建风险</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {groups.slice(0, 3).map((g) => `${g.owner}（${rebuildMechanisms(g.revival).map((m) => REVIVAL_LABEL[m] ?? m).join("、")}）`).join("；")}。请先用只读诊断核对来源，再决定清理。
        </p>
      </div>
      <Button size="sm" variant="outline" className="dc-tone-review dc-tone-text" onClick={() => onDiagnose(groups[0])}>
        <Stethoscope aria-hidden />去顽固软件诊断
      </Button>
    </div>
  );
}
