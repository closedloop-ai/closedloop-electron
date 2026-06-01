import * as React from 'react';
import { ReactNode } from 'react';

type ThemeProviderProperties = {
    children: ReactNode;
    themes?: string[];
    forcedTheme?: string;
    nonce?: string;
    enableSystem?: boolean;
    disableTransitionOnChange?: boolean;
    enableColorScheme?: boolean;
    storageKey?: string;
    defaultTheme?: string;
    attribute?: string | string[];
    value?: Record<string, string>;
};
declare const ThemeProvider: ({ children, ...properties }: ThemeProviderProperties) => React.JSX.Element;

export { ThemeProvider };
