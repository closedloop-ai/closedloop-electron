import { ClassValue } from 'clsx';

declare const cn: (...inputs: ClassValue[]) => string;
declare const capitalize: (str: string) => string;
declare const handleError: (error: unknown) => void;

export { capitalize, cn, handleError };
