import React from "react";
import {
  WorkflowStatTile
} from "../../../chunk-TRXG43D7.mjs";
import {
  RankedBar
} from "../../../chunk-DAD37JSY.mjs";
import {
  Section
} from "../../../chunk-ZF7NKEIL.mjs";
import "../../../chunk-OBV5RENT.mjs";
import "../../../chunk-3I7NW6GS.mjs";
import "../../../chunk-ZKMGHYX7.mjs";
import {
  formatCompactNumber
} from "../../../chunk-UGNO5UUO.mjs";
import "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/composites/compaction-impact.tsx
import { RefreshCcw } from "lucide-react";
function CompactionImpact({
  data
}) {
  const maxCompactions = Math.max(
    ...data.perSession.map((item) => item.compactions),
    1
  );
  return /* @__PURE__ */ React.createElement(
    Section,
    {
      contentClassName: "space-y-4",
      description: "Context-compaction recovery surfaced as reusable stat tiles and ranked bars.",
      title: "Compaction impact"
    },
    /* @__PURE__ */ React.createElement("div", { className: "grid gap-4 md:grid-cols-2" }, /* @__PURE__ */ React.createElement(
      WorkflowStatTile,
      {
        description: "Observed across decomposed workflow traces",
        icon: RefreshCcw,
        label: "Total compactions",
        value: formatCompactNumber(data.totalCompactions)
      }
    ), /* @__PURE__ */ React.createElement(
      WorkflowStatTile,
      {
        description: `${data.sessionsWithCompactions} of ${data.totalSessions} sessions compacted`,
        icon: RefreshCcw,
        label: "Recovered tokens",
        value: formatCompactNumber(data.tokensRecovered)
      }
    )),
    /* @__PURE__ */ React.createElement("div", { className: "space-y-3" }, data.perSession.map((item) => /* @__PURE__ */ React.createElement(
      RankedBar,
      {
        key: item.sessionId,
        label: item.sessionId,
        percent: item.compactions / maxCompactions * 100,
        value: item.compactions
      }
    )))
  );
}
export {
  CompactionImpact
};
//# sourceMappingURL=compaction-impact.mjs.map