import * as React from 'react';
import { ComponentProps } from 'react';
import { TabsList, TabsTrigger } from '../tabs.js';
import 'radix-ui';

declare function UnderlineTabsList({ className, ...props }: ComponentProps<typeof TabsList>): React.JSX.Element;
declare function UnderlineTabsTrigger({ className, ...props }: ComponentProps<typeof TabsTrigger>): React.JSX.Element;

export { UnderlineTabsList, UnderlineTabsTrigger };
