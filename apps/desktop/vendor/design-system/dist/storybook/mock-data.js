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

// storybook/mock-data.ts
var mock_data_exports = {};
__export(mock_data_exports, {
  mockBackendMismatch: () => mockBackendMismatch,
  mockBrowserVisitors: () => mockBrowserVisitors,
  mockDashboardStats: () => mockDashboardStats,
  mockDocumentStatusOptions: () => mockDocumentStatusOptions,
  mockFeaturePriorityOptions: () => mockFeaturePriorityOptions,
  mockFriendlyError: () => mockFriendlyError,
  mockGitHubRepository: () => mockGitHubRepository,
  mockInvoiceRows: () => mockInvoiceRows,
  mockLoopCommandOptions: () => mockLoopCommandOptions,
  mockLoopStatusOptions: () => mockLoopStatusOptions,
  mockProjectRows: () => mockProjectRows,
  mockPullRequest: () => mockPullRequest,
  mockSidebarData: () => mockSidebarData,
  mockTrafficByMonth: () => mockTrafficByMonth,
  mockUsers: () => mockUsers,
  mockWorkstreamStateOptions: () => mockWorkstreamStateOptions,
  mockWorkstreamTypeOptions: () => mockWorkstreamTypeOptions
});
module.exports = __toCommonJS(mock_data_exports);
var import_common = require("@repo/api/src/types/common");
var import_document = require("@repo/api/src/types/document");
var import_loop = require("@repo/api/src/types/loop");
var import_workstream = require("@repo/api/src/types/workstream");
var import_lucide_react = require("lucide-react");
var mockUsers = [
  {
    id: "user-1",
    name: "Avery Carter",
    email: "avery@example.com",
    initials: "AC"
  },
  {
    id: "user-2",
    name: "Jordan Lee",
    email: "jordan@example.com",
    initials: "JL"
  },
  {
    id: "user-3",
    name: "Samir Patel",
    email: "samir@example.com",
    initials: "SP"
  }
];
var mockInvoiceRows = [
  {
    invoice: "INV001",
    paymentStatus: "Paid",
    totalAmount: "$250.00",
    paymentMethod: "Credit Card"
  },
  {
    invoice: "INV002",
    paymentStatus: "Pending",
    totalAmount: "$150.00",
    paymentMethod: "PayPal"
  },
  {
    invoice: "INV003",
    paymentStatus: "Unpaid",
    totalAmount: "$350.00",
    paymentMethod: "Bank Transfer"
  },
  {
    invoice: "INV004",
    paymentStatus: "Paid",
    totalAmount: "$450.00",
    paymentMethod: "Credit Card"
  }
];
var mockProjectRows = [
  {
    id: "project-1",
    name: "Billing v2",
    owner: "Avery Carter",
    status: "Active",
    updatedAt: "2026-05-24"
  },
  {
    id: "project-2",
    name: "Mobile onboarding",
    owner: "Jordan Lee",
    status: "Backlog",
    updatedAt: "2026-05-18"
  },
  {
    id: "project-3",
    name: "Usage reporting",
    owner: "Samir Patel",
    status: "Paused",
    updatedAt: "2026-05-12"
  },
  {
    id: "project-4",
    name: "Editor refresh",
    owner: "Avery Carter",
    status: "Active",
    updatedAt: "2026-05-27"
  },
  {
    id: "project-5",
    name: "Compute target audit",
    owner: "Jordan Lee",
    status: "Backlog",
    updatedAt: "2026-05-09"
  }
];
var mockTrafficByMonth = [
  { month: "January", desktop: 186, mobile: 80 },
  { month: "February", desktop: 305, mobile: 200 },
  { month: "March", desktop: 237, mobile: 120 },
  { month: "April", desktop: 73, mobile: 190 },
  { month: "May", desktop: 209, mobile: 130 },
  { month: "June", desktop: 214, mobile: 140 }
];
var mockBrowserVisitors = [
  { browser: "chrome", visitors: 275, fill: "var(--color-chrome)" },
  { browser: "safari", visitors: 200, fill: "var(--color-safari)" },
  { browser: "other", visitors: 190, fill: "var(--color-other)" }
];
var mockSidebarData = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg"
  },
  teams: [
    {
      name: "Acme Inc",
      logo: import_lucide_react.GalleryVerticalEnd,
      plan: "Enterprise"
    },
    {
      name: "Acme Corp.",
      logo: import_lucide_react.AudioWaveform,
      plan: "Startup"
    },
    {
      name: "Evil Corp.",
      logo: import_lucide_react.Command,
      plan: "Free"
    }
  ],
  navMain: [
    {
      title: "Playground",
      url: "#",
      icon: import_lucide_react.SquareTerminal,
      isActive: true,
      items: [
        {
          title: "History",
          url: "#"
        },
        {
          title: "Starred",
          url: "#"
        },
        {
          title: "Settings",
          url: "#"
        }
      ]
    },
    {
      title: "Models",
      url: "#",
      icon: import_lucide_react.Bot,
      items: [
        {
          title: "Genesis",
          url: "#"
        },
        {
          title: "Explorer",
          url: "#"
        },
        {
          title: "Quantum",
          url: "#"
        }
      ]
    },
    {
      title: "Documentation",
      url: "#",
      icon: import_lucide_react.BookOpen,
      items: [
        {
          title: "Introduction",
          url: "#"
        },
        {
          title: "Get Started",
          url: "#"
        },
        {
          title: "Tutorials",
          url: "#"
        },
        {
          title: "Changelog",
          url: "#"
        }
      ]
    },
    {
      title: "Settings",
      url: "#",
      icon: import_lucide_react.Settings2,
      items: [
        {
          title: "General",
          url: "#"
        },
        {
          title: "Team",
          url: "#"
        },
        {
          title: "Billing",
          url: "#"
        },
        {
          title: "Limits",
          url: "#"
        }
      ]
    }
  ],
  projects: [
    {
      name: "Design Engineering",
      url: "#",
      icon: import_lucide_react.Frame
    },
    {
      name: "Sales & Marketing",
      url: "#",
      icon: import_lucide_react.PieChart
    },
    {
      name: "Developer Docs",
      url: "#",
      icon: import_lucide_react.Command
    }
  ]
};
var mockDashboardStats = {
  prds: {
    count: 42,
    trend: [
      { date: "2026-05-14", count: 28 },
      { date: "2026-05-16", count: 31 },
      { date: "2026-05-18", count: 35 },
      { date: "2026-05-20", count: 37 },
      { date: "2026-05-22", count: 39 },
      { date: "2026-05-24", count: 40 },
      { date: "2026-05-27", count: 42 }
    ]
  },
  features: {
    count: 118,
    trend: [
      { date: "2026-05-14", count: 89 },
      { date: "2026-05-16", count: 93 },
      { date: "2026-05-18", count: 96 },
      { date: "2026-05-20", count: 104 },
      { date: "2026-05-22", count: 108 },
      { date: "2026-05-24", count: 112 },
      { date: "2026-05-27", count: 118 }
    ]
  },
  plans: {
    count: 76,
    trend: [
      { date: "2026-05-14", count: 52 },
      { date: "2026-05-16", count: 56 },
      { date: "2026-05-18", count: 61 },
      { date: "2026-05-20", count: 66 },
      { date: "2026-05-22", count: 70 },
      { date: "2026-05-24", count: 73 },
      { date: "2026-05-27", count: 76 }
    ]
  },
  landedCode: {
    count: 24,
    trend: [
      { date: "2026-05-14", count: 10 },
      { date: "2026-05-16", count: 12 },
      { date: "2026-05-18", count: 13 },
      { date: "2026-05-20", count: 17 },
      { date: "2026-05-22", count: 20 },
      { date: "2026-05-24", count: 22 },
      { date: "2026-05-27", count: 24 }
    ]
  },
  agenticWorkflows: {
    count: 19,
    trend: [
      { date: "2026-05-14", count: 7 },
      { date: "2026-05-16", count: 9 },
      { date: "2026-05-18", count: 11 },
      { date: "2026-05-20", count: 13 },
      { date: "2026-05-22", count: 15 },
      { date: "2026-05-24", count: 17 },
      { date: "2026-05-27", count: 19 }
    ]
  },
  agentsCount: 8,
  leaderboardsCount: 3
};
var mockBackendMismatch = {
  error: "backend_mismatch",
  message: "Artifact was last run on a different compute target.",
  originalComputeTargetId: "ct-original",
  originalComputeTargetName: "Local GPU Runner",
  preferredComputeTargetId: "ct-preferred",
  documentId: "doc-42"
};
var mockFriendlyError = {
  code: import_loop.LoopErrorCode.RunnerError,
  message: "Claude CLI exited before the loop completed.",
  details: {
    runnerSubcode: "CLAUDE_RATE_LIMIT",
    repoPath: "/Users/example/repo"
  },
  timestamp: "2026-05-28T14:32:00.000Z"
};
var mockGitHubRepository = {
  id: "repo-1",
  fullName: "closedloop-ai/symphony-alpha",
  name: "symphony-alpha",
  owner: "closedloop-ai",
  private: true,
  githubRepoId: "123456789",
  lastPushedAt: "2026-05-27T15:45:00.000Z"
};
var mockPullRequest = {
  id: "pr-1",
  number: 1323,
  title: "Catalog app-owned composites in Storybook",
  htmlUrl: "https://github.com/closedloop-ai/symphony-alpha/pull/1323",
  state: import_document.PullRequestState.Open,
  isDraft: false,
  headBranch: "feat/design-system-storybook-catalog",
  baseBranch: "main",
  createdAt: /* @__PURE__ */ new Date("2026-05-28T12:00:00.000Z"),
  checksStatus: null,
  reviewDecision: null,
  externalLinkId: null,
  repoFullName: "closedloop-ai/symphony-alpha"
};
var mockDocumentStatusOptions = [
  import_document.DocumentStatus.Draft,
  import_document.DocumentStatus.InProgress,
  import_document.DocumentStatus.InReview,
  import_document.DocumentStatus.Approved,
  import_document.DocumentStatus.Executed,
  import_document.DocumentStatus.Done,
  import_document.DocumentStatus.Obsolete
];
var mockFeaturePriorityOptions = [
  import_common.Priority.Low,
  import_common.Priority.Medium,
  import_common.Priority.High,
  import_common.Priority.Urgent
];
var mockWorkstreamStateOptions = import_workstream.WORKSTREAM_STATE_OPTIONS;
var mockWorkstreamTypeOptions = import_workstream.WORKSTREAM_TYPE_OPTIONS;
var mockLoopStatusOptions = [
  import_loop.LoopStatus.Pending,
  import_loop.LoopStatus.Running,
  import_loop.LoopStatus.Completed,
  import_loop.LoopStatus.Failed,
  import_loop.LoopStatus.Cancelled
];
var mockLoopCommandOptions = [
  import_loop.LoopCommand.Plan,
  import_loop.LoopCommand.Execute,
  import_loop.LoopCommand.Chat,
  import_loop.LoopCommand.Explore,
  import_loop.LoopCommand.EvaluateCode
];
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  mockBackendMismatch,
  mockBrowserVisitors,
  mockDashboardStats,
  mockDocumentStatusOptions,
  mockFeaturePriorityOptions,
  mockFriendlyError,
  mockGitHubRepository,
  mockInvoiceRows,
  mockLoopCommandOptions,
  mockLoopStatusOptions,
  mockProjectRows,
  mockPullRequest,
  mockSidebarData,
  mockTrafficByMonth,
  mockUsers,
  mockWorkstreamStateOptions,
  mockWorkstreamTypeOptions
});
//# sourceMappingURL=mock-data.js.map