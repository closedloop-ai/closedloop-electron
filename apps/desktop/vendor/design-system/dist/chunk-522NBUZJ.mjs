// lib/utils.ts
import { clsx } from "clsx";
import { toast } from "sonner";
import { twMerge } from "tailwind-merge";
var cn = (...inputs) => twMerge(clsx(inputs));
var capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);
var parseError = (error) => {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
};
var handleError = (error) => {
  const message = parseError(error);
  toast.error(message);
};

export {
  cn,
  capitalize,
  handleError
};
//# sourceMappingURL=chunk-522NBUZJ.mjs.map