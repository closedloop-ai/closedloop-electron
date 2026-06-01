import * as React$1 from 'react';

type MetadataPanelProps = {
    title?: string;
    children: React.ReactNode;
    className?: string;
    variant?: "bar" | "sidebar";
};
declare function MetadataPanel({ title, children, className, variant, }: Readonly<MetadataPanelProps>): React$1.JSX.Element;
type MetadataSectionProps = {
    children: React.ReactNode;
    separator?: boolean;
    className?: string;
    layout?: "horizontal" | "vertical";
};
declare function MetadataSection({ children, separator, className, layout, }: Readonly<MetadataSectionProps>): React$1.JSX.Element;
type TabDefinition = {
    id: string;
    label: string;
    content: React.ReactNode;
};
type TabbedMetadataPanelProps = {
    tabs: TabDefinition[];
    className?: string;
    defaultTab?: string;
};
declare function TabbedMetadataPanel({ tabs, className, defaultTab, }: Readonly<TabbedMetadataPanelProps>): React$1.JSX.Element;

export { MetadataPanel, MetadataSection, TabbedMetadataPanel };
