import { LucideIcon } from 'lucide-react';

type MockUser = {
    id: string;
    name: string;
    email?: string;
    avatarUrl?: string;
    initials?: string;
};
declare const mockUsers: MockUser[];
declare const mockInvoiceRows: {
    invoice: string;
    paymentStatus: string;
    totalAmount: string;
    paymentMethod: string;
}[];
type MockProjectRow = {
    id: string;
    name: string;
    owner: string;
    status: "Backlog" | "Active" | "Paused";
    updatedAt: string;
};
declare const mockProjectRows: MockProjectRow[];
declare const mockTrafficByMonth: {
    month: string;
    desktop: number;
    mobile: number;
}[];
declare const mockBrowserVisitors: {
    browser: string;
    visitors: number;
    fill: string;
}[];
type MockSidebarTeam = {
    name: string;
    logo: LucideIcon;
    plan: string;
};
type MockSidebarLink = {
    title: string;
    url: string;
};
type MockSidebarGroup = {
    title: string;
    url: string;
    icon: LucideIcon;
    isActive?: boolean;
    items: MockSidebarLink[];
};
type MockSidebarProject = {
    name: string;
    url: string;
    icon: LucideIcon;
};
declare const mockSidebarData: {
    user: {
        name: string;
        email: string;
        avatar: string;
    };
    teams: MockSidebarTeam[];
    navMain: MockSidebarGroup[];
    projects: MockSidebarProject[];
};
declare const mockDashboardStats: {
    prds: {
        count: number;
        trend: {
            date: string;
            count: number;
        }[];
    };
    features: {
        count: number;
        trend: {
            date: string;
            count: number;
        }[];
    };
    plans: {
        count: number;
        trend: {
            date: string;
            count: number;
        }[];
    };
    landedCode: {
        count: number;
        trend: {
            date: string;
            count: number;
        }[];
    };
    agenticWorkflows: {
        count: number;
        trend: {
            date: string;
            count: number;
        }[];
    };
    agentsCount: number;
    leaderboardsCount: number;
};
declare const mockBackendMismatch: {
    error: "backend_mismatch";
    message: string;
    originalComputeTargetId: string;
    originalComputeTargetName: string;
    preferredComputeTargetId: string;
    documentId: string;
};
declare const mockFriendlyError: {
    code: "RUNNER_ERROR";
    message: string;
    details: {
        runnerSubcode: string;
        repoPath: string;
    };
    timestamp: string;
};
declare const mockGitHubRepository: {
    id: string;
    fullName: string;
    name: string;
    owner: string;
    private: true;
    githubRepoId: string;
    lastPushedAt: string;
};
declare const mockPullRequest: {
    id: string;
    number: number;
    title: string;
    htmlUrl: string;
    state: "OPEN";
    isDraft: false;
    headBranch: string;
    baseBranch: string;
    createdAt: Date;
    checksStatus: null;
    reviewDecision: null;
    externalLinkId: null;
    repoFullName: string;
};
declare const mockDocumentStatusOptions: readonly ["DRAFT", "IN_PROGRESS", "IN_REVIEW", "APPROVED", "EXECUTED", "DONE", "OBSOLETE"];
declare const mockFeaturePriorityOptions: readonly ["LOW", "MEDIUM", "HIGH", "URGENT"];
declare const mockWorkstreamStateOptions: readonly ["INITIATED", "REQUIREMENTS_GENERATING", "REQUIREMENTS_PENDING_APPROVAL", "DESIGN_IN_PROGRESS", "DESIGN_PENDING_APPROVAL", "IMPLEMENTATION_PLANNING", "IMPLEMENTATION_IN_PROGRESS", "IMPLEMENTATION_PENDING_REVIEW", "CODE_REVIEW_RUNNING", "CODE_REVIEW_PENDING_APPROVAL", "VISUAL_QA_RUNNING", "VISUAL_QA_PENDING_APPROVAL", "MERGING", "DEPLOYED", "COMPLETED", "BLOCKED", "CANCELLED"];
declare const mockWorkstreamTypeOptions: readonly ["FEATURE_DELIVERY", "BUG_FIX", "TECH_DEBT", "SPIKE"];
declare const mockLoopStatusOptions: readonly ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"];
declare const mockLoopCommandOptions: readonly ["PLAN", "EXECUTE", "CHAT", "EXPLORE", "EVALUATE_CODE"];

export { type MockProjectRow, type MockUser, mockBackendMismatch, mockBrowserVisitors, mockDashboardStats, mockDocumentStatusOptions, mockFeaturePriorityOptions, mockFriendlyError, mockGitHubRepository, mockInvoiceRows, mockLoopCommandOptions, mockLoopStatusOptions, mockProjectRows, mockPullRequest, mockSidebarData, mockTrafficByMonth, mockUsers, mockWorkstreamStateOptions, mockWorkstreamTypeOptions };
