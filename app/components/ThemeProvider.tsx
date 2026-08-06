"use client";

import { Theme } from "@radix-ui/themes";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import type { ThemeProviderProps } from "next-themes";
import { type ReactNode } from "react";
import { useIsHydrated } from "@/lib/utils/useIsHydrated";

function RadixThemeAppearance({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const hydrated = useIsHydrated();

  // Avoid hydration mismatch: render a stable "light" appearance during SSR
  // and the first client render, then switch to the resolved theme after mount.
  const appearance = hydrated && resolvedTheme === "dark" ? "dark" : "light";

  return (
    <Theme
      appearance={appearance}
      accentColor="iris"
      grayColor="gray"
      radius="large"
      scaling="100%"
    >
      {children}
    </Theme>
  );
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange={false}
      {...props}
    >
      <RadixThemeAppearance>{children}</RadixThemeAppearance>
    </NextThemesProvider>
  );
}
