import * as React from 'react';
import { ComponentProps, ReactNode } from 'react';
import { ThemeProvider } from './providers/theme.js';

type DesignSystemProviderProperties = ComponentProps<typeof ThemeProvider> & {
    children: ReactNode;
};
declare const DesignSystemProvider: ({ children, ...properties }: DesignSystemProviderProperties) => React.JSX.Element;

export { DesignSystemProvider };
