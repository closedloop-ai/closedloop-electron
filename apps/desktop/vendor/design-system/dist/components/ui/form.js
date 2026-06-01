var React = require("react");
"use strict";
"use client";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// components/ui/form.tsx
var form_exports = {};
__export(form_exports, {
  Form: () => Form,
  FormControl: () => FormControl,
  FormDescription: () => FormDescription,
  FormField: () => FormField,
  FormItem: () => FormItem,
  FormLabel: () => FormLabel,
  FormMessage: () => FormMessage,
  useFormField: () => useFormField
});
module.exports = __toCommonJS(form_exports);
var React2 = __toESM(require("react"));
var import_radix_ui2 = require("radix-ui");
var import_react_hook_form = require("react-hook-form");

// lib/utils.ts
var import_clsx = require("clsx");
var import_sonner = require("sonner");
var import_tailwind_merge = require("tailwind-merge");
var cn = (...inputs) => (0, import_tailwind_merge.twMerge)((0, import_clsx.clsx)(inputs));

// components/ui/label.tsx
var React = __toESM(require("react"));
var import_radix_ui = require("radix-ui");
function Label({
  className,
  ...props
}) {
  return /* @__PURE__ */ React.createElement(
    import_radix_ui.Label.Root,
    {
      "data-slot": "label",
      className: cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      ),
      ...props
    }
  );
}

// components/ui/form.tsx
var Form = import_react_hook_form.FormProvider;
var FormFieldContext = React2.createContext(
  {}
);
var FormField = ({
  ...props
}) => {
  return /* @__PURE__ */ React2.createElement(FormFieldContext.Provider, { value: { name: props.name } }, /* @__PURE__ */ React2.createElement(import_react_hook_form.Controller, { ...props }));
};
var useFormField = () => {
  const fieldContext = React2.useContext(FormFieldContext);
  const itemContext = React2.useContext(FormItemContext);
  const { getFieldState } = (0, import_react_hook_form.useFormContext)();
  const formState = (0, import_react_hook_form.useFormState)({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);
  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>");
  }
  const { id } = itemContext;
  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState
  };
};
var FormItemContext = React2.createContext(
  {}
);
function FormItem({ className, ...props }) {
  const id = React2.useId();
  return /* @__PURE__ */ React2.createElement(FormItemContext.Provider, { value: { id } }, /* @__PURE__ */ React2.createElement(
    "div",
    {
      "data-slot": "form-item",
      className: cn("grid gap-2", className),
      ...props
    }
  ));
}
function FormLabel({
  className,
  ...props
}) {
  const { error, formItemId } = useFormField();
  return /* @__PURE__ */ React2.createElement(
    Label,
    {
      "data-slot": "form-label",
      "data-error": !!error,
      className: cn("data-[error=true]:text-destructive", className),
      htmlFor: formItemId,
      ...props
    }
  );
}
function FormControl({ ...props }) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  return /* @__PURE__ */ React2.createElement(
    import_radix_ui2.Slot.Slot,
    {
      "data-slot": "form-control",
      id: formItemId,
      "aria-describedby": !error ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`,
      "aria-invalid": !!error,
      ...props
    }
  );
}
function FormDescription({ className, ...props }) {
  const { formDescriptionId } = useFormField();
  return /* @__PURE__ */ React2.createElement(
    "p",
    {
      "data-slot": "form-description",
      id: formDescriptionId,
      className: cn("text-muted-foreground text-sm", className),
      ...props
    }
  );
}
function FormMessage({ className, ...props }) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error?.message ?? "") : props.children;
  if (!body) {
    return null;
  }
  return /* @__PURE__ */ React2.createElement(
    "p",
    {
      "data-slot": "form-message",
      id: formMessageId,
      className: cn("text-destructive text-sm", className),
      ...props
    },
    body
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField
});
//# sourceMappingURL=form.js.map