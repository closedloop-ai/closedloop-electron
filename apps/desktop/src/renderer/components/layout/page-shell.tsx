import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@closedloop-ai/design-system/components/ui/card";
import type { ReactNode } from "react";

export const DASHBOARD_METRIC_CARD_CLASS_NAME =
  "min-h-0 gap-0 rounded-xl border-border/70 bg-card shadow-sm [&>div:first-child]:px-5 [&>div:first-child]:pt-4 [&>div:first-child]:pb-2 [&_[data-slot='card-description']]:text-[10px] [&_[data-slot='card-title']]:text-[1.75rem] [&>div:last-child]:px-5 [&>div:last-child]:pb-4 [&>div:last-child]:text-xs";

export const DASHBOARD_GRID_CLASS_NAME =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4";

export const DASHBOARD_WIDE_GRID_CLASS_NAME =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6";

export const DASHBOARD_TABLE_CLASS_NAME =
  "w-full border-separate border-spacing-0 text-sm";

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function PageShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 p-6">
      <section className="space-y-1">
        <h1 className="text-[1.75rem] font-semibold tracking-tight text-[var(--foreground)]">
          {title}
        </h1>
        <p className="text-sm text-[var(--muted-foreground)]">{description}</p>
      </section>
      {children}
    </div>
  );
}

export function DashboardCard({
  title,
  description,
  children,
  className,
  contentClassName,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cx("rounded-[1.25rem] border-border/80 bg-card/96 shadow-sm", className)}>
      {title ? (
        <CardHeader className="border-b border-border/70 px-5 py-4">
          <CardTitle className="text-xl font-semibold tracking-tight">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cx("p-5", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-[var(--muted-foreground)]">Loading {label}...</p>
    </div>
  );
}
