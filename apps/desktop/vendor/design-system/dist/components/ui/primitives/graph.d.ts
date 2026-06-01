import * as React from 'react';

type GraphNode = {
    id: string;
    label?: string;
    value: number;
    color?: string;
    strokeColor?: string;
};
type GraphLink = {
    source: string;
    target: string;
    weight: number;
    label?: string;
};
type TooltipRow = {
    label: string;
    value: string;
};
type GraphProps = {
    nodes: GraphNode[];
    links: GraphLink[];
    ariaLabel?: string;
    emptyMessage?: string;
    legendLabel?: string;
    edgeLegendLabel?: string;
    getNodeRows?: (node: GraphNode) => TooltipRow[];
    getLinkRows?: (link: GraphLink, source: GraphNode, target: GraphNode) => TooltipRow[];
    getNodeDescription?: (node: GraphNode) => string | undefined;
    getLinkDescription?: (link: GraphLink, source: GraphNode, target: GraphNode) => string | undefined;
};
declare function Graph({ nodes, links, ariaLabel, emptyMessage, legendLabel, edgeLegendLabel, getNodeRows, getLinkRows, getNodeDescription, getLinkDescription, }: GraphProps): React.JSX.Element;

export { Graph };
