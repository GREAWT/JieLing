import type { DiagnosisReport } from "../core/types";

export interface UninstallGuidance {
  hasOfficialUninstaller: boolean;
  uninstallString: string | null;
  steps: string[];
  preferOfficial: boolean;
  warning: string | null;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// cmd 元字符一旦出现在卸载命令里，执行语义就不再是「跑一个卸载器」
const CMD_METACHARS = /[&|<>`]/;
const PLAUSIBLE_UNINSTALLER = /^("[A-Za-z]:\\[^"]*"|[A-Za-z]:\\\S+|MsiExec(?:\.exe)?\s+\/[IX]\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\})/i;

function isPlausibleUninstallString(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return false;
  if (CONTROL_CHARS.test(trimmed) || CMD_METACHARS.test(trimmed)) return false;
  return PLAUSIBLE_UNINSTALLER.test(trimmed);
}

export function resolveUninstallGuidance(report: DiagnosisReport): UninstallGuidance {
  const requested = report.officialUninstaller;
  const localEntry = requested
    ? report.evidence.find((entry) => entry.kind === "uninstaller" && entry.uninstallString === requested)
    : undefined;
  const raw = localEntry?.uninstallString ?? null;
  const hasDriver = report.evidence.some((entry) => entry.kind === "service" && entry.driver === true);
  const driverWarning = hasDriver
    ? "检测到驱动级保护：卸载可能要求重启或进入安全模式，切勿手工停止/删除 .sys 驱动文件。"
    : null;

  if (requested && !localEntry) {
    return {
      hasOfficialUninstaller: false,
      uninstallString: null,
      preferOfficial: false,
      steps: [
        "AI 或外部内容提供的卸载入口未匹配本次本地证据，已禁止作为可执行卸载命令展示。",
        "请重新运行只读诊断脚本，或在「设置 → 应用 → 已安装的应用」中人工核对官方卸载入口。",
        "确认本地证据后再生成处方；不要直接复制来源不明的卸载路径。",
      ],
      warning: "卸载入口未通过本地证据绑定校验。",
    };
  }

  if (raw && isPlausibleUninstallString(raw)) {
    return {
      hasOfficialUninstaller: true,
      uninstallString: raw,
      preferOfficial: true,
      steps: [
        "先退出该软件的托盘图标和后台进程，占用会导致卸载不干净。",
        `运行官方卸载器：${raw}（可按 Win+R 粘贴运行，或在安装目录里找到 uninstall.exe 双击）。`,
        "按卸载向导完成流程；如提示重启，请先重启再继续。",
        "重新运行只读诊断脚本，确认服务、计划任务、启动项、外壳扩展都已消失——先断源头。",
        "确认不再复活后，把残留目录移入隔离区观察几天，而不是直接删除。",
      ],
      warning: driverWarning,
    };
  }

  if (raw) {
    return {
      hasOfficialUninstaller: false,
      uninstallString: null,
      preferOfficial: false,
      steps: [
        "注册表里有卸载命令，但格式异常，不要直接复制执行。",
        "打开软件安装目录，人工寻找 uninstall.exe / uninst.exe 等官方卸载器并核对数字签名。",
        "或在「设置 → 应用 → 已安装的应用」里找到该软件，点击卸载。",
        "卸载完成后重新运行只读诊断脚本复扫，确认源头已断，再隔离残留文件。",
      ],
      warning: `卸载命令「${raw}」未通过格式校验（可能含命令拼接或非常规启动方式），请人工核对后再运行。${driverWarning ?? ""}`.trim(),
    };
  }

  return {
    hasOfficialUninstaller: false,
    uninstallString: null,
    preferOfficial: false,
    steps: [
      "先到软件自身的设置或官网寻找专用卸载/清理工具，这是最干净的路径。",
      "在「设置 → 应用 → 已安装的应用」里尝试卸载；列表里没有说明卸载器缺失。",
      "确无卸载器时，使用逐项勾选的清理脚本先断源头（服务/计划任务/启动项/外壳扩展），脚本默认 dry-run，先看再做。",
      "手工改注册表是兜底下策：只处理脚本列出的单个项，执行前脚本会自动备份。",
      "复扫确认不再复活后，再把残留目录移入隔离区观察，而不是直接删除。",
    ],
    warning: `未找到官方卸载器，只删文件可能留下重建来源或卸载残留。${driverWarning ?? "手工清理注册表属于兜底手段，务必逐项确认并保留备份。"}`,
  };
}