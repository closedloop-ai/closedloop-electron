import React from "react";
"use client";
import {
  CodeBlock
} from "../../../chunk-BPFSJREZ.mjs";
import "../../../chunk-L5AZJM2L.mjs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../chunk-XQL5M77A.mjs";
import {
  Label
} from "../../../chunk-U7KVRX5X.mjs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../../chunk-6LPHEING.mjs";
import {
  Button
} from "../../../chunk-TT7DUYOP.mjs";
import "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-JHIJKM5E.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/composites/pack-install-dialog.tsx
function PackInstallDialog({
  open,
  pack,
  run,
  onOpenChange,
  onSelectProject,
  onClose,
  onRunCommand,
  onCopyCommand
}) {
  const isComplete = run.state === "complete";
  const projectAwareCommand = run.projectScoped && run.selectedProject ? `cd '${run.selectedProject.replace(/'/g, "'\\''")}' && ${run.command}` : run.command;
  return /* @__PURE__ */ React.createElement(Dialog, { onOpenChange, open }, /* @__PURE__ */ React.createElement(DialogContent, { className: "max-w-3xl" }, /* @__PURE__ */ React.createElement(DialogHeader, null, /* @__PURE__ */ React.createElement(DialogTitle, null, run.action === "install" ? "Install" : "Uninstall", " ", pack.displayName), /* @__PURE__ */ React.createElement(DialogDescription, null, "harness: ", run.harness, run.commandIsAutoDetect ? " \xB7 auto-detect enabled" : "", isComplete && typeof run.exitCode === "number" ? ` \xB7 exit ${run.exitCode}${run.reason ? ` (${run.reason})` : ""}` : "")), /* @__PURE__ */ React.createElement("div", { className: "space-y-4" }, run.projectScoped && run.projectOptions?.length ? /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement(Label, { htmlFor: "pack-project" }, "Project"), /* @__PURE__ */ React.createElement(
    Select,
    {
      onValueChange: (value) => onSelectProject?.(value),
      value: run.selectedProject
    },
    /* @__PURE__ */ React.createElement(SelectTrigger, { id: "pack-project" }, /* @__PURE__ */ React.createElement(SelectValue, null)),
    /* @__PURE__ */ React.createElement(SelectContent, null, run.projectOptions.map((project) => /* @__PURE__ */ React.createElement(SelectItem, { key: project, value: project }, project)))
  )) : null, /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("div", { className: "font-medium text-sm" }, "Command preview"), /* @__PURE__ */ React.createElement(CodeBlock, null, projectAwareCommand)), run.lines?.length ? /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement("div", { className: "font-medium text-sm" }, "Run output"), /* @__PURE__ */ React.createElement(CodeBlock, null, run.lines.join("\n"))) : null, run.postInstall ? /* @__PURE__ */ React.createElement("div", { className: "rounded-xl border border-border bg-muted/35 p-4" }, /* @__PURE__ */ React.createElement("div", { className: "font-medium text-sm" }, run.postInstall.title), /* @__PURE__ */ React.createElement("p", { className: "mt-2 text-muted-foreground text-sm" }, run.postInstall.body), run.postInstall.copyCommand ? /* @__PURE__ */ React.createElement("div", { className: "mt-3" }, /* @__PURE__ */ React.createElement(CodeBlock, null, run.postInstall.copyCommand)) : null) : null), /* @__PURE__ */ React.createElement(DialogFooter, null, /* @__PURE__ */ React.createElement(Button, { disabled: !onClose, onClick: onClose, variant: "outline" }, "Close"), /* @__PURE__ */ React.createElement(
    Button,
    {
      disabled: run.projectScoped ? !onCopyCommand : !onRunCommand,
      onClick: run.projectScoped ? onCopyCommand : onRunCommand
    },
    run.projectScoped ? "Copy command" : "Run command"
  ))));
}
export {
  PackInstallDialog
};
//# sourceMappingURL=pack-install-dialog.mjs.map