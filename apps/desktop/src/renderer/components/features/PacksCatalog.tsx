import { Badge } from "@closedloop-ai/design-system/components/ui/badge";
import { Button } from "@closedloop-ai/design-system/components/ui/button";
import { EmptyState } from "@closedloop-ai/design-system/components/ui/empty-state";
import { Input } from "@closedloop-ai/design-system/components/ui/input";
import {
  Table as DsTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@closedloop-ai/design-system/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@closedloop-ai/design-system/components/ui/tabs";
import {
  ArrowLeft,
  ExternalLink,
  Package,
  RefreshCw,
  Search,
  Star,
  GitFork,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type {
  CatalogEntry,
  InstalledPack,
  InstalledPackDetail,
} from "../../../shared/agent-db-contract";
import { useQueryCache, invalidateCache } from "../../hooks/useQueryCache";
import {
  DASHBOARD_TABLE_CLASS_NAME,
  DashboardCard,
  LoadingState,
  PageShell,
  cx,
} from "../layout/page-shell";
import { CatalogCard } from "./CatalogCard";
import { InstallModal } from "./InstallModal";
import { Sparkline } from "./Sparkline";

type ViewMode = "catalog" | "detail";

interface InstallState {
  open: boolean;
  packId: string;
  harness: string;
  action: "install" | "uninstall";
  runId: number | null;
  command: string | null;
}

const EMPTY_INSTALL: InstallState = {
  open: false,
  packId: "",
  harness: "",
  action: "install",
  runId: null,
  command: null,
};

export function PacksCatalog() {
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("catalog");
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [installModal, setInstallModal] = useState<InstallState>(EMPTY_INSTALL);
  const [refreshing, setRefreshing] = useState(false);

  // -- Data fetching --

  const { data: catalog, loading: catalogLoading } = useQueryCache<CatalogEntry[]>(
    "db:catalog",
    () => window.desktopApi.db.getCatalog(),
    5_000,
    10_000,
  );

  const { data: installedPacks, loading: installedLoading } = useQueryCache<InstalledPack[]>(
    "db:installed-packs",
    () => window.desktopApi.db.getInstalledPacks(),
    5_000,
    10_000,
  );

  const { data: packDetail } = useQueryCache<InstalledPackDetail | null>(
    `db:pack-detail:${selectedPackId}`,
    () => (selectedPackId ? window.desktopApi.db.getPackDetail(selectedPackId) : Promise.resolve(null)),
    5_000,
    10_000,
  );

  // -- Filtering --

  const lowerSearch = search.toLowerCase();

  const filteredCatalog = useMemo(() => {
    if (!catalog) return [];
    if (!lowerSearch) return catalog;
    return catalog.filter(
      (e) =>
        e.displayName.toLowerCase().includes(lowerSearch) ||
        e.description?.toLowerCase().includes(lowerSearch) ||
        e.category?.toLowerCase().includes(lowerSearch) ||
        e.packId.toLowerCase().includes(lowerSearch),
    );
  }, [catalog, lowerSearch]);

  const installedEntries = useMemo(
    () => filteredCatalog.filter((e) => e.installedHarnesses.length > 0),
    [filteredCatalog],
  );

  const discoverEntries = useMemo(
    () => filteredCatalog.filter((e) => e.installedHarnesses.length === 0),
    [filteredCatalog],
  );

  // -- Actions --

  const handleInstall = useCallback(async (packId: string, harness: string) => {
    const key = `${packId}:${harness}`;
    setInstalling((prev) => ({ ...prev, [key]: true }));

    try {
      const entry = catalog?.find((e) => e.packId === packId);
      const command = entry?.installCommands?.[harness] ?? null;
      const { runId } = await window.desktopApi.db.catalogInstall(packId, harness);
      setInstallModal({ open: true, packId, harness, action: "install", runId, command });
    } catch (err) {
      console.error("Install failed:", err);
    } finally {
      setInstalling((prev) => ({ ...prev, [key]: false }));
    }
  }, [catalog]);

  const handleUninstall = useCallback(async (packId: string, harness: string) => {
    const key = `${packId}:${harness}`;
    setInstalling((prev) => ({ ...prev, [key]: true }));

    try {
      const entry = catalog?.find((e) => e.packId === packId);
      const command = entry?.uninstallCommands?.[harness] ?? null;
      const { runId } = await window.desktopApi.db.catalogUninstall(packId, harness);
      setInstallModal({ open: true, packId, harness, action: "uninstall", runId, command });
    } catch (err) {
      console.error("Uninstall failed:", err);
    } finally {
      setInstalling((prev) => ({ ...prev, [key]: false }));
    }
  }, [catalog]);

  const handleCloseModal = useCallback(() => {
    setInstallModal(EMPTY_INSTALL);
    // Refresh catalog and installed packs after install/uninstall
    invalidateCache("db:catalog");
    invalidateCache("db:installed-packs");
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await window.desktopApi.db.catalogRefresh();
      invalidateCache("db:catalog");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleCardClick = useCallback((packId: string) => {
    setSelectedPackId(packId);
    setViewMode("detail");
  }, []);

  const handleBack = useCallback(() => {
    setViewMode("catalog");
    setSelectedPackId(null);
  }, []);

  // -- Loading state --

  if (catalogLoading && !catalog) {
    return <LoadingState label="catalog" />;
  }

  // -- Detail view --

  if (viewMode === "detail" && selectedPackId) {
    const catalogEntry = catalog?.find((e) => e.packId === selectedPackId);
    return (
      <PackDetailView
        packId={selectedPackId}
        catalogEntry={catalogEntry ?? null}
        packDetail={packDetail ?? null}
        onBack={handleBack}
        onInstall={handleInstall}
        onUninstall={handleUninstall}
        installing={installing}
      />
    );
  }

  // -- Catalog view --

  return (
    <PageShell title="Packs" description="Browse, install, and manage packs across harnesses">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Search packs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" disabled={refreshing} onClick={handleRefresh}>
          <RefreshCw className={cx("h-4 w-4", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="all" className="w-full">
        <TabsList>
          <TabsTrigger value="all">
            All ({filteredCatalog.length})
          </TabsTrigger>
          <TabsTrigger value="installed">
            Installed ({installedEntries.length})
          </TabsTrigger>
          <TabsTrigger value="discover">
            Discover ({discoverEntries.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <CatalogGrid
            entries={filteredCatalog}
            onInstall={handleInstall}
            onUninstall={handleUninstall}
            onClick={handleCardClick}
            installing={installing}
          />
        </TabsContent>

        <TabsContent value="installed" className="mt-4">
          {installedEntries.length === 0 ? (
            <EmptyState icon={Package} title="No packs installed yet" className="py-16" />
          ) : (
            <CatalogGrid
              entries={installedEntries}
              onInstall={handleInstall}
              onUninstall={handleUninstall}
              onClick={handleCardClick}
              installing={installing}
            />
          )}
        </TabsContent>

        <TabsContent value="discover" className="mt-4">
          {discoverEntries.length === 0 ? (
            <EmptyState icon={Package} title="All available packs are installed" className="py-16" />
          ) : (
            <CatalogGrid
              entries={discoverEntries}
              onInstall={handleInstall}
              onUninstall={handleUninstall}
              onClick={handleCardClick}
              installing={installing}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Installed packs (from local detection) */}
      {!installedLoading && installedPacks && installedPacks.length > 0 && (
        <DashboardCard title="Locally Detected Packs" contentClassName="p-0">
          <div className="overflow-auto">
            <DsTable className={DASHBOARD_TABLE_CLASS_NAME}>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-5 text-left">Pack ID</TableHead>
                  <TableHead className="px-5 text-left">Harnesses</TableHead>
                  <TableHead className="px-5 text-right">Skills</TableHead>
                  <TableHead className="px-5 text-left">Last Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {installedPacks.map((pack) => (
                  <TableRow
                    key={pack.packId}
                    className="cursor-pointer hover:bg-[var(--muted)]/50"
                    onClick={() => handleCardClick(pack.packId)}
                  >
                    <TableCell className="px-5 font-medium">{pack.packId}</TableCell>
                    <TableCell className="px-5">
                      <div className="flex flex-wrap gap-1">
                        {pack.harnesses.map((h) => (
                          <Badge key={h} variant="outline" className="text-[10px]">{h}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="px-5 text-right">{pack.skillCount}</TableCell>
                    <TableCell className="px-5">{formatDate(pack.lastSeenAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DsTable>
          </div>
        </DashboardCard>
      )}

      {/* Install modal */}
      <InstallModal
        open={installModal.open}
        onClose={handleCloseModal}
        packId={installModal.packId}
        harness={installModal.harness}
        action={installModal.action}
        runId={installModal.runId}
        command={installModal.command}
      />
    </PageShell>
  );
}

// ---- Grid of catalog cards ----

function CatalogGrid({
  entries,
  onInstall,
  onUninstall,
  onClick,
  installing,
}: {
  entries: CatalogEntry[];
  onInstall: (packId: string, harness: string) => void;
  onUninstall: (packId: string, harness: string) => void;
  onClick: (packId: string) => void;
  installing: Record<string, boolean>;
}) {
  if (entries.length === 0) {
    return <EmptyState icon={Package} title="No packs match your search" className="py-16" />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => (
        <CatalogCard
          key={entry.packId}
          entry={entry}
          onInstall={onInstall}
          onUninstall={onUninstall}
          onClick={onClick}
          installing={installing}
        />
      ))}
    </div>
  );
}

// ---- Pack detail view ----

function PackDetailView({
  packId,
  catalogEntry,
  packDetail,
  onBack,
  onInstall,
  onUninstall,
  installing,
}: {
  packId: string;
  catalogEntry: CatalogEntry | null;
  packDetail: InstalledPackDetail | null;
  onBack: () => void;
  onInstall: (packId: string, harness: string) => void;
  onUninstall: (packId: string, harness: string) => void;
  installing: Record<string, boolean>;
}) {
  const { data: readme } = useQueryCache<string | null>(
    `db:catalog-readme:${packId}`,
    () => window.desktopApi.db.getCatalogReadme(packId),
    30_000,
    60_000,
  );

  const displayName = catalogEntry?.displayName ?? packId;
  const description = catalogEntry?.descriptionLive ?? catalogEntry?.description;
  const starHistory = catalogEntry?.history?.map((h) => h.stars) ?? [];

  return (
    <PageShell title={displayName} description={description ?? "Pack detail"}>
      {/* Back button */}
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to catalog
        </Button>
      </div>

      {/* Stats row */}
      {catalogEntry && (
        <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted-foreground)]">
          {catalogEntry.stars != null && (
            <span className="flex items-center gap-1">
              <Star className="h-4 w-4" />
              {catalogEntry.stars.toLocaleString()} stars
            </span>
          )}
          {catalogEntry.forks != null && (
            <span className="flex items-center gap-1">
              <GitFork className="h-4 w-4" />
              {catalogEntry.forks.toLocaleString()} forks
            </span>
          )}
          {starHistory.length >= 2 && <Sparkline data={starHistory} width={120} height={24} />}
          {catalogEntry.githubUrl && (
            <a
              href={catalogEntry.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 hover:text-[var(--foreground)]"
            >
              <ExternalLink className="h-4 w-4" /> GitHub
            </a>
          )}
          {catalogEntry.verified && <Badge variant="default">Verified</Badge>}
          {catalogEntry.category && <Badge variant="outline">{catalogEntry.category}</Badge>}
        </div>
      )}

      {/* Harnesses + install actions */}
      {catalogEntry && (
        <DashboardCard title="Harnesses">
          <div className="flex flex-wrap gap-3">
            {catalogEntry.harnesses.map((harness) => {
              const installed = catalogEntry.installedHarnesses.includes(harness);
              const busy = installing[`${packId}:${harness}`] ?? false;

              return (
                <div
                  key={harness}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
                >
                  <Badge variant="outline">{harness}</Badge>
                  {installed ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => onUninstall(packId, harness)}
                      className="h-7 text-xs"
                    >
                      {busy ? "..." : "Uninstall"}
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      disabled={busy || !!catalogEntry.placeholderReason}
                      onClick={() => onInstall(packId, harness)}
                      className="h-7 text-xs"
                      title={catalogEntry.placeholderReason ?? undefined}
                    >
                      {busy ? "..." : "Install"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </DashboardCard>
      )}

      {/* Skills list */}
      {packDetail && packDetail.skills.length > 0 && (
        <DashboardCard title={`Skills (${packDetail.skills.length})`} contentClassName="p-0">
          <div className="overflow-auto">
            <DsTable className={DASHBOARD_TABLE_CLASS_NAME}>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-5 text-left">Name</TableHead>
                  <TableHead className="px-5 text-left">Description</TableHead>
                  <TableHead className="px-5 text-left">Harness</TableHead>
                  <TableHead className="px-5 text-left">Version</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packDetail.skills.map((skill) => (
                  <TableRow key={skill.skillId}>
                    <TableCell className="px-5 font-medium">{skill.name ?? skill.skillId}</TableCell>
                    <TableCell className="px-5 text-xs text-[var(--muted-foreground)]">
                      {skill.description ?? "-"}
                    </TableCell>
                    <TableCell className="px-5">
                      {skill.harness ? <Badge variant="outline" className="text-[10px]">{skill.harness}</Badge> : "-"}
                    </TableCell>
                    <TableCell className="px-5 font-mono text-xs">{skill.version ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DsTable>
          </div>
        </DashboardCard>
      )}

      {/* Project associations */}
      {packDetail && packDetail.associations.length > 0 && (
        <DashboardCard title="Project Associations">
          <div className="space-y-2">
            {packDetail.associations.map((assoc) => (
              <div key={assoc.projectPath} className="flex items-center justify-between text-sm">
                <span className="truncate font-mono text-xs">{assoc.projectPath}</span>
                <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                  {formatDate(assoc.lastSeenAt)}
                </span>
              </div>
            ))}
          </div>
        </DashboardCard>
      )}

      {/* README */}
      {readme && (
        <DashboardCard title="README">
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm">
            {readme}
          </div>
        </DashboardCard>
      )}

      {/* Contents */}
      {catalogEntry?.contentsCache && catalogEntry.contentsCache.length > 0 && (
        <DashboardCard title="Contents" contentClassName="p-0">
          <div className="overflow-auto">
            <DsTable className={DASHBOARD_TABLE_CLASS_NAME}>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-5 text-left">Name</TableHead>
                  <TableHead className="px-5 text-left">Type</TableHead>
                  <TableHead className="px-5 text-left">Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalogEntry.contentsCache.map((item) => (
                  <TableRow key={item.name}>
                    <TableCell className="px-5 font-medium">{item.name}</TableCell>
                    <TableCell className="px-5">
                      <Badge variant="outline" className="text-[10px]">{item.type}</Badge>
                    </TableCell>
                    <TableCell className="px-5 text-xs text-[var(--muted-foreground)]">
                      {item.description ?? "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DsTable>
          </div>
        </DashboardCard>
      )}
    </PageShell>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}
