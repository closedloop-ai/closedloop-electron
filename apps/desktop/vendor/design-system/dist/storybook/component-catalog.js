"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// storybook/component-catalog.ts
var component_catalog_exports = {};
__export(component_catalog_exports, {
  appComponentCatalog: () => appComponentCatalog,
  canonicalStorybookRoots: () => canonicalStorybookRoots,
  designSystemComponentCatalog: () => designSystemComponentCatalog,
  hasStory: () => hasStory,
  storybookComponentCatalog: () => storybookComponentCatalog
});
module.exports = __toCommonJS(component_catalog_exports);
var canonicalStorybookRoots = ["Catalog", "Design System"];
var designSystemComponentCatalog = [
  {
    "id": "accordion",
    "label": "Accordion",
    "sourcePath": "packages/design-system/components/ui/accordion.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "accordion",
    "storyTitle": "Design System/Primitives/Accordion"
  },
  {
    "id": "active-filters-bar",
    "label": "Active Filters Bar",
    "sourcePath": "packages/design-system/components/ui/active-filters-bar.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "active-filters-bar",
    "storyTitle": "Design System/Primitives/Active Filters Bar"
  },
  {
    "id": "activity-heatmap",
    "label": "Activity Heatmap",
    "sourcePath": "packages/design-system/components/ui/primitives/activity-heatmap.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "activity-heatmap",
    "storyTitle": "Design System/Primitives/Activity Heatmap"
  },
  {
    "id": "agent-card",
    "label": "Agent Card",
    "sourcePath": "packages/design-system/components/ui/primitives/agent-card.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "agent-card",
    "storyTitle": "Design System/Primitives/Agent Card"
  },
  {
    "id": "alert",
    "label": "Alert",
    "sourcePath": "packages/design-system/components/ui/alert.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "alert",
    "storyTitle": "Design System/Primitives/Alert"
  },
  {
    "id": "alert-dialog",
    "label": "Alert Dialog",
    "sourcePath": "packages/design-system/components/ui/alert-dialog.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "alert-dialog",
    "storyTitle": "Design System/Primitives/Alert Dialog"
  },
  {
    "id": "analytics-range-toggle",
    "label": "Analytics Range Toggle",
    "sourcePath": "packages/design-system/components/ui/analytics-range-toggle.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "analytics-range-toggle",
    "storyTitle": "Design System/Primitives/Analytics Range Toggle"
  },
  {
    "id": "artifact-repositories-summary",
    "label": "Artifact Repositories Summary",
    "sourcePath": "packages/design-system/components/ui/artifact-repositories-summary.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "artifact-repositories-summary",
    "storyTitle": "Design System/Primitives/Artifact Repositories Summary"
  },
  {
    "id": "artifact-row",
    "label": "Artifact Row",
    "sourcePath": "packages/design-system/components/ui/artifact-row.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "artifact-row",
    "storyTitle": "Design System/Primitives/Artifact Row"
  },
  {
    "id": "attachment-list",
    "label": "Attachment List",
    "sourcePath": "packages/design-system/components/ui/attachment-list.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "attachment-list",
    "storyTitle": "Design System/Primitives/Attachment List"
  },
  {
    "id": "avatar",
    "label": "Avatar",
    "sourcePath": "packages/design-system/components/ui/avatar.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "avatar",
    "storyTitle": "Design System/Primitives/Avatar"
  },
  {
    "id": "badge",
    "label": "Badge",
    "sourcePath": "packages/design-system/components/ui/badge.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "badge",
    "storyTitle": "Design System/Primitives/Badge"
  },
  {
    "id": "breadcrumb",
    "label": "Breadcrumb",
    "sourcePath": "packages/design-system/components/ui/breadcrumb.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "breadcrumb",
    "storyTitle": "Design System/Primitives/Breadcrumb"
  },
  {
    "id": "button",
    "label": "Button",
    "sourcePath": "packages/design-system/components/ui/button.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "button",
    "storyTitle": "Design System/Primitives/Button"
  },
  {
    "id": "calendar",
    "label": "Calendar",
    "sourcePath": "packages/design-system/components/ui/calendar.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "calendar",
    "storyTitle": "Design System/Primitives/Calendar"
  },
  {
    "id": "card",
    "label": "Card",
    "sourcePath": "packages/design-system/components/ui/card.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "card",
    "storyTitle": "Design System/Primitives/Card"
  },
  {
    "id": "chart",
    "label": "Chart",
    "sourcePath": "packages/design-system/components/ui/chart.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "chart",
    "storyTitle": "Design System/Primitives/Chart"
  },
  {
    "id": "checkbox",
    "label": "Checkbox",
    "sourcePath": "packages/design-system/components/ui/checkbox.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "checkbox",
    "storyTitle": "Design System/Primitives/Checkbox"
  },
  {
    "id": "chip",
    "label": "Chip",
    "sourcePath": "packages/design-system/components/ui/chip.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "chip",
    "storyTitle": "Design System/Primitives/Chip"
  },
  {
    "id": "code-block",
    "label": "Code Block",
    "sourcePath": "packages/design-system/components/ui/primitives/code-block.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "code-block",
    "storyTitle": "Design System/Primitives/Code Block"
  },
  {
    "id": "collapsed-comment-row",
    "label": "Collapsed Comment Row",
    "sourcePath": "packages/design-system/components/ui/collapsed-comment-row.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "collapsed-comment-row",
    "storyTitle": "Design System/Primitives/Collapsed Comment Row"
  },
  {
    "id": "collapsible",
    "label": "Collapsible",
    "sourcePath": "packages/design-system/components/ui/collapsible.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "collapsible",
    "storyTitle": "Design System/Primitives/Collapsible"
  },
  {
    "id": "collapsible-section",
    "label": "Collapsible Section",
    "sourcePath": "packages/design-system/components/ui/collapsible-section.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyStatus": "catalog-only",
    "storyTitle": "Design System/Primitives/Collapsible Section"
  },
  {
    "id": "command",
    "label": "Command",
    "sourcePath": "packages/design-system/components/ui/command.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "command",
    "storyTitle": "Design System/Primitives/Command"
  },
  {
    "id": "comment-action-menu",
    "label": "Comment Action Menu",
    "sourcePath": "packages/design-system/components/ui/comment-action-menu.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "comment-action-menu",
    "storyTitle": "Design System/Primitives/Comment Action Menu"
  },
  {
    "id": "comment-avatar",
    "label": "Comment Avatar",
    "sourcePath": "packages/design-system/components/ui/comment-avatar.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "comment-avatar",
    "storyTitle": "Design System/Primitives/Comment Avatar"
  },
  {
    "id": "comment-composer",
    "label": "Comment Composer",
    "sourcePath": "packages/design-system/components/ui/comment-composer.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "comment-composer",
    "storyTitle": "Design System/Primitives/Comment Composer"
  },
  {
    "id": "comment-thread",
    "label": "Comment Thread",
    "sourcePath": "packages/design-system/components/ui/comment-thread.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "comment-thread",
    "storyTitle": "Design System/Primitives/Comment Thread"
  },
  {
    "id": "comment-thread-action-footer",
    "label": "Comment Thread Action Footer",
    "sourcePath": "packages/design-system/components/ui/comment-thread-action-footer.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "comment-thread-action-footer",
    "storyTitle": "Design System/Primitives/Comment Thread Action Footer"
  },
  {
    "id": "comments-section",
    "label": "Comments Section",
    "sourcePath": "packages/design-system/components/ui/comments-section.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "comments-section",
    "storyTitle": "Design System/Primitives/Comments Section"
  },
  {
    "id": "compute-preference-card",
    "label": "Compute Preference Card",
    "sourcePath": "packages/design-system/components/ui/compute-preference-card.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "compute-preference-card",
    "storyTitle": "Design System/Primitives/Compute Preference Card"
  },
  {
    "id": "compute-target-card",
    "label": "Compute Target Card",
    "sourcePath": "packages/design-system/components/ui/compute-target-card.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "compute-target-card",
    "storyTitle": "Design System/Primitives/Compute Target Card"
  },
  {
    "id": "compute-target-sync-table",
    "label": "Compute Target Sync Table",
    "sourcePath": "packages/design-system/components/ui/compute-target-sync-table.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "compute-target-sync-table",
    "storyTitle": "Design System/Primitives/Compute Target Sync Table"
  },
  {
    "id": "compute-target-system-check",
    "label": "Compute Target System Check",
    "sourcePath": "packages/design-system/components/ui/compute-target-system-check.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "compute-target-system-check",
    "storyTitle": "Design System/Primitives/Compute Target System Check"
  },
  {
    "id": "conversation-message",
    "label": "Conversation Message",
    "sourcePath": "packages/design-system/components/ui/conversation-message.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyStatus": "catalog-only",
    "storyTitle": "Design System/Primitives/Conversation Message"
  },
  {
    "id": "conversation-transcript",
    "label": "Conversation Transcript",
    "sourcePath": "packages/design-system/components/ui/conversation-transcript.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "conversation-transcript",
    "storyTitle": "Design System/Primitives/Conversation Transcript"
  },
  {
    "id": "copy-button",
    "label": "Copy Button",
    "sourcePath": "packages/design-system/components/ui/primitives/copy-button.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "copy-button",
    "storyTitle": "Design System/Primitives/Copy Button"
  },
  {
    "id": "data-table",
    "label": "Data Table",
    "sourcePath": "packages/design-system/components/ui/data-table.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "data-table",
    "storyTitle": "Design System/Primitives/Data Table"
  },
  {
    "id": "date-picker-popover",
    "label": "Date Picker Popover",
    "sourcePath": "packages/design-system/components/ui/date-picker-popover.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "date-picker-popover",
    "storyTitle": "Design System/Primitives/Date Picker Popover"
  },
  {
    "id": "desktop-security",
    "label": "Desktop Security",
    "sourcePath": "packages/design-system/components/ui/desktop-security.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyStatus": "catalog-only",
    "storyTitle": "Design System/Primitives/Desktop Security"
  },
  {
    "id": "dialog",
    "label": "Dialog",
    "sourcePath": "packages/design-system/components/ui/dialog.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "dialog",
    "storyTitle": "Design System/Primitives/Dialog"
  },
  {
    "id": "document-activity-section",
    "label": "Document Activity Section",
    "sourcePath": "packages/design-system/components/ui/document-activity-section.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "document-activity-section",
    "storyTitle": "Design System/Primitives/Document Activity Section"
  },
  {
    "id": "document-rating-section",
    "label": "Document Rating Section",
    "sourcePath": "packages/design-system/components/ui/document-rating-section.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "document-rating-section",
    "storyTitle": "Design System/Primitives/Document Rating Section"
  },
  {
    "id": "document-type-badge",
    "label": "Document Type Badge",
    "sourcePath": "packages/design-system/components/ui/document-type-badge.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "document-type-badge",
    "storyTitle": "Design System/Primitives/Document Type Badge"
  },
  {
    "id": "donut-chart",
    "label": "Donut Chart",
    "sourcePath": "packages/design-system/components/ui/primitives/donut-chart.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "donut-chart",
    "storyTitle": "Design System/Primitives/Donut Chart"
  },
  {
    "id": "drawer",
    "label": "Drawer",
    "sourcePath": "packages/design-system/components/ui/drawer.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "drawer",
    "storyTitle": "Design System/Primitives/Drawer"
  },
  {
    "id": "dropdown-menu",
    "label": "Dropdown Menu",
    "sourcePath": "packages/design-system/components/ui/dropdown-menu.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "dropdown-menu",
    "storyTitle": "Design System/Primitives/Dropdown Menu"
  },
  {
    "id": "empty-state",
    "label": "Empty State",
    "sourcePath": "packages/design-system/components/ui/empty-state.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyStatus": "catalog-only",
    "storyTitle": "Design System/Primitives/Empty State"
  },
  {
    "id": "evaluation-section",
    "label": "Evaluation Section",
    "sourcePath": "packages/design-system/components/ui/evaluation-section.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "evaluation-section",
    "storyTitle": "Design System/Primitives/Evaluation Section"
  },
  {
    "id": "event-group-row",
    "label": "Event Group Row",
    "sourcePath": "packages/design-system/components/ui/primitives/event-group-row.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "event-group-row",
    "storyTitle": "Design System/Primitives/Event Group Row"
  },
  {
    "id": "favorite-button",
    "label": "Favorite Button",
    "sourcePath": "packages/design-system/components/ui/favorite-button.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "favorite-button",
    "storyTitle": "Design System/Primitives/Favorite Button"
  },
  {
    "id": "feed-rail",
    "label": "Feed Rail",
    "sourcePath": "packages/design-system/components/ui/feed-rail.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "feed-rail",
    "storyTitle": "Design System/Primitives/Feed Rail"
  },
  {
    "id": "file-list",
    "label": "File List",
    "sourcePath": "packages/design-system/components/ui/primitives/file-list.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "file-list",
    "storyTitle": "Design System/Primitives/File List"
  },
  {
    "id": "filter-chip",
    "label": "Filter Chip",
    "sourcePath": "packages/design-system/components/ui/filter-chip.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "filter-chip",
    "storyTitle": "Design System/Primitives/Filter Chip"
  },
  {
    "id": "filter-popover",
    "label": "Filter Popover",
    "sourcePath": "packages/design-system/components/ui/filter-popover.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "filter-popover",
    "storyTitle": "Design System/Primitives/Filter Popover"
  },
  {
    "id": "form",
    "label": "Form",
    "sourcePath": "packages/design-system/components/ui/form.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "form",
    "storyTitle": "Design System/Primitives/Form"
  },
  {
    "id": "graph",
    "label": "Graph",
    "sourcePath": "packages/design-system/components/ui/primitives/graph.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "graph",
    "storyTitle": "Design System/Primitives/Graph"
  },
  {
    "id": "group-header-row",
    "label": "Group Header Row",
    "sourcePath": "packages/design-system/components/ui/group-header-row.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "group-header-row",
    "storyTitle": "Design System/Primitives/Group Header Row"
  },
  {
    "id": "group-section-header",
    "label": "Group Section Header",
    "sourcePath": "packages/design-system/components/ui/group-section-header.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "group-section-header",
    "storyTitle": "Design System/Primitives/Group Section Header"
  },
  {
    "id": "inline-edit-editor-shell",
    "label": "Inline Edit Editor Shell",
    "sourcePath": "packages/design-system/components/ui/inline-edit-editor-shell.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "inline-edit-editor-shell",
    "storyTitle": "Design System/Primitives/Inline Edit Editor Shell"
  },
  {
    "id": "input",
    "label": "Input",
    "sourcePath": "packages/design-system/components/ui/input.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "input",
    "storyTitle": "Design System/Primitives/Input"
  },
  {
    "id": "integration-connection-card",
    "label": "Integration Connection Card",
    "sourcePath": "packages/design-system/components/ui/integration-connection-card.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "integration-connection-card",
    "storyTitle": "Design System/Primitives/Integration Connection Card"
  },
  {
    "id": "integration-disconnect-dialog",
    "label": "Integration Disconnect Dialog",
    "sourcePath": "packages/design-system/components/ui/integration-disconnect-dialog.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "integration-disconnect-dialog",
    "storyTitle": "Design System/Primitives/Integration Disconnect Dialog"
  },
  {
    "id": "interactive-metric-card",
    "label": "Interactive Metric Card",
    "sourcePath": "packages/design-system/components/ui/interactive-metric-card.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "interactive-metric-card",
    "storyTitle": "Design System/Primitives/Interactive Metric Card"
  },
  {
    "id": "judge-result-card",
    "label": "Judge Result Card",
    "sourcePath": "packages/design-system/components/ui/judge-result-card.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "judge-result-card",
    "storyTitle": "Design System/Primitives/Judge Result Card"
  },
  {
    "id": "kanban-artifact-card",
    "label": "Kanban Artifact Card",
    "sourcePath": "packages/design-system/components/ui/kanban-artifact-card.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "kanban-artifact-card",
    "storyTitle": "Design System/Primitives/Kanban Artifact Card"
  },
  {
    "id": "key-value-grid",
    "label": "Key Value Grid",
    "sourcePath": "packages/design-system/components/ui/primitives/key-value-grid.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "key-value-grid",
    "storyTitle": "Design System/Primitives/Key Value Grid"
  },
  {
    "id": "label",
    "label": "Label",
    "sourcePath": "packages/design-system/components/ui/label.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "label",
    "storyTitle": "Design System/Primitives/Label"
  },
  {
    "id": "line-chart",
    "label": "Line Chart",
    "sourcePath": "packages/design-system/components/ui/primitives/line-chart.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "line-chart",
    "storyTitle": "Design System/Primitives/Line Chart"
  },
  {
    "id": "list-item",
    "label": "List Item",
    "sourcePath": "packages/design-system/components/ui/primitives/list-item.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "list-item",
    "storyTitle": "Design System/Primitives/List Item"
  },
  {
    "id": "markdown-content",
    "label": "Markdown Content",
    "sourcePath": "packages/design-system/components/ui/primitives/markdown-content.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "markdown-content",
    "storyTitle": "Design System/Primitives/Markdown Content"
  },
  {
    "id": "match-list",
    "label": "Match List",
    "sourcePath": "packages/design-system/components/ui/primitives/match-list.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "match-list",
    "storyTitle": "Design System/Primitives/Match List"
  },
  {
    "id": "metadata-panel",
    "label": "Metadata Panel",
    "sourcePath": "packages/design-system/components/ui/metadata-panel.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "metadata-panel",
    "storyTitle": "Design System/Primitives/Metadata Panel"
  },
  {
    "id": "metric-card",
    "label": "Metric Card",
    "sourcePath": "packages/design-system/components/ui/primitives/metric-card.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "metric-card",
    "storyTitle": "Design System/Primitives/Metric Card"
  },
  {
    "id": "mode-toggle",
    "label": "Mode Toggle",
    "sourcePath": "packages/design-system/components/ui/mode-toggle.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "mode-toggle",
    "storyTitle": "Design System/Primitives/Mode Toggle"
  },
  {
    "id": "model-usage-table",
    "label": "Model Usage Table",
    "sourcePath": "packages/design-system/components/ui/model-usage-table.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "model-usage-table",
    "storyTitle": "Design System/Primitives/Model Usage Table"
  },
  {
    "id": "multi-select-popover",
    "label": "Multi Select Popover",
    "sourcePath": "packages/design-system/components/ui/multi-select-popover.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "multi-select-popover",
    "storyTitle": "Design System/Primitives/Multi Select Popover"
  },
  {
    "id": "navigation-menu",
    "label": "Navigation Menu",
    "sourcePath": "packages/design-system/components/ui/navigation-menu.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "navigation-menu",
    "storyTitle": "Design System/Primitives/Navigation Menu"
  },
  {
    "id": "pack-card",
    "label": "Pack Card",
    "sourcePath": "packages/design-system/components/ui/primitives/pack-card.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "pack-card",
    "storyTitle": "Design System/Primitives/Pack Card"
  },
  {
    "id": "popover",
    "label": "Popover",
    "sourcePath": "packages/design-system/components/ui/popover.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "popover",
    "storyTitle": "Design System/Primitives/Popover"
  },
  {
    "id": "priority-badge",
    "label": "Priority Badge",
    "sourcePath": "packages/design-system/components/ui/priority-badge.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "priority-badge",
    "storyTitle": "Design System/Primitives/Priority Badge"
  },
  {
    "id": "priority-icon",
    "label": "Priority Icon",
    "sourcePath": "packages/design-system/components/ui/priority-icon.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "priority-icon",
    "storyTitle": "Design System/Primitives/Priority Icon"
  },
  {
    "id": "progress",
    "label": "Progress",
    "sourcePath": "packages/design-system/components/ui/progress.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "progress",
    "storyTitle": "Design System/Primitives/Progress"
  },
  {
    "id": "progress-ring",
    "label": "Progress Ring",
    "sourcePath": "packages/design-system/components/ui/primitives/progress-ring.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "progress-ring",
    "storyTitle": "Design System/Primitives/Progress Ring"
  },
  {
    "id": "pull-request-chip",
    "label": "Pull Request Chip",
    "sourcePath": "packages/design-system/components/ui/primitives/pull-request-chip.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "pull-request-chip",
    "storyTitle": "Design System/Primitives/Pull Request Chip"
  },
  {
    "id": "radio-group",
    "label": "Radio Group",
    "sourcePath": "packages/design-system/components/ui/radio-group.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "radio-group",
    "storyTitle": "Design System/Primitives/Radio Group"
  },
  {
    "id": "ranked-bar",
    "label": "Ranked Bar",
    "sourcePath": "packages/design-system/components/ui/primitives/ranked-bar.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "ranked-bar",
    "storyTitle": "Design System/Primitives/Ranked Bar"
  },
  {
    "id": "resizable",
    "label": "Resizable Panel Group",
    "sourcePath": "packages/design-system/components/ui/resizable.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "resizable",
    "storyTitle": "Design System/Primitives/Resizable Panel Group"
  },
  {
    "id": "sankey-graph",
    "label": "Sankey Graph",
    "sourcePath": "packages/design-system/components/ui/primitives/sankey-graph.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "sankey-graph",
    "storyTitle": "Design System/Primitives/Sankey Graph"
  },
  {
    "id": "scroll-area",
    "label": "Scroll Area",
    "sourcePath": "packages/design-system/components/ui/scroll-area.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "scroll-area",
    "storyTitle": "Design System/Primitives/Scroll Area"
  },
  {
    "id": "section-header",
    "label": "Section Header",
    "sourcePath": "packages/design-system/components/ui/section-header.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "section-header",
    "storyTitle": "Design System/Primitives/Section Header"
  },
  {
    "id": "segmented-bar",
    "label": "Segmented Bar",
    "sourcePath": "packages/design-system/components/ui/primitives/segmented-bar.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "segmented-bar",
    "storyTitle": "Design System/Primitives/Segmented Bar"
  },
  {
    "id": "select",
    "label": "Select",
    "sourcePath": "packages/design-system/components/ui/select.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "select",
    "storyTitle": "Design System/Primitives/Select"
  },
  {
    "id": "separator",
    "label": "Separator",
    "sourcePath": "packages/design-system/components/ui/separator.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "separator",
    "storyTitle": "Design System/Primitives/Separator"
  },
  {
    "id": "session-card",
    "label": "Session Card",
    "sourcePath": "packages/design-system/components/ui/primitives/session-card.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "session-card",
    "storyTitle": "Design System/Primitives/Session Card"
  },
  {
    "id": "session-detail-panels",
    "label": "Session Detail Panels",
    "sourcePath": "packages/design-system/components/ui/session-detail-panels.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyStatus": "catalog-only",
    "storyTitle": "Design System/Primitives/Session Detail Panels"
  },
  {
    "id": "settings-action-panel",
    "label": "Settings Action Panel",
    "sourcePath": "packages/design-system/components/ui/settings-action-panel.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "settings-action-panel",
    "storyTitle": "Design System/Primitives/Settings Action Panel"
  },
  {
    "id": "sheet",
    "label": "Sheet",
    "sourcePath": "packages/design-system/components/ui/sheet.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "sheet",
    "storyTitle": "Design System/Primitives/Sheet"
  },
  {
    "id": "sidebar",
    "label": "Sidebar",
    "sourcePath": "packages/design-system/components/ui/sidebar.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "sidebar",
    "storyTitle": "Design System/Primitives/Sidebar"
  },
  {
    "id": "sidebar-count-badge",
    "label": "Sidebar Count Badge",
    "sourcePath": "packages/design-system/components/ui/sidebar-count-badge.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "sidebar-count-badge",
    "storyTitle": "Design System/Primitives/Sidebar Count Badge"
  },
  {
    "id": "sidebar-favorites-group",
    "label": "Sidebar Favorites Group",
    "sourcePath": "packages/design-system/components/ui/sidebar-favorites-group.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "sidebar-favorites-group",
    "storyTitle": "Design System/Primitives/Sidebar Favorites Group"
  },
  {
    "id": "sidebar-tree-nav",
    "label": "Sidebar Tree Nav",
    "sourcePath": "packages/design-system/components/ui/sidebar-tree-nav.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "sidebar-tree-nav",
    "storyTitle": "Design System/Primitives/Sidebar Tree Nav"
  },
  {
    "id": "skeleton",
    "label": "Skeleton",
    "sourcePath": "packages/design-system/components/ui/skeleton.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "skeleton",
    "storyTitle": "Design System/Primitives/Skeleton"
  },
  {
    "id": "sonner",
    "label": "Sonner",
    "sourcePath": "packages/design-system/components/ui/sonner.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "sonner",
    "storyTitle": "Design System/Primitives/Sonner"
  },
  {
    "id": "sortable-column-header",
    "label": "Sortable Column Header",
    "sourcePath": "packages/design-system/components/ui/sortable-column-header.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "sortable-column-header",
    "storyTitle": "Design System/Primitives/Sortable Column Header"
  },
  {
    "id": "sparkline",
    "label": "Sparkline",
    "sourcePath": "packages/design-system/components/ui/primitives/sparkline.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "sparkline",
    "storyTitle": "Design System/Primitives/Sparkline"
  },
  {
    "id": "star-rating",
    "label": "Star Rating",
    "sourcePath": "packages/design-system/components/ui/star-rating.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "star-rating",
    "storyTitle": "Design System/Primitives/Star Rating"
  },
  {
    "id": "status-badge",
    "label": "Status Badge",
    "sourcePath": "packages/design-system/components/ui/status-badge.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "status-badge",
    "storyTitle": "Design System/Primitives/Status Badge"
  },
  {
    "id": "status-icon",
    "label": "Status Icon",
    "sourcePath": "packages/design-system/components/ui/status-icon.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "status-icon",
    "storyTitle": "Design System/Primitives/Status Icon"
  },
  {
    "id": "status-metadata-section",
    "label": "Status Metadata Section",
    "sourcePath": "packages/design-system/components/ui/status-metadata-section.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "status-metadata-section",
    "storyTitle": "Design System/Primitives/Status Metadata Section"
  },
  {
    "id": "status-percentage-icon",
    "label": "Status Percentage Icon",
    "sourcePath": "packages/design-system/components/ui/status-percentage-icon.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "status-percentage-icon",
    "storyTitle": "Design System/Primitives/Status Percentage Icon"
  },
  {
    "id": "switch",
    "label": "Switch",
    "sourcePath": "packages/design-system/components/ui/switch.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "switch",
    "storyTitle": "Design System/Primitives/Switch"
  },
  {
    "id": "system-check-results",
    "label": "System Check Results",
    "sourcePath": "packages/design-system/components/ui/system-check-results.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "system-check-results",
    "storyTitle": "Design System/Primitives/System Check Results"
  },
  {
    "id": "table",
    "label": "Table",
    "sourcePath": "packages/design-system/components/ui/table.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "table",
    "storyTitle": "Design System/Primitives/Table"
  },
  {
    "id": "table-grid-header",
    "label": "Table Grid Header",
    "sourcePath": "packages/design-system/components/ui/table-grid-header.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "table-grid-header",
    "storyTitle": "Design System/Primitives/Table Grid Header"
  },
  {
    "id": "table-view-menu",
    "label": "Table View Menu",
    "sourcePath": "packages/design-system/components/ui/table-view-menu.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "table-view-menu",
    "storyTitle": "Design System/Primitives/Table View Menu"
  },
  {
    "id": "tabs",
    "label": "Tabs",
    "sourcePath": "packages/design-system/components/ui/tabs.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "tabs",
    "storyTitle": "Design System/Primitives/Tabs"
  },
  {
    "id": "terminal-block",
    "label": "Terminal Block",
    "sourcePath": "packages/design-system/components/ui/primitives/terminal-block.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "terminal-block",
    "storyTitle": "Design System/Primitives/Terminal Block"
  },
  {
    "id": "textarea",
    "label": "Textarea",
    "sourcePath": "packages/design-system/components/ui/textarea.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "textarea",
    "storyTitle": "Design System/Primitives/Textarea"
  },
  {
    "id": "thinking-block",
    "label": "Thinking Block",
    "sourcePath": "packages/design-system/components/ui/primitives/thinking-block.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "thinking-block",
    "storyTitle": "Design System/Primitives/Thinking Block"
  },
  {
    "id": "toggle",
    "label": "Toggle",
    "sourcePath": "packages/design-system/components/ui/toggle.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "toggle",
    "storyTitle": "Design System/Primitives/Toggle"
  },
  {
    "id": "toggle-group",
    "label": "Toggle Group",
    "sourcePath": "packages/design-system/components/ui/toggle-group.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "toggle-group",
    "storyTitle": "Design System/Primitives/Toggle Group"
  },
  {
    "id": "tool-call-block",
    "label": "Tool Call Block",
    "sourcePath": "packages/design-system/components/ui/primitives/tool-call-block.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "tool-call-block",
    "storyTitle": "Design System/Primitives/Tool Call Block"
  },
  {
    "id": "tool-data-view",
    "label": "Tool Data View",
    "sourcePath": "packages/design-system/components/ui/primitives/tool-data-view.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "tool-data-view",
    "storyTitle": "Design System/Primitives/Tool Data View"
  },
  {
    "id": "tool-result-block",
    "label": "Tool Result Block",
    "sourcePath": "packages/design-system/components/ui/primitives/tool-result-block.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "tool-result-block",
    "storyTitle": "Design System/Primitives/Tool Result Block"
  },
  {
    "id": "tooltip",
    "label": "Tooltip",
    "sourcePath": "packages/design-system/components/ui/tooltip.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "tooltip",
    "storyTitle": "Design System/Primitives/Tooltip"
  },
  {
    "id": "underline-tabs",
    "label": "Underline Tabs",
    "sourcePath": "packages/design-system/components/ui/primitives/underline-tabs.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "underline-tabs",
    "storyTitle": "Design System/Primitives/Underline Tabs"
  },
  {
    "id": "unified-diff",
    "label": "Unified Diff",
    "sourcePath": "packages/design-system/components/ui/primitives/unified-diff.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "unified-diff",
    "storyTitle": "Design System/Primitives/Unified Diff"
  },
  {
    "id": "user-select-popover",
    "label": "User Select Popover",
    "sourcePath": "packages/design-system/components/ui/user-select-popover.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "user-select-popover",
    "storyTitle": "Design System/Primitives/User Select Popover"
  },
  {
    "id": "user-usage-table",
    "label": "User Usage Table",
    "sourcePath": "packages/design-system/components/ui/user-usage-table.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "user-usage-table",
    "storyTitle": "Design System/Primitives/User Usage Table"
  },
  {
    "id": "version-actions-toolbar",
    "label": "Version Actions Toolbar",
    "sourcePath": "packages/design-system/components/ui/version-actions-toolbar.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "version-actions-toolbar",
    "storyTitle": "Design System/Primitives/Version Actions Toolbar"
  },
  {
    "id": "workflow-stat-tile",
    "label": "Workflow Stat Tile",
    "sourcePath": "packages/design-system/components/ui/primitives/workflow-stat-tile.tsx",
    "section": "Design System",
    "pathSegments": [
      "Primitives"
    ],
    "storyId": "workflow-stat-tile",
    "storyTitle": "Design System/Primitives/Workflow Stat Tile"
  },
  {
    "id": "kanban-board",
    "label": "Kanban Board",
    "sourcePath": "packages/design-system/components/ui/layout/kanban-board.tsx",
    "section": "Design System",
    "pathSegments": [
      "Layout"
    ],
    "storyId": "kanban-board",
    "storyTitle": "Design System/Layout/Kanban Board"
  },
  {
    "id": "section",
    "label": "Section",
    "sourcePath": "packages/design-system/components/ui/layout/section.tsx",
    "section": "Design System",
    "pathSegments": [
      "Layout"
    ],
    "storyId": "section",
    "storyTitle": "Design System/Layout/Section"
  },
  {
    "id": "session-table",
    "label": "Session Table",
    "sourcePath": "packages/design-system/components/ui/composites/session-table.tsx",
    "section": "Design System",
    "pathSegments": [
      "Data Display"
    ],
    "storyId": "session-table",
    "storyTitle": "Design System/Data Display/Session Table"
  },
  {
    "id": "sessions-controls",
    "label": "Sessions Controls",
    "sourcePath": "packages/design-system/components/ui/composites/sessions-controls.tsx",
    "section": "Design System",
    "pathSegments": [
      "Data Display"
    ],
    "storyId": "sessions-controls",
    "storyTitle": "Design System/Data Display/Sessions Controls"
  }
];
var appComponentCatalog = [];
var storybookComponentCatalog = [
  ...designSystemComponentCatalog,
  ...appComponentCatalog
];
function hasStory(entry) {
  return Boolean(entry.storyId) && !entry.internal;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  appComponentCatalog,
  canonicalStorybookRoots,
  designSystemComponentCatalog,
  hasStory,
  storybookComponentCatalog
});
//# sourceMappingURL=component-catalog.js.map