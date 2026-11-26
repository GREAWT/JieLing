import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface PathInputProps {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  className?: string;
}

/**
 * 浏览器不允许网页直接启动资源管理器，也不会把原生绝对路径交给网页。
 * 输入框本身支持 Ctrl+V；右侧只保留一个“复制当前路径”按钮，避免重复入口。
 */
export function PathInput({
  id,
  value,
  onValueChange,
  placeholder,
  hint,
  className,
}: PathInputProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(value.trim());
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
      toast.success("路径已复制");
    } catch {
      toast.error("无法写入剪贴板，请手动选中路径复制。");
    }
  };

  return (
    <div className="grid gap-1.5" data-path-input={id}>
      <div className="relative">
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          className={cn("dc-path pr-10", className)}
          onChange={(event) => onValueChange(event.target.value)}
        />
        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void copyPath()}
            disabled={!value.trim()}
            aria-label={copied ? "路径已复制" : "复制路径"}
            title={copied ? "路径已复制" : "复制当前路径"}
            className="dc-press grid size-7 place-content-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40"
          >
            {copied ? <Check aria-hidden className="size-4 text-primary" /> : <Copy aria-hidden className="size-4" />}
          </button>
        </div>
      </div>
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}
