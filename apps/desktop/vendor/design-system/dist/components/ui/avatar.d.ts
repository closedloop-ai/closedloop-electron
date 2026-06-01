import * as React from 'react';
import { Avatar as Avatar$1 } from 'radix-ui';

declare function Avatar({ className, ...props }: React.ComponentProps<typeof Avatar$1.Root>): React.JSX.Element;
declare function AvatarImage({ className, ...props }: React.ComponentProps<typeof Avatar$1.Image>): React.JSX.Element;
declare function AvatarFallback({ className, ...props }: React.ComponentProps<typeof Avatar$1.Fallback>): React.JSX.Element;

export { Avatar, AvatarFallback, AvatarImage };
