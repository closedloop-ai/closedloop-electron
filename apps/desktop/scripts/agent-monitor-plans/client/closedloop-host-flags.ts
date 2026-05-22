const PLAN_EXTRACTION_QUERY_PARAM = "closedloop_plan_extraction";
const PLAN_EXTRACTION_STORAGE_KEY = "closedloop:plan-extraction-enabled";

export function isPlanExtractionEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const explicit = params.get(PLAN_EXTRACTION_QUERY_PARAM);
    if (explicit === "1" || explicit === "true") {
      window.sessionStorage.setItem(PLAN_EXTRACTION_STORAGE_KEY, "1");
      return true;
    }
    if (explicit === "0" || explicit === "false") {
      window.sessionStorage.removeItem(PLAN_EXTRACTION_STORAGE_KEY);
      return false;
    }
    return window.sessionStorage.getItem(PLAN_EXTRACTION_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
