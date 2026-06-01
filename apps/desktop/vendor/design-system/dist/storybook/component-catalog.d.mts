declare const canonicalStorybookRoots: readonly ["Catalog", "Design System"];
type StorybookCatalogSection = Exclude<(typeof canonicalStorybookRoots)[number], "Catalog">;
type StorybookCatalogEntry = {
    id: string;
    label: string;
    sourcePath: string;
    section: StorybookCatalogSection;
    pathSegments: readonly string[];
    storyTitle: string;
    storyId?: string;
    storyStatus?: "catalog-only";
    internal?: boolean;
    note?: string;
};
declare const designSystemComponentCatalog: readonly [{
    readonly id: "accordion";
    readonly label: "Accordion";
    readonly sourcePath: "packages/design-system/components/ui/accordion.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "accordion";
    readonly storyTitle: "Design System/Primitives/Accordion";
}, {
    readonly id: "active-filters-bar";
    readonly label: "Active Filters Bar";
    readonly sourcePath: "packages/design-system/components/ui/active-filters-bar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "active-filters-bar";
    readonly storyTitle: "Design System/Primitives/Active Filters Bar";
}, {
    readonly id: "activity-heatmap";
    readonly label: "Activity Heatmap";
    readonly sourcePath: "packages/design-system/components/ui/primitives/activity-heatmap.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "activity-heatmap";
    readonly storyTitle: "Design System/Primitives/Activity Heatmap";
}, {
    readonly id: "agent-card";
    readonly label: "Agent Card";
    readonly sourcePath: "packages/design-system/components/ui/primitives/agent-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "agent-card";
    readonly storyTitle: "Design System/Primitives/Agent Card";
}, {
    readonly id: "alert";
    readonly label: "Alert";
    readonly sourcePath: "packages/design-system/components/ui/alert.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "alert";
    readonly storyTitle: "Design System/Primitives/Alert";
}, {
    readonly id: "alert-dialog";
    readonly label: "Alert Dialog";
    readonly sourcePath: "packages/design-system/components/ui/alert-dialog.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "alert-dialog";
    readonly storyTitle: "Design System/Primitives/Alert Dialog";
}, {
    readonly id: "analytics-range-toggle";
    readonly label: "Analytics Range Toggle";
    readonly sourcePath: "packages/design-system/components/ui/analytics-range-toggle.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "analytics-range-toggle";
    readonly storyTitle: "Design System/Primitives/Analytics Range Toggle";
}, {
    readonly id: "artifact-repositories-summary";
    readonly label: "Artifact Repositories Summary";
    readonly sourcePath: "packages/design-system/components/ui/artifact-repositories-summary.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "artifact-repositories-summary";
    readonly storyTitle: "Design System/Primitives/Artifact Repositories Summary";
}, {
    readonly id: "artifact-row";
    readonly label: "Artifact Row";
    readonly sourcePath: "packages/design-system/components/ui/artifact-row.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "artifact-row";
    readonly storyTitle: "Design System/Primitives/Artifact Row";
}, {
    readonly id: "attachment-list";
    readonly label: "Attachment List";
    readonly sourcePath: "packages/design-system/components/ui/attachment-list.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "attachment-list";
    readonly storyTitle: "Design System/Primitives/Attachment List";
}, {
    readonly id: "avatar";
    readonly label: "Avatar";
    readonly sourcePath: "packages/design-system/components/ui/avatar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "avatar";
    readonly storyTitle: "Design System/Primitives/Avatar";
}, {
    readonly id: "badge";
    readonly label: "Badge";
    readonly sourcePath: "packages/design-system/components/ui/badge.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "badge";
    readonly storyTitle: "Design System/Primitives/Badge";
}, {
    readonly id: "breadcrumb";
    readonly label: "Breadcrumb";
    readonly sourcePath: "packages/design-system/components/ui/breadcrumb.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "breadcrumb";
    readonly storyTitle: "Design System/Primitives/Breadcrumb";
}, {
    readonly id: "button";
    readonly label: "Button";
    readonly sourcePath: "packages/design-system/components/ui/button.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "button";
    readonly storyTitle: "Design System/Primitives/Button";
}, {
    readonly id: "calendar";
    readonly label: "Calendar";
    readonly sourcePath: "packages/design-system/components/ui/calendar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "calendar";
    readonly storyTitle: "Design System/Primitives/Calendar";
}, {
    readonly id: "card";
    readonly label: "Card";
    readonly sourcePath: "packages/design-system/components/ui/card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "card";
    readonly storyTitle: "Design System/Primitives/Card";
}, {
    readonly id: "chart";
    readonly label: "Chart";
    readonly sourcePath: "packages/design-system/components/ui/chart.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "chart";
    readonly storyTitle: "Design System/Primitives/Chart";
}, {
    readonly id: "checkbox";
    readonly label: "Checkbox";
    readonly sourcePath: "packages/design-system/components/ui/checkbox.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "checkbox";
    readonly storyTitle: "Design System/Primitives/Checkbox";
}, {
    readonly id: "chip";
    readonly label: "Chip";
    readonly sourcePath: "packages/design-system/components/ui/chip.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "chip";
    readonly storyTitle: "Design System/Primitives/Chip";
}, {
    readonly id: "code-block";
    readonly label: "Code Block";
    readonly sourcePath: "packages/design-system/components/ui/primitives/code-block.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "code-block";
    readonly storyTitle: "Design System/Primitives/Code Block";
}, {
    readonly id: "collapsed-comment-row";
    readonly label: "Collapsed Comment Row";
    readonly sourcePath: "packages/design-system/components/ui/collapsed-comment-row.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "collapsed-comment-row";
    readonly storyTitle: "Design System/Primitives/Collapsed Comment Row";
}, {
    readonly id: "collapsible";
    readonly label: "Collapsible";
    readonly sourcePath: "packages/design-system/components/ui/collapsible.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "collapsible";
    readonly storyTitle: "Design System/Primitives/Collapsible";
}, {
    readonly id: "collapsible-section";
    readonly label: "Collapsible Section";
    readonly sourcePath: "packages/design-system/components/ui/collapsible-section.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyStatus: "catalog-only";
    readonly storyTitle: "Design System/Primitives/Collapsible Section";
}, {
    readonly id: "command";
    readonly label: "Command";
    readonly sourcePath: "packages/design-system/components/ui/command.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "command";
    readonly storyTitle: "Design System/Primitives/Command";
}, {
    readonly id: "comment-action-menu";
    readonly label: "Comment Action Menu";
    readonly sourcePath: "packages/design-system/components/ui/comment-action-menu.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "comment-action-menu";
    readonly storyTitle: "Design System/Primitives/Comment Action Menu";
}, {
    readonly id: "comment-avatar";
    readonly label: "Comment Avatar";
    readonly sourcePath: "packages/design-system/components/ui/comment-avatar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "comment-avatar";
    readonly storyTitle: "Design System/Primitives/Comment Avatar";
}, {
    readonly id: "comment-composer";
    readonly label: "Comment Composer";
    readonly sourcePath: "packages/design-system/components/ui/comment-composer.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "comment-composer";
    readonly storyTitle: "Design System/Primitives/Comment Composer";
}, {
    readonly id: "comment-thread";
    readonly label: "Comment Thread";
    readonly sourcePath: "packages/design-system/components/ui/comment-thread.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "comment-thread";
    readonly storyTitle: "Design System/Primitives/Comment Thread";
}, {
    readonly id: "comment-thread-action-footer";
    readonly label: "Comment Thread Action Footer";
    readonly sourcePath: "packages/design-system/components/ui/comment-thread-action-footer.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "comment-thread-action-footer";
    readonly storyTitle: "Design System/Primitives/Comment Thread Action Footer";
}, {
    readonly id: "comments-section";
    readonly label: "Comments Section";
    readonly sourcePath: "packages/design-system/components/ui/comments-section.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "comments-section";
    readonly storyTitle: "Design System/Primitives/Comments Section";
}, {
    readonly id: "compute-preference-card";
    readonly label: "Compute Preference Card";
    readonly sourcePath: "packages/design-system/components/ui/compute-preference-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "compute-preference-card";
    readonly storyTitle: "Design System/Primitives/Compute Preference Card";
}, {
    readonly id: "compute-target-card";
    readonly label: "Compute Target Card";
    readonly sourcePath: "packages/design-system/components/ui/compute-target-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "compute-target-card";
    readonly storyTitle: "Design System/Primitives/Compute Target Card";
}, {
    readonly id: "compute-target-sync-table";
    readonly label: "Compute Target Sync Table";
    readonly sourcePath: "packages/design-system/components/ui/compute-target-sync-table.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "compute-target-sync-table";
    readonly storyTitle: "Design System/Primitives/Compute Target Sync Table";
}, {
    readonly id: "compute-target-system-check";
    readonly label: "Compute Target System Check";
    readonly sourcePath: "packages/design-system/components/ui/compute-target-system-check.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "compute-target-system-check";
    readonly storyTitle: "Design System/Primitives/Compute Target System Check";
}, {
    readonly id: "conversation-message";
    readonly label: "Conversation Message";
    readonly sourcePath: "packages/design-system/components/ui/conversation-message.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyStatus: "catalog-only";
    readonly storyTitle: "Design System/Primitives/Conversation Message";
}, {
    readonly id: "conversation-transcript";
    readonly label: "Conversation Transcript";
    readonly sourcePath: "packages/design-system/components/ui/conversation-transcript.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "conversation-transcript";
    readonly storyTitle: "Design System/Primitives/Conversation Transcript";
}, {
    readonly id: "copy-button";
    readonly label: "Copy Button";
    readonly sourcePath: "packages/design-system/components/ui/primitives/copy-button.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "copy-button";
    readonly storyTitle: "Design System/Primitives/Copy Button";
}, {
    readonly id: "data-table";
    readonly label: "Data Table";
    readonly sourcePath: "packages/design-system/components/ui/data-table.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "data-table";
    readonly storyTitle: "Design System/Primitives/Data Table";
}, {
    readonly id: "date-picker-popover";
    readonly label: "Date Picker Popover";
    readonly sourcePath: "packages/design-system/components/ui/date-picker-popover.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "date-picker-popover";
    readonly storyTitle: "Design System/Primitives/Date Picker Popover";
}, {
    readonly id: "desktop-security";
    readonly label: "Desktop Security";
    readonly sourcePath: "packages/design-system/components/ui/desktop-security.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyStatus: "catalog-only";
    readonly storyTitle: "Design System/Primitives/Desktop Security";
}, {
    readonly id: "dialog";
    readonly label: "Dialog";
    readonly sourcePath: "packages/design-system/components/ui/dialog.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "dialog";
    readonly storyTitle: "Design System/Primitives/Dialog";
}, {
    readonly id: "document-activity-section";
    readonly label: "Document Activity Section";
    readonly sourcePath: "packages/design-system/components/ui/document-activity-section.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "document-activity-section";
    readonly storyTitle: "Design System/Primitives/Document Activity Section";
}, {
    readonly id: "document-rating-section";
    readonly label: "Document Rating Section";
    readonly sourcePath: "packages/design-system/components/ui/document-rating-section.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "document-rating-section";
    readonly storyTitle: "Design System/Primitives/Document Rating Section";
}, {
    readonly id: "document-type-badge";
    readonly label: "Document Type Badge";
    readonly sourcePath: "packages/design-system/components/ui/document-type-badge.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "document-type-badge";
    readonly storyTitle: "Design System/Primitives/Document Type Badge";
}, {
    readonly id: "donut-chart";
    readonly label: "Donut Chart";
    readonly sourcePath: "packages/design-system/components/ui/primitives/donut-chart.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "donut-chart";
    readonly storyTitle: "Design System/Primitives/Donut Chart";
}, {
    readonly id: "drawer";
    readonly label: "Drawer";
    readonly sourcePath: "packages/design-system/components/ui/drawer.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "drawer";
    readonly storyTitle: "Design System/Primitives/Drawer";
}, {
    readonly id: "dropdown-menu";
    readonly label: "Dropdown Menu";
    readonly sourcePath: "packages/design-system/components/ui/dropdown-menu.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "dropdown-menu";
    readonly storyTitle: "Design System/Primitives/Dropdown Menu";
}, {
    readonly id: "empty-state";
    readonly label: "Empty State";
    readonly sourcePath: "packages/design-system/components/ui/empty-state.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyStatus: "catalog-only";
    readonly storyTitle: "Design System/Primitives/Empty State";
}, {
    readonly id: "evaluation-section";
    readonly label: "Evaluation Section";
    readonly sourcePath: "packages/design-system/components/ui/evaluation-section.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "evaluation-section";
    readonly storyTitle: "Design System/Primitives/Evaluation Section";
}, {
    readonly id: "event-group-row";
    readonly label: "Event Group Row";
    readonly sourcePath: "packages/design-system/components/ui/primitives/event-group-row.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "event-group-row";
    readonly storyTitle: "Design System/Primitives/Event Group Row";
}, {
    readonly id: "favorite-button";
    readonly label: "Favorite Button";
    readonly sourcePath: "packages/design-system/components/ui/favorite-button.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "favorite-button";
    readonly storyTitle: "Design System/Primitives/Favorite Button";
}, {
    readonly id: "feed-rail";
    readonly label: "Feed Rail";
    readonly sourcePath: "packages/design-system/components/ui/feed-rail.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "feed-rail";
    readonly storyTitle: "Design System/Primitives/Feed Rail";
}, {
    readonly id: "file-list";
    readonly label: "File List";
    readonly sourcePath: "packages/design-system/components/ui/primitives/file-list.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "file-list";
    readonly storyTitle: "Design System/Primitives/File List";
}, {
    readonly id: "filter-chip";
    readonly label: "Filter Chip";
    readonly sourcePath: "packages/design-system/components/ui/filter-chip.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "filter-chip";
    readonly storyTitle: "Design System/Primitives/Filter Chip";
}, {
    readonly id: "filter-popover";
    readonly label: "Filter Popover";
    readonly sourcePath: "packages/design-system/components/ui/filter-popover.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "filter-popover";
    readonly storyTitle: "Design System/Primitives/Filter Popover";
}, {
    readonly id: "form";
    readonly label: "Form";
    readonly sourcePath: "packages/design-system/components/ui/form.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "form";
    readonly storyTitle: "Design System/Primitives/Form";
}, {
    readonly id: "graph";
    readonly label: "Graph";
    readonly sourcePath: "packages/design-system/components/ui/primitives/graph.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "graph";
    readonly storyTitle: "Design System/Primitives/Graph";
}, {
    readonly id: "group-header-row";
    readonly label: "Group Header Row";
    readonly sourcePath: "packages/design-system/components/ui/group-header-row.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "group-header-row";
    readonly storyTitle: "Design System/Primitives/Group Header Row";
}, {
    readonly id: "group-section-header";
    readonly label: "Group Section Header";
    readonly sourcePath: "packages/design-system/components/ui/group-section-header.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "group-section-header";
    readonly storyTitle: "Design System/Primitives/Group Section Header";
}, {
    readonly id: "inline-edit-editor-shell";
    readonly label: "Inline Edit Editor Shell";
    readonly sourcePath: "packages/design-system/components/ui/inline-edit-editor-shell.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "inline-edit-editor-shell";
    readonly storyTitle: "Design System/Primitives/Inline Edit Editor Shell";
}, {
    readonly id: "input";
    readonly label: "Input";
    readonly sourcePath: "packages/design-system/components/ui/input.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "input";
    readonly storyTitle: "Design System/Primitives/Input";
}, {
    readonly id: "integration-connection-card";
    readonly label: "Integration Connection Card";
    readonly sourcePath: "packages/design-system/components/ui/integration-connection-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "integration-connection-card";
    readonly storyTitle: "Design System/Primitives/Integration Connection Card";
}, {
    readonly id: "integration-disconnect-dialog";
    readonly label: "Integration Disconnect Dialog";
    readonly sourcePath: "packages/design-system/components/ui/integration-disconnect-dialog.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "integration-disconnect-dialog";
    readonly storyTitle: "Design System/Primitives/Integration Disconnect Dialog";
}, {
    readonly id: "interactive-metric-card";
    readonly label: "Interactive Metric Card";
    readonly sourcePath: "packages/design-system/components/ui/interactive-metric-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "interactive-metric-card";
    readonly storyTitle: "Design System/Primitives/Interactive Metric Card";
}, {
    readonly id: "judge-result-card";
    readonly label: "Judge Result Card";
    readonly sourcePath: "packages/design-system/components/ui/judge-result-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "judge-result-card";
    readonly storyTitle: "Design System/Primitives/Judge Result Card";
}, {
    readonly id: "kanban-artifact-card";
    readonly label: "Kanban Artifact Card";
    readonly sourcePath: "packages/design-system/components/ui/kanban-artifact-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "kanban-artifact-card";
    readonly storyTitle: "Design System/Primitives/Kanban Artifact Card";
}, {
    readonly id: "key-value-grid";
    readonly label: "Key Value Grid";
    readonly sourcePath: "packages/design-system/components/ui/primitives/key-value-grid.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "key-value-grid";
    readonly storyTitle: "Design System/Primitives/Key Value Grid";
}, {
    readonly id: "label";
    readonly label: "Label";
    readonly sourcePath: "packages/design-system/components/ui/label.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "label";
    readonly storyTitle: "Design System/Primitives/Label";
}, {
    readonly id: "line-chart";
    readonly label: "Line Chart";
    readonly sourcePath: "packages/design-system/components/ui/primitives/line-chart.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "line-chart";
    readonly storyTitle: "Design System/Primitives/Line Chart";
}, {
    readonly id: "list-item";
    readonly label: "List Item";
    readonly sourcePath: "packages/design-system/components/ui/primitives/list-item.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "list-item";
    readonly storyTitle: "Design System/Primitives/List Item";
}, {
    readonly id: "markdown-content";
    readonly label: "Markdown Content";
    readonly sourcePath: "packages/design-system/components/ui/primitives/markdown-content.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "markdown-content";
    readonly storyTitle: "Design System/Primitives/Markdown Content";
}, {
    readonly id: "match-list";
    readonly label: "Match List";
    readonly sourcePath: "packages/design-system/components/ui/primitives/match-list.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "match-list";
    readonly storyTitle: "Design System/Primitives/Match List";
}, {
    readonly id: "metadata-panel";
    readonly label: "Metadata Panel";
    readonly sourcePath: "packages/design-system/components/ui/metadata-panel.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "metadata-panel";
    readonly storyTitle: "Design System/Primitives/Metadata Panel";
}, {
    readonly id: "metric-card";
    readonly label: "Metric Card";
    readonly sourcePath: "packages/design-system/components/ui/primitives/metric-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "metric-card";
    readonly storyTitle: "Design System/Primitives/Metric Card";
}, {
    readonly id: "mode-toggle";
    readonly label: "Mode Toggle";
    readonly sourcePath: "packages/design-system/components/ui/mode-toggle.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "mode-toggle";
    readonly storyTitle: "Design System/Primitives/Mode Toggle";
}, {
    readonly id: "model-usage-table";
    readonly label: "Model Usage Table";
    readonly sourcePath: "packages/design-system/components/ui/model-usage-table.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "model-usage-table";
    readonly storyTitle: "Design System/Primitives/Model Usage Table";
}, {
    readonly id: "multi-select-popover";
    readonly label: "Multi Select Popover";
    readonly sourcePath: "packages/design-system/components/ui/multi-select-popover.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "multi-select-popover";
    readonly storyTitle: "Design System/Primitives/Multi Select Popover";
}, {
    readonly id: "navigation-menu";
    readonly label: "Navigation Menu";
    readonly sourcePath: "packages/design-system/components/ui/navigation-menu.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "navigation-menu";
    readonly storyTitle: "Design System/Primitives/Navigation Menu";
}, {
    readonly id: "pack-card";
    readonly label: "Pack Card";
    readonly sourcePath: "packages/design-system/components/ui/primitives/pack-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "pack-card";
    readonly storyTitle: "Design System/Primitives/Pack Card";
}, {
    readonly id: "popover";
    readonly label: "Popover";
    readonly sourcePath: "packages/design-system/components/ui/popover.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "popover";
    readonly storyTitle: "Design System/Primitives/Popover";
}, {
    readonly id: "priority-badge";
    readonly label: "Priority Badge";
    readonly sourcePath: "packages/design-system/components/ui/priority-badge.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "priority-badge";
    readonly storyTitle: "Design System/Primitives/Priority Badge";
}, {
    readonly id: "priority-icon";
    readonly label: "Priority Icon";
    readonly sourcePath: "packages/design-system/components/ui/priority-icon.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "priority-icon";
    readonly storyTitle: "Design System/Primitives/Priority Icon";
}, {
    readonly id: "progress";
    readonly label: "Progress";
    readonly sourcePath: "packages/design-system/components/ui/progress.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "progress";
    readonly storyTitle: "Design System/Primitives/Progress";
}, {
    readonly id: "progress-ring";
    readonly label: "Progress Ring";
    readonly sourcePath: "packages/design-system/components/ui/primitives/progress-ring.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "progress-ring";
    readonly storyTitle: "Design System/Primitives/Progress Ring";
}, {
    readonly id: "pull-request-chip";
    readonly label: "Pull Request Chip";
    readonly sourcePath: "packages/design-system/components/ui/primitives/pull-request-chip.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "pull-request-chip";
    readonly storyTitle: "Design System/Primitives/Pull Request Chip";
}, {
    readonly id: "radio-group";
    readonly label: "Radio Group";
    readonly sourcePath: "packages/design-system/components/ui/radio-group.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "radio-group";
    readonly storyTitle: "Design System/Primitives/Radio Group";
}, {
    readonly id: "ranked-bar";
    readonly label: "Ranked Bar";
    readonly sourcePath: "packages/design-system/components/ui/primitives/ranked-bar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "ranked-bar";
    readonly storyTitle: "Design System/Primitives/Ranked Bar";
}, {
    readonly id: "resizable";
    readonly label: "Resizable Panel Group";
    readonly sourcePath: "packages/design-system/components/ui/resizable.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "resizable";
    readonly storyTitle: "Design System/Primitives/Resizable Panel Group";
}, {
    readonly id: "sankey-graph";
    readonly label: "Sankey Graph";
    readonly sourcePath: "packages/design-system/components/ui/primitives/sankey-graph.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sankey-graph";
    readonly storyTitle: "Design System/Primitives/Sankey Graph";
}, {
    readonly id: "scroll-area";
    readonly label: "Scroll Area";
    readonly sourcePath: "packages/design-system/components/ui/scroll-area.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "scroll-area";
    readonly storyTitle: "Design System/Primitives/Scroll Area";
}, {
    readonly id: "section-header";
    readonly label: "Section Header";
    readonly sourcePath: "packages/design-system/components/ui/section-header.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "section-header";
    readonly storyTitle: "Design System/Primitives/Section Header";
}, {
    readonly id: "segmented-bar";
    readonly label: "Segmented Bar";
    readonly sourcePath: "packages/design-system/components/ui/primitives/segmented-bar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "segmented-bar";
    readonly storyTitle: "Design System/Primitives/Segmented Bar";
}, {
    readonly id: "select";
    readonly label: "Select";
    readonly sourcePath: "packages/design-system/components/ui/select.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "select";
    readonly storyTitle: "Design System/Primitives/Select";
}, {
    readonly id: "separator";
    readonly label: "Separator";
    readonly sourcePath: "packages/design-system/components/ui/separator.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "separator";
    readonly storyTitle: "Design System/Primitives/Separator";
}, {
    readonly id: "session-card";
    readonly label: "Session Card";
    readonly sourcePath: "packages/design-system/components/ui/primitives/session-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "session-card";
    readonly storyTitle: "Design System/Primitives/Session Card";
}, {
    readonly id: "session-detail-panels";
    readonly label: "Session Detail Panels";
    readonly sourcePath: "packages/design-system/components/ui/session-detail-panels.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyStatus: "catalog-only";
    readonly storyTitle: "Design System/Primitives/Session Detail Panels";
}, {
    readonly id: "settings-action-panel";
    readonly label: "Settings Action Panel";
    readonly sourcePath: "packages/design-system/components/ui/settings-action-panel.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "settings-action-panel";
    readonly storyTitle: "Design System/Primitives/Settings Action Panel";
}, {
    readonly id: "sheet";
    readonly label: "Sheet";
    readonly sourcePath: "packages/design-system/components/ui/sheet.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sheet";
    readonly storyTitle: "Design System/Primitives/Sheet";
}, {
    readonly id: "sidebar";
    readonly label: "Sidebar";
    readonly sourcePath: "packages/design-system/components/ui/sidebar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sidebar";
    readonly storyTitle: "Design System/Primitives/Sidebar";
}, {
    readonly id: "sidebar-count-badge";
    readonly label: "Sidebar Count Badge";
    readonly sourcePath: "packages/design-system/components/ui/sidebar-count-badge.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sidebar-count-badge";
    readonly storyTitle: "Design System/Primitives/Sidebar Count Badge";
}, {
    readonly id: "sidebar-favorites-group";
    readonly label: "Sidebar Favorites Group";
    readonly sourcePath: "packages/design-system/components/ui/sidebar-favorites-group.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sidebar-favorites-group";
    readonly storyTitle: "Design System/Primitives/Sidebar Favorites Group";
}, {
    readonly id: "sidebar-tree-nav";
    readonly label: "Sidebar Tree Nav";
    readonly sourcePath: "packages/design-system/components/ui/sidebar-tree-nav.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sidebar-tree-nav";
    readonly storyTitle: "Design System/Primitives/Sidebar Tree Nav";
}, {
    readonly id: "skeleton";
    readonly label: "Skeleton";
    readonly sourcePath: "packages/design-system/components/ui/skeleton.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "skeleton";
    readonly storyTitle: "Design System/Primitives/Skeleton";
}, {
    readonly id: "sonner";
    readonly label: "Sonner";
    readonly sourcePath: "packages/design-system/components/ui/sonner.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sonner";
    readonly storyTitle: "Design System/Primitives/Sonner";
}, {
    readonly id: "sortable-column-header";
    readonly label: "Sortable Column Header";
    readonly sourcePath: "packages/design-system/components/ui/sortable-column-header.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sortable-column-header";
    readonly storyTitle: "Design System/Primitives/Sortable Column Header";
}, {
    readonly id: "sparkline";
    readonly label: "Sparkline";
    readonly sourcePath: "packages/design-system/components/ui/primitives/sparkline.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sparkline";
    readonly storyTitle: "Design System/Primitives/Sparkline";
}, {
    readonly id: "star-rating";
    readonly label: "Star Rating";
    readonly sourcePath: "packages/design-system/components/ui/star-rating.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "star-rating";
    readonly storyTitle: "Design System/Primitives/Star Rating";
}, {
    readonly id: "status-badge";
    readonly label: "Status Badge";
    readonly sourcePath: "packages/design-system/components/ui/status-badge.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "status-badge";
    readonly storyTitle: "Design System/Primitives/Status Badge";
}, {
    readonly id: "status-icon";
    readonly label: "Status Icon";
    readonly sourcePath: "packages/design-system/components/ui/status-icon.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "status-icon";
    readonly storyTitle: "Design System/Primitives/Status Icon";
}, {
    readonly id: "status-metadata-section";
    readonly label: "Status Metadata Section";
    readonly sourcePath: "packages/design-system/components/ui/status-metadata-section.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "status-metadata-section";
    readonly storyTitle: "Design System/Primitives/Status Metadata Section";
}, {
    readonly id: "status-percentage-icon";
    readonly label: "Status Percentage Icon";
    readonly sourcePath: "packages/design-system/components/ui/status-percentage-icon.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "status-percentage-icon";
    readonly storyTitle: "Design System/Primitives/Status Percentage Icon";
}, {
    readonly id: "switch";
    readonly label: "Switch";
    readonly sourcePath: "packages/design-system/components/ui/switch.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "switch";
    readonly storyTitle: "Design System/Primitives/Switch";
}, {
    readonly id: "system-check-results";
    readonly label: "System Check Results";
    readonly sourcePath: "packages/design-system/components/ui/system-check-results.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "system-check-results";
    readonly storyTitle: "Design System/Primitives/System Check Results";
}, {
    readonly id: "table";
    readonly label: "Table";
    readonly sourcePath: "packages/design-system/components/ui/table.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "table";
    readonly storyTitle: "Design System/Primitives/Table";
}, {
    readonly id: "table-grid-header";
    readonly label: "Table Grid Header";
    readonly sourcePath: "packages/design-system/components/ui/table-grid-header.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "table-grid-header";
    readonly storyTitle: "Design System/Primitives/Table Grid Header";
}, {
    readonly id: "table-view-menu";
    readonly label: "Table View Menu";
    readonly sourcePath: "packages/design-system/components/ui/table-view-menu.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "table-view-menu";
    readonly storyTitle: "Design System/Primitives/Table View Menu";
}, {
    readonly id: "tabs";
    readonly label: "Tabs";
    readonly sourcePath: "packages/design-system/components/ui/tabs.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "tabs";
    readonly storyTitle: "Design System/Primitives/Tabs";
}, {
    readonly id: "terminal-block";
    readonly label: "Terminal Block";
    readonly sourcePath: "packages/design-system/components/ui/primitives/terminal-block.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "terminal-block";
    readonly storyTitle: "Design System/Primitives/Terminal Block";
}, {
    readonly id: "textarea";
    readonly label: "Textarea";
    readonly sourcePath: "packages/design-system/components/ui/textarea.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "textarea";
    readonly storyTitle: "Design System/Primitives/Textarea";
}, {
    readonly id: "thinking-block";
    readonly label: "Thinking Block";
    readonly sourcePath: "packages/design-system/components/ui/primitives/thinking-block.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "thinking-block";
    readonly storyTitle: "Design System/Primitives/Thinking Block";
}, {
    readonly id: "toggle";
    readonly label: "Toggle";
    readonly sourcePath: "packages/design-system/components/ui/toggle.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "toggle";
    readonly storyTitle: "Design System/Primitives/Toggle";
}, {
    readonly id: "toggle-group";
    readonly label: "Toggle Group";
    readonly sourcePath: "packages/design-system/components/ui/toggle-group.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "toggle-group";
    readonly storyTitle: "Design System/Primitives/Toggle Group";
}, {
    readonly id: "tool-call-block";
    readonly label: "Tool Call Block";
    readonly sourcePath: "packages/design-system/components/ui/primitives/tool-call-block.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "tool-call-block";
    readonly storyTitle: "Design System/Primitives/Tool Call Block";
}, {
    readonly id: "tool-data-view";
    readonly label: "Tool Data View";
    readonly sourcePath: "packages/design-system/components/ui/primitives/tool-data-view.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "tool-data-view";
    readonly storyTitle: "Design System/Primitives/Tool Data View";
}, {
    readonly id: "tool-result-block";
    readonly label: "Tool Result Block";
    readonly sourcePath: "packages/design-system/components/ui/primitives/tool-result-block.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "tool-result-block";
    readonly storyTitle: "Design System/Primitives/Tool Result Block";
}, {
    readonly id: "tooltip";
    readonly label: "Tooltip";
    readonly sourcePath: "packages/design-system/components/ui/tooltip.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "tooltip";
    readonly storyTitle: "Design System/Primitives/Tooltip";
}, {
    readonly id: "underline-tabs";
    readonly label: "Underline Tabs";
    readonly sourcePath: "packages/design-system/components/ui/primitives/underline-tabs.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "underline-tabs";
    readonly storyTitle: "Design System/Primitives/Underline Tabs";
}, {
    readonly id: "unified-diff";
    readonly label: "Unified Diff";
    readonly sourcePath: "packages/design-system/components/ui/primitives/unified-diff.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "unified-diff";
    readonly storyTitle: "Design System/Primitives/Unified Diff";
}, {
    readonly id: "user-select-popover";
    readonly label: "User Select Popover";
    readonly sourcePath: "packages/design-system/components/ui/user-select-popover.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "user-select-popover";
    readonly storyTitle: "Design System/Primitives/User Select Popover";
}, {
    readonly id: "user-usage-table";
    readonly label: "User Usage Table";
    readonly sourcePath: "packages/design-system/components/ui/user-usage-table.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "user-usage-table";
    readonly storyTitle: "Design System/Primitives/User Usage Table";
}, {
    readonly id: "version-actions-toolbar";
    readonly label: "Version Actions Toolbar";
    readonly sourcePath: "packages/design-system/components/ui/version-actions-toolbar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "version-actions-toolbar";
    readonly storyTitle: "Design System/Primitives/Version Actions Toolbar";
}, {
    readonly id: "workflow-stat-tile";
    readonly label: "Workflow Stat Tile";
    readonly sourcePath: "packages/design-system/components/ui/primitives/workflow-stat-tile.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "workflow-stat-tile";
    readonly storyTitle: "Design System/Primitives/Workflow Stat Tile";
}, {
    readonly id: "kanban-board";
    readonly label: "Kanban Board";
    readonly sourcePath: "packages/design-system/components/ui/layout/kanban-board.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Layout"];
    readonly storyId: "kanban-board";
    readonly storyTitle: "Design System/Layout/Kanban Board";
}, {
    readonly id: "section";
    readonly label: "Section";
    readonly sourcePath: "packages/design-system/components/ui/layout/section.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Layout"];
    readonly storyId: "section";
    readonly storyTitle: "Design System/Layout/Section";
}, {
    readonly id: "session-table";
    readonly label: "Session Table";
    readonly sourcePath: "packages/design-system/components/ui/composites/session-table.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Data Display"];
    readonly storyId: "session-table";
    readonly storyTitle: "Design System/Data Display/Session Table";
}, {
    readonly id: "sessions-controls";
    readonly label: "Sessions Controls";
    readonly sourcePath: "packages/design-system/components/ui/composites/sessions-controls.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Data Display"];
    readonly storyId: "sessions-controls";
    readonly storyTitle: "Design System/Data Display/Sessions Controls";
}];
declare const appComponentCatalog: readonly [];
declare const storybookComponentCatalog: readonly [{
    readonly id: "accordion";
    readonly label: "Accordion";
    readonly sourcePath: "packages/design-system/components/ui/accordion.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "accordion";
    readonly storyTitle: "Design System/Primitives/Accordion";
}, {
    readonly id: "active-filters-bar";
    readonly label: "Active Filters Bar";
    readonly sourcePath: "packages/design-system/components/ui/active-filters-bar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "active-filters-bar";
    readonly storyTitle: "Design System/Primitives/Active Filters Bar";
}, {
    readonly id: "activity-heatmap";
    readonly label: "Activity Heatmap";
    readonly sourcePath: "packages/design-system/components/ui/primitives/activity-heatmap.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "activity-heatmap";
    readonly storyTitle: "Design System/Primitives/Activity Heatmap";
}, {
    readonly id: "agent-card";
    readonly label: "Agent Card";
    readonly sourcePath: "packages/design-system/components/ui/primitives/agent-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "agent-card";
    readonly storyTitle: "Design System/Primitives/Agent Card";
}, {
    readonly id: "alert";
    readonly label: "Alert";
    readonly sourcePath: "packages/design-system/components/ui/alert.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "alert";
    readonly storyTitle: "Design System/Primitives/Alert";
}, {
    readonly id: "alert-dialog";
    readonly label: "Alert Dialog";
    readonly sourcePath: "packages/design-system/components/ui/alert-dialog.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "alert-dialog";
    readonly storyTitle: "Design System/Primitives/Alert Dialog";
}, {
    readonly id: "analytics-range-toggle";
    readonly label: "Analytics Range Toggle";
    readonly sourcePath: "packages/design-system/components/ui/analytics-range-toggle.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "analytics-range-toggle";
    readonly storyTitle: "Design System/Primitives/Analytics Range Toggle";
}, {
    readonly id: "artifact-repositories-summary";
    readonly label: "Artifact Repositories Summary";
    readonly sourcePath: "packages/design-system/components/ui/artifact-repositories-summary.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "artifact-repositories-summary";
    readonly storyTitle: "Design System/Primitives/Artifact Repositories Summary";
}, {
    readonly id: "artifact-row";
    readonly label: "Artifact Row";
    readonly sourcePath: "packages/design-system/components/ui/artifact-row.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "artifact-row";
    readonly storyTitle: "Design System/Primitives/Artifact Row";
}, {
    readonly id: "attachment-list";
    readonly label: "Attachment List";
    readonly sourcePath: "packages/design-system/components/ui/attachment-list.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "attachment-list";
    readonly storyTitle: "Design System/Primitives/Attachment List";
}, {
    readonly id: "avatar";
    readonly label: "Avatar";
    readonly sourcePath: "packages/design-system/components/ui/avatar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "avatar";
    readonly storyTitle: "Design System/Primitives/Avatar";
}, {
    readonly id: "badge";
    readonly label: "Badge";
    readonly sourcePath: "packages/design-system/components/ui/badge.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "badge";
    readonly storyTitle: "Design System/Primitives/Badge";
}, {
    readonly id: "breadcrumb";
    readonly label: "Breadcrumb";
    readonly sourcePath: "packages/design-system/components/ui/breadcrumb.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "breadcrumb";
    readonly storyTitle: "Design System/Primitives/Breadcrumb";
}, {
    readonly id: "button";
    readonly label: "Button";
    readonly sourcePath: "packages/design-system/components/ui/button.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "button";
    readonly storyTitle: "Design System/Primitives/Button";
}, {
    readonly id: "calendar";
    readonly label: "Calendar";
    readonly sourcePath: "packages/design-system/components/ui/calendar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "calendar";
    readonly storyTitle: "Design System/Primitives/Calendar";
}, {
    readonly id: "card";
    readonly label: "Card";
    readonly sourcePath: "packages/design-system/components/ui/card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "card";
    readonly storyTitle: "Design System/Primitives/Card";
}, {
    readonly id: "chart";
    readonly label: "Chart";
    readonly sourcePath: "packages/design-system/components/ui/chart.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "chart";
    readonly storyTitle: "Design System/Primitives/Chart";
}, {
    readonly id: "checkbox";
    readonly label: "Checkbox";
    readonly sourcePath: "packages/design-system/components/ui/checkbox.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "checkbox";
    readonly storyTitle: "Design System/Primitives/Checkbox";
}, {
    readonly id: "chip";
    readonly label: "Chip";
    readonly sourcePath: "packages/design-system/components/ui/chip.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "chip";
    readonly storyTitle: "Design System/Primitives/Chip";
}, {
    readonly id: "code-block";
    readonly label: "Code Block";
    readonly sourcePath: "packages/design-system/components/ui/primitives/code-block.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "code-block";
    readonly storyTitle: "Design System/Primitives/Code Block";
}, {
    readonly id: "collapsed-comment-row";
    readonly label: "Collapsed Comment Row";
    readonly sourcePath: "packages/design-system/components/ui/collapsed-comment-row.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "collapsed-comment-row";
    readonly storyTitle: "Design System/Primitives/Collapsed Comment Row";
}, {
    readonly id: "collapsible";
    readonly label: "Collapsible";
    readonly sourcePath: "packages/design-system/components/ui/collapsible.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "collapsible";
    readonly storyTitle: "Design System/Primitives/Collapsible";
}, {
    readonly id: "collapsible-section";
    readonly label: "Collapsible Section";
    readonly sourcePath: "packages/design-system/components/ui/collapsible-section.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyStatus: "catalog-only";
    readonly storyTitle: "Design System/Primitives/Collapsible Section";
}, {
    readonly id: "command";
    readonly label: "Command";
    readonly sourcePath: "packages/design-system/components/ui/command.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "command";
    readonly storyTitle: "Design System/Primitives/Command";
}, {
    readonly id: "comment-action-menu";
    readonly label: "Comment Action Menu";
    readonly sourcePath: "packages/design-system/components/ui/comment-action-menu.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "comment-action-menu";
    readonly storyTitle: "Design System/Primitives/Comment Action Menu";
}, {
    readonly id: "comment-avatar";
    readonly label: "Comment Avatar";
    readonly sourcePath: "packages/design-system/components/ui/comment-avatar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "comment-avatar";
    readonly storyTitle: "Design System/Primitives/Comment Avatar";
}, {
    readonly id: "comment-composer";
    readonly label: "Comment Composer";
    readonly sourcePath: "packages/design-system/components/ui/comment-composer.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "comment-composer";
    readonly storyTitle: "Design System/Primitives/Comment Composer";
}, {
    readonly id: "comment-thread";
    readonly label: "Comment Thread";
    readonly sourcePath: "packages/design-system/components/ui/comment-thread.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "comment-thread";
    readonly storyTitle: "Design System/Primitives/Comment Thread";
}, {
    readonly id: "comment-thread-action-footer";
    readonly label: "Comment Thread Action Footer";
    readonly sourcePath: "packages/design-system/components/ui/comment-thread-action-footer.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "comment-thread-action-footer";
    readonly storyTitle: "Design System/Primitives/Comment Thread Action Footer";
}, {
    readonly id: "comments-section";
    readonly label: "Comments Section";
    readonly sourcePath: "packages/design-system/components/ui/comments-section.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "comments-section";
    readonly storyTitle: "Design System/Primitives/Comments Section";
}, {
    readonly id: "compute-preference-card";
    readonly label: "Compute Preference Card";
    readonly sourcePath: "packages/design-system/components/ui/compute-preference-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "compute-preference-card";
    readonly storyTitle: "Design System/Primitives/Compute Preference Card";
}, {
    readonly id: "compute-target-card";
    readonly label: "Compute Target Card";
    readonly sourcePath: "packages/design-system/components/ui/compute-target-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "compute-target-card";
    readonly storyTitle: "Design System/Primitives/Compute Target Card";
}, {
    readonly id: "compute-target-sync-table";
    readonly label: "Compute Target Sync Table";
    readonly sourcePath: "packages/design-system/components/ui/compute-target-sync-table.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "compute-target-sync-table";
    readonly storyTitle: "Design System/Primitives/Compute Target Sync Table";
}, {
    readonly id: "compute-target-system-check";
    readonly label: "Compute Target System Check";
    readonly sourcePath: "packages/design-system/components/ui/compute-target-system-check.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "compute-target-system-check";
    readonly storyTitle: "Design System/Primitives/Compute Target System Check";
}, {
    readonly id: "conversation-message";
    readonly label: "Conversation Message";
    readonly sourcePath: "packages/design-system/components/ui/conversation-message.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyStatus: "catalog-only";
    readonly storyTitle: "Design System/Primitives/Conversation Message";
}, {
    readonly id: "conversation-transcript";
    readonly label: "Conversation Transcript";
    readonly sourcePath: "packages/design-system/components/ui/conversation-transcript.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "conversation-transcript";
    readonly storyTitle: "Design System/Primitives/Conversation Transcript";
}, {
    readonly id: "copy-button";
    readonly label: "Copy Button";
    readonly sourcePath: "packages/design-system/components/ui/primitives/copy-button.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "copy-button";
    readonly storyTitle: "Design System/Primitives/Copy Button";
}, {
    readonly id: "data-table";
    readonly label: "Data Table";
    readonly sourcePath: "packages/design-system/components/ui/data-table.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "data-table";
    readonly storyTitle: "Design System/Primitives/Data Table";
}, {
    readonly id: "date-picker-popover";
    readonly label: "Date Picker Popover";
    readonly sourcePath: "packages/design-system/components/ui/date-picker-popover.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "date-picker-popover";
    readonly storyTitle: "Design System/Primitives/Date Picker Popover";
}, {
    readonly id: "desktop-security";
    readonly label: "Desktop Security";
    readonly sourcePath: "packages/design-system/components/ui/desktop-security.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyStatus: "catalog-only";
    readonly storyTitle: "Design System/Primitives/Desktop Security";
}, {
    readonly id: "dialog";
    readonly label: "Dialog";
    readonly sourcePath: "packages/design-system/components/ui/dialog.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "dialog";
    readonly storyTitle: "Design System/Primitives/Dialog";
}, {
    readonly id: "document-activity-section";
    readonly label: "Document Activity Section";
    readonly sourcePath: "packages/design-system/components/ui/document-activity-section.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "document-activity-section";
    readonly storyTitle: "Design System/Primitives/Document Activity Section";
}, {
    readonly id: "document-rating-section";
    readonly label: "Document Rating Section";
    readonly sourcePath: "packages/design-system/components/ui/document-rating-section.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "document-rating-section";
    readonly storyTitle: "Design System/Primitives/Document Rating Section";
}, {
    readonly id: "document-type-badge";
    readonly label: "Document Type Badge";
    readonly sourcePath: "packages/design-system/components/ui/document-type-badge.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "document-type-badge";
    readonly storyTitle: "Design System/Primitives/Document Type Badge";
}, {
    readonly id: "donut-chart";
    readonly label: "Donut Chart";
    readonly sourcePath: "packages/design-system/components/ui/primitives/donut-chart.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "donut-chart";
    readonly storyTitle: "Design System/Primitives/Donut Chart";
}, {
    readonly id: "drawer";
    readonly label: "Drawer";
    readonly sourcePath: "packages/design-system/components/ui/drawer.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "drawer";
    readonly storyTitle: "Design System/Primitives/Drawer";
}, {
    readonly id: "dropdown-menu";
    readonly label: "Dropdown Menu";
    readonly sourcePath: "packages/design-system/components/ui/dropdown-menu.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "dropdown-menu";
    readonly storyTitle: "Design System/Primitives/Dropdown Menu";
}, {
    readonly id: "empty-state";
    readonly label: "Empty State";
    readonly sourcePath: "packages/design-system/components/ui/empty-state.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyStatus: "catalog-only";
    readonly storyTitle: "Design System/Primitives/Empty State";
}, {
    readonly id: "evaluation-section";
    readonly label: "Evaluation Section";
    readonly sourcePath: "packages/design-system/components/ui/evaluation-section.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "evaluation-section";
    readonly storyTitle: "Design System/Primitives/Evaluation Section";
}, {
    readonly id: "event-group-row";
    readonly label: "Event Group Row";
    readonly sourcePath: "packages/design-system/components/ui/primitives/event-group-row.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "event-group-row";
    readonly storyTitle: "Design System/Primitives/Event Group Row";
}, {
    readonly id: "favorite-button";
    readonly label: "Favorite Button";
    readonly sourcePath: "packages/design-system/components/ui/favorite-button.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "favorite-button";
    readonly storyTitle: "Design System/Primitives/Favorite Button";
}, {
    readonly id: "feed-rail";
    readonly label: "Feed Rail";
    readonly sourcePath: "packages/design-system/components/ui/feed-rail.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "feed-rail";
    readonly storyTitle: "Design System/Primitives/Feed Rail";
}, {
    readonly id: "file-list";
    readonly label: "File List";
    readonly sourcePath: "packages/design-system/components/ui/primitives/file-list.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "file-list";
    readonly storyTitle: "Design System/Primitives/File List";
}, {
    readonly id: "filter-chip";
    readonly label: "Filter Chip";
    readonly sourcePath: "packages/design-system/components/ui/filter-chip.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "filter-chip";
    readonly storyTitle: "Design System/Primitives/Filter Chip";
}, {
    readonly id: "filter-popover";
    readonly label: "Filter Popover";
    readonly sourcePath: "packages/design-system/components/ui/filter-popover.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "filter-popover";
    readonly storyTitle: "Design System/Primitives/Filter Popover";
}, {
    readonly id: "form";
    readonly label: "Form";
    readonly sourcePath: "packages/design-system/components/ui/form.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "form";
    readonly storyTitle: "Design System/Primitives/Form";
}, {
    readonly id: "graph";
    readonly label: "Graph";
    readonly sourcePath: "packages/design-system/components/ui/primitives/graph.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "graph";
    readonly storyTitle: "Design System/Primitives/Graph";
}, {
    readonly id: "group-header-row";
    readonly label: "Group Header Row";
    readonly sourcePath: "packages/design-system/components/ui/group-header-row.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "group-header-row";
    readonly storyTitle: "Design System/Primitives/Group Header Row";
}, {
    readonly id: "group-section-header";
    readonly label: "Group Section Header";
    readonly sourcePath: "packages/design-system/components/ui/group-section-header.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "group-section-header";
    readonly storyTitle: "Design System/Primitives/Group Section Header";
}, {
    readonly id: "inline-edit-editor-shell";
    readonly label: "Inline Edit Editor Shell";
    readonly sourcePath: "packages/design-system/components/ui/inline-edit-editor-shell.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "inline-edit-editor-shell";
    readonly storyTitle: "Design System/Primitives/Inline Edit Editor Shell";
}, {
    readonly id: "input";
    readonly label: "Input";
    readonly sourcePath: "packages/design-system/components/ui/input.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "input";
    readonly storyTitle: "Design System/Primitives/Input";
}, {
    readonly id: "integration-connection-card";
    readonly label: "Integration Connection Card";
    readonly sourcePath: "packages/design-system/components/ui/integration-connection-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "integration-connection-card";
    readonly storyTitle: "Design System/Primitives/Integration Connection Card";
}, {
    readonly id: "integration-disconnect-dialog";
    readonly label: "Integration Disconnect Dialog";
    readonly sourcePath: "packages/design-system/components/ui/integration-disconnect-dialog.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "integration-disconnect-dialog";
    readonly storyTitle: "Design System/Primitives/Integration Disconnect Dialog";
}, {
    readonly id: "interactive-metric-card";
    readonly label: "Interactive Metric Card";
    readonly sourcePath: "packages/design-system/components/ui/interactive-metric-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "interactive-metric-card";
    readonly storyTitle: "Design System/Primitives/Interactive Metric Card";
}, {
    readonly id: "judge-result-card";
    readonly label: "Judge Result Card";
    readonly sourcePath: "packages/design-system/components/ui/judge-result-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "judge-result-card";
    readonly storyTitle: "Design System/Primitives/Judge Result Card";
}, {
    readonly id: "kanban-artifact-card";
    readonly label: "Kanban Artifact Card";
    readonly sourcePath: "packages/design-system/components/ui/kanban-artifact-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "kanban-artifact-card";
    readonly storyTitle: "Design System/Primitives/Kanban Artifact Card";
}, {
    readonly id: "key-value-grid";
    readonly label: "Key Value Grid";
    readonly sourcePath: "packages/design-system/components/ui/primitives/key-value-grid.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "key-value-grid";
    readonly storyTitle: "Design System/Primitives/Key Value Grid";
}, {
    readonly id: "label";
    readonly label: "Label";
    readonly sourcePath: "packages/design-system/components/ui/label.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "label";
    readonly storyTitle: "Design System/Primitives/Label";
}, {
    readonly id: "line-chart";
    readonly label: "Line Chart";
    readonly sourcePath: "packages/design-system/components/ui/primitives/line-chart.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "line-chart";
    readonly storyTitle: "Design System/Primitives/Line Chart";
}, {
    readonly id: "list-item";
    readonly label: "List Item";
    readonly sourcePath: "packages/design-system/components/ui/primitives/list-item.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "list-item";
    readonly storyTitle: "Design System/Primitives/List Item";
}, {
    readonly id: "markdown-content";
    readonly label: "Markdown Content";
    readonly sourcePath: "packages/design-system/components/ui/primitives/markdown-content.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "markdown-content";
    readonly storyTitle: "Design System/Primitives/Markdown Content";
}, {
    readonly id: "match-list";
    readonly label: "Match List";
    readonly sourcePath: "packages/design-system/components/ui/primitives/match-list.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "match-list";
    readonly storyTitle: "Design System/Primitives/Match List";
}, {
    readonly id: "metadata-panel";
    readonly label: "Metadata Panel";
    readonly sourcePath: "packages/design-system/components/ui/metadata-panel.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "metadata-panel";
    readonly storyTitle: "Design System/Primitives/Metadata Panel";
}, {
    readonly id: "metric-card";
    readonly label: "Metric Card";
    readonly sourcePath: "packages/design-system/components/ui/primitives/metric-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "metric-card";
    readonly storyTitle: "Design System/Primitives/Metric Card";
}, {
    readonly id: "mode-toggle";
    readonly label: "Mode Toggle";
    readonly sourcePath: "packages/design-system/components/ui/mode-toggle.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "mode-toggle";
    readonly storyTitle: "Design System/Primitives/Mode Toggle";
}, {
    readonly id: "model-usage-table";
    readonly label: "Model Usage Table";
    readonly sourcePath: "packages/design-system/components/ui/model-usage-table.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "model-usage-table";
    readonly storyTitle: "Design System/Primitives/Model Usage Table";
}, {
    readonly id: "multi-select-popover";
    readonly label: "Multi Select Popover";
    readonly sourcePath: "packages/design-system/components/ui/multi-select-popover.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "multi-select-popover";
    readonly storyTitle: "Design System/Primitives/Multi Select Popover";
}, {
    readonly id: "navigation-menu";
    readonly label: "Navigation Menu";
    readonly sourcePath: "packages/design-system/components/ui/navigation-menu.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "navigation-menu";
    readonly storyTitle: "Design System/Primitives/Navigation Menu";
}, {
    readonly id: "pack-card";
    readonly label: "Pack Card";
    readonly sourcePath: "packages/design-system/components/ui/primitives/pack-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "pack-card";
    readonly storyTitle: "Design System/Primitives/Pack Card";
}, {
    readonly id: "popover";
    readonly label: "Popover";
    readonly sourcePath: "packages/design-system/components/ui/popover.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "popover";
    readonly storyTitle: "Design System/Primitives/Popover";
}, {
    readonly id: "priority-badge";
    readonly label: "Priority Badge";
    readonly sourcePath: "packages/design-system/components/ui/priority-badge.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "priority-badge";
    readonly storyTitle: "Design System/Primitives/Priority Badge";
}, {
    readonly id: "priority-icon";
    readonly label: "Priority Icon";
    readonly sourcePath: "packages/design-system/components/ui/priority-icon.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "priority-icon";
    readonly storyTitle: "Design System/Primitives/Priority Icon";
}, {
    readonly id: "progress";
    readonly label: "Progress";
    readonly sourcePath: "packages/design-system/components/ui/progress.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "progress";
    readonly storyTitle: "Design System/Primitives/Progress";
}, {
    readonly id: "progress-ring";
    readonly label: "Progress Ring";
    readonly sourcePath: "packages/design-system/components/ui/primitives/progress-ring.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "progress-ring";
    readonly storyTitle: "Design System/Primitives/Progress Ring";
}, {
    readonly id: "pull-request-chip";
    readonly label: "Pull Request Chip";
    readonly sourcePath: "packages/design-system/components/ui/primitives/pull-request-chip.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "pull-request-chip";
    readonly storyTitle: "Design System/Primitives/Pull Request Chip";
}, {
    readonly id: "radio-group";
    readonly label: "Radio Group";
    readonly sourcePath: "packages/design-system/components/ui/radio-group.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "radio-group";
    readonly storyTitle: "Design System/Primitives/Radio Group";
}, {
    readonly id: "ranked-bar";
    readonly label: "Ranked Bar";
    readonly sourcePath: "packages/design-system/components/ui/primitives/ranked-bar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "ranked-bar";
    readonly storyTitle: "Design System/Primitives/Ranked Bar";
}, {
    readonly id: "resizable";
    readonly label: "Resizable Panel Group";
    readonly sourcePath: "packages/design-system/components/ui/resizable.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "resizable";
    readonly storyTitle: "Design System/Primitives/Resizable Panel Group";
}, {
    readonly id: "sankey-graph";
    readonly label: "Sankey Graph";
    readonly sourcePath: "packages/design-system/components/ui/primitives/sankey-graph.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sankey-graph";
    readonly storyTitle: "Design System/Primitives/Sankey Graph";
}, {
    readonly id: "scroll-area";
    readonly label: "Scroll Area";
    readonly sourcePath: "packages/design-system/components/ui/scroll-area.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "scroll-area";
    readonly storyTitle: "Design System/Primitives/Scroll Area";
}, {
    readonly id: "section-header";
    readonly label: "Section Header";
    readonly sourcePath: "packages/design-system/components/ui/section-header.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "section-header";
    readonly storyTitle: "Design System/Primitives/Section Header";
}, {
    readonly id: "segmented-bar";
    readonly label: "Segmented Bar";
    readonly sourcePath: "packages/design-system/components/ui/primitives/segmented-bar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "segmented-bar";
    readonly storyTitle: "Design System/Primitives/Segmented Bar";
}, {
    readonly id: "select";
    readonly label: "Select";
    readonly sourcePath: "packages/design-system/components/ui/select.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "select";
    readonly storyTitle: "Design System/Primitives/Select";
}, {
    readonly id: "separator";
    readonly label: "Separator";
    readonly sourcePath: "packages/design-system/components/ui/separator.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "separator";
    readonly storyTitle: "Design System/Primitives/Separator";
}, {
    readonly id: "session-card";
    readonly label: "Session Card";
    readonly sourcePath: "packages/design-system/components/ui/primitives/session-card.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "session-card";
    readonly storyTitle: "Design System/Primitives/Session Card";
}, {
    readonly id: "session-detail-panels";
    readonly label: "Session Detail Panels";
    readonly sourcePath: "packages/design-system/components/ui/session-detail-panels.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyStatus: "catalog-only";
    readonly storyTitle: "Design System/Primitives/Session Detail Panels";
}, {
    readonly id: "settings-action-panel";
    readonly label: "Settings Action Panel";
    readonly sourcePath: "packages/design-system/components/ui/settings-action-panel.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "settings-action-panel";
    readonly storyTitle: "Design System/Primitives/Settings Action Panel";
}, {
    readonly id: "sheet";
    readonly label: "Sheet";
    readonly sourcePath: "packages/design-system/components/ui/sheet.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sheet";
    readonly storyTitle: "Design System/Primitives/Sheet";
}, {
    readonly id: "sidebar";
    readonly label: "Sidebar";
    readonly sourcePath: "packages/design-system/components/ui/sidebar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sidebar";
    readonly storyTitle: "Design System/Primitives/Sidebar";
}, {
    readonly id: "sidebar-count-badge";
    readonly label: "Sidebar Count Badge";
    readonly sourcePath: "packages/design-system/components/ui/sidebar-count-badge.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sidebar-count-badge";
    readonly storyTitle: "Design System/Primitives/Sidebar Count Badge";
}, {
    readonly id: "sidebar-favorites-group";
    readonly label: "Sidebar Favorites Group";
    readonly sourcePath: "packages/design-system/components/ui/sidebar-favorites-group.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sidebar-favorites-group";
    readonly storyTitle: "Design System/Primitives/Sidebar Favorites Group";
}, {
    readonly id: "sidebar-tree-nav";
    readonly label: "Sidebar Tree Nav";
    readonly sourcePath: "packages/design-system/components/ui/sidebar-tree-nav.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sidebar-tree-nav";
    readonly storyTitle: "Design System/Primitives/Sidebar Tree Nav";
}, {
    readonly id: "skeleton";
    readonly label: "Skeleton";
    readonly sourcePath: "packages/design-system/components/ui/skeleton.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "skeleton";
    readonly storyTitle: "Design System/Primitives/Skeleton";
}, {
    readonly id: "sonner";
    readonly label: "Sonner";
    readonly sourcePath: "packages/design-system/components/ui/sonner.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sonner";
    readonly storyTitle: "Design System/Primitives/Sonner";
}, {
    readonly id: "sortable-column-header";
    readonly label: "Sortable Column Header";
    readonly sourcePath: "packages/design-system/components/ui/sortable-column-header.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sortable-column-header";
    readonly storyTitle: "Design System/Primitives/Sortable Column Header";
}, {
    readonly id: "sparkline";
    readonly label: "Sparkline";
    readonly sourcePath: "packages/design-system/components/ui/primitives/sparkline.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "sparkline";
    readonly storyTitle: "Design System/Primitives/Sparkline";
}, {
    readonly id: "star-rating";
    readonly label: "Star Rating";
    readonly sourcePath: "packages/design-system/components/ui/star-rating.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "star-rating";
    readonly storyTitle: "Design System/Primitives/Star Rating";
}, {
    readonly id: "status-badge";
    readonly label: "Status Badge";
    readonly sourcePath: "packages/design-system/components/ui/status-badge.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "status-badge";
    readonly storyTitle: "Design System/Primitives/Status Badge";
}, {
    readonly id: "status-icon";
    readonly label: "Status Icon";
    readonly sourcePath: "packages/design-system/components/ui/status-icon.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "status-icon";
    readonly storyTitle: "Design System/Primitives/Status Icon";
}, {
    readonly id: "status-metadata-section";
    readonly label: "Status Metadata Section";
    readonly sourcePath: "packages/design-system/components/ui/status-metadata-section.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "status-metadata-section";
    readonly storyTitle: "Design System/Primitives/Status Metadata Section";
}, {
    readonly id: "status-percentage-icon";
    readonly label: "Status Percentage Icon";
    readonly sourcePath: "packages/design-system/components/ui/status-percentage-icon.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "status-percentage-icon";
    readonly storyTitle: "Design System/Primitives/Status Percentage Icon";
}, {
    readonly id: "switch";
    readonly label: "Switch";
    readonly sourcePath: "packages/design-system/components/ui/switch.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "switch";
    readonly storyTitle: "Design System/Primitives/Switch";
}, {
    readonly id: "system-check-results";
    readonly label: "System Check Results";
    readonly sourcePath: "packages/design-system/components/ui/system-check-results.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "system-check-results";
    readonly storyTitle: "Design System/Primitives/System Check Results";
}, {
    readonly id: "table";
    readonly label: "Table";
    readonly sourcePath: "packages/design-system/components/ui/table.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "table";
    readonly storyTitle: "Design System/Primitives/Table";
}, {
    readonly id: "table-grid-header";
    readonly label: "Table Grid Header";
    readonly sourcePath: "packages/design-system/components/ui/table-grid-header.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "table-grid-header";
    readonly storyTitle: "Design System/Primitives/Table Grid Header";
}, {
    readonly id: "table-view-menu";
    readonly label: "Table View Menu";
    readonly sourcePath: "packages/design-system/components/ui/table-view-menu.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "table-view-menu";
    readonly storyTitle: "Design System/Primitives/Table View Menu";
}, {
    readonly id: "tabs";
    readonly label: "Tabs";
    readonly sourcePath: "packages/design-system/components/ui/tabs.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "tabs";
    readonly storyTitle: "Design System/Primitives/Tabs";
}, {
    readonly id: "terminal-block";
    readonly label: "Terminal Block";
    readonly sourcePath: "packages/design-system/components/ui/primitives/terminal-block.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "terminal-block";
    readonly storyTitle: "Design System/Primitives/Terminal Block";
}, {
    readonly id: "textarea";
    readonly label: "Textarea";
    readonly sourcePath: "packages/design-system/components/ui/textarea.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "textarea";
    readonly storyTitle: "Design System/Primitives/Textarea";
}, {
    readonly id: "thinking-block";
    readonly label: "Thinking Block";
    readonly sourcePath: "packages/design-system/components/ui/primitives/thinking-block.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "thinking-block";
    readonly storyTitle: "Design System/Primitives/Thinking Block";
}, {
    readonly id: "toggle";
    readonly label: "Toggle";
    readonly sourcePath: "packages/design-system/components/ui/toggle.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "toggle";
    readonly storyTitle: "Design System/Primitives/Toggle";
}, {
    readonly id: "toggle-group";
    readonly label: "Toggle Group";
    readonly sourcePath: "packages/design-system/components/ui/toggle-group.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "toggle-group";
    readonly storyTitle: "Design System/Primitives/Toggle Group";
}, {
    readonly id: "tool-call-block";
    readonly label: "Tool Call Block";
    readonly sourcePath: "packages/design-system/components/ui/primitives/tool-call-block.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "tool-call-block";
    readonly storyTitle: "Design System/Primitives/Tool Call Block";
}, {
    readonly id: "tool-data-view";
    readonly label: "Tool Data View";
    readonly sourcePath: "packages/design-system/components/ui/primitives/tool-data-view.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "tool-data-view";
    readonly storyTitle: "Design System/Primitives/Tool Data View";
}, {
    readonly id: "tool-result-block";
    readonly label: "Tool Result Block";
    readonly sourcePath: "packages/design-system/components/ui/primitives/tool-result-block.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "tool-result-block";
    readonly storyTitle: "Design System/Primitives/Tool Result Block";
}, {
    readonly id: "tooltip";
    readonly label: "Tooltip";
    readonly sourcePath: "packages/design-system/components/ui/tooltip.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "tooltip";
    readonly storyTitle: "Design System/Primitives/Tooltip";
}, {
    readonly id: "underline-tabs";
    readonly label: "Underline Tabs";
    readonly sourcePath: "packages/design-system/components/ui/primitives/underline-tabs.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "underline-tabs";
    readonly storyTitle: "Design System/Primitives/Underline Tabs";
}, {
    readonly id: "unified-diff";
    readonly label: "Unified Diff";
    readonly sourcePath: "packages/design-system/components/ui/primitives/unified-diff.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "unified-diff";
    readonly storyTitle: "Design System/Primitives/Unified Diff";
}, {
    readonly id: "user-select-popover";
    readonly label: "User Select Popover";
    readonly sourcePath: "packages/design-system/components/ui/user-select-popover.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "user-select-popover";
    readonly storyTitle: "Design System/Primitives/User Select Popover";
}, {
    readonly id: "user-usage-table";
    readonly label: "User Usage Table";
    readonly sourcePath: "packages/design-system/components/ui/user-usage-table.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "user-usage-table";
    readonly storyTitle: "Design System/Primitives/User Usage Table";
}, {
    readonly id: "version-actions-toolbar";
    readonly label: "Version Actions Toolbar";
    readonly sourcePath: "packages/design-system/components/ui/version-actions-toolbar.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "version-actions-toolbar";
    readonly storyTitle: "Design System/Primitives/Version Actions Toolbar";
}, {
    readonly id: "workflow-stat-tile";
    readonly label: "Workflow Stat Tile";
    readonly sourcePath: "packages/design-system/components/ui/primitives/workflow-stat-tile.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Primitives"];
    readonly storyId: "workflow-stat-tile";
    readonly storyTitle: "Design System/Primitives/Workflow Stat Tile";
}, {
    readonly id: "kanban-board";
    readonly label: "Kanban Board";
    readonly sourcePath: "packages/design-system/components/ui/layout/kanban-board.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Layout"];
    readonly storyId: "kanban-board";
    readonly storyTitle: "Design System/Layout/Kanban Board";
}, {
    readonly id: "section";
    readonly label: "Section";
    readonly sourcePath: "packages/design-system/components/ui/layout/section.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Layout"];
    readonly storyId: "section";
    readonly storyTitle: "Design System/Layout/Section";
}, {
    readonly id: "session-table";
    readonly label: "Session Table";
    readonly sourcePath: "packages/design-system/components/ui/composites/session-table.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Data Display"];
    readonly storyId: "session-table";
    readonly storyTitle: "Design System/Data Display/Session Table";
}, {
    readonly id: "sessions-controls";
    readonly label: "Sessions Controls";
    readonly sourcePath: "packages/design-system/components/ui/composites/sessions-controls.tsx";
    readonly section: "Design System";
    readonly pathSegments: readonly ["Data Display"];
    readonly storyId: "sessions-controls";
    readonly storyTitle: "Design System/Data Display/Sessions Controls";
}];
declare function hasStory(entry: StorybookCatalogEntry): boolean;

export { type StorybookCatalogEntry, type StorybookCatalogSection, appComponentCatalog, canonicalStorybookRoots, designSystemComponentCatalog, hasStory, storybookComponentCatalog };
