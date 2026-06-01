import * as React from 'react';
import { ToasterProps } from 'sonner';
export { toast } from 'sonner';

declare const Toaster: ({ ...props }: ToasterProps) => React.JSX.Element;

export { Toaster };
