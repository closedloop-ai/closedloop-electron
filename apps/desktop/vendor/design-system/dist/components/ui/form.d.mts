import * as react_hook_form from 'react-hook-form';
import { FieldValues, FieldPath, ControllerProps } from 'react-hook-form';
import * as React from 'react';
import { Slot, Label } from 'radix-ui';

declare const Form: <TFieldValues extends FieldValues, TContext = any, TTransformedValues = TFieldValues>(props: react_hook_form.FormProviderProps<TFieldValues, TContext, TTransformedValues>) => React.JSX.Element;
declare const FormField: <TFieldValues extends FieldValues = FieldValues, TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>>({ ...props }: ControllerProps<TFieldValues, TName>) => React.JSX.Element;
declare const useFormField: () => {
    invalid: boolean;
    isDirty: boolean;
    isTouched: boolean;
    isValidating: boolean;
    error?: react_hook_form.FieldError;
    id: string;
    name: string;
    formItemId: string;
    formDescriptionId: string;
    formMessageId: string;
};
declare function FormItem({ className, ...props }: React.ComponentProps<"div">): React.JSX.Element;
declare function FormLabel({ className, ...props }: React.ComponentProps<typeof Label.Root>): React.JSX.Element;
declare function FormControl({ ...props }: React.ComponentProps<typeof Slot.Slot>): React.JSX.Element;
declare function FormDescription({ className, ...props }: React.ComponentProps<"p">): React.JSX.Element;
declare function FormMessage({ className, ...props }: React.ComponentProps<"p">): React.JSX.Element | null;

export { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage, useFormField };
