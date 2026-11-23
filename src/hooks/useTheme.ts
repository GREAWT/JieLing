import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "dareclean.theme";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // 隐私模式下 localStorage 不可用，退回默认深空档
  }
  return "dark";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("dark", theme === "dark");
    el.dataset.theme = theme;
    el.style.colorScheme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // 忽略写入失败，主题仍在本次会话生效
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#05080f" : "#eaeff7");
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return { theme, setTheme, toggle };
}