import type { BlockDefinition, BlockType } from "@/lib/types/canvas";

export const BLOCK_DEFINITIONS: BlockDefinition[] = [
  {
    type: "key_partnerships",
    bmcLabel: "Key Partners",
    leanLabel: "Problem",
    gridCol: "1 / 3",
    gridRow: "1 / 3",
    tooltip: {
      bmc: "Who helps you deliver value? Map out your key suppliers and strategic partners.",
      lean: "What are the top 3 problems your customers face? Identify the pain points.",
      ai: "AI analyzes partner synergies and flags potential gaps in your network.",
    },
  },
  {
    type: "key_activities",
    bmcLabel: "Key Activities",
    leanLabel: "Solution",
    gridCol: "3 / 5",
    gridRow: "1 / 2",
    tooltip: {
      bmc: "What critical tasks must your business perform to succeed and deliver its value?",
      lean: "What is your top-level solution? Summarize how you solve the customer problems.",
      ai: "AI suggests process optimizations and identifies mission-critical activities.",
    },
  },
  {
    type: "key_resources",
    bmcLabel: "Key Resources",
    leanLabel: "Key Metrics",
    gridCol: "3 / 5",
    gridRow: "2 / 3",
    tooltip: {
      bmc: "What physical, human, or intellectual assets does your business model require?",
      lean: "What are the key numbers that tell you how your business is actually doing?",
      ai: "AI maps resource requirements and suggests essential metrics for tracking.",
    },
  },
  {
    type: "value_prop",
    bmcLabel: "Value Propositions",
    leanLabel: "Unique Value Proposition",
    gridCol: "5 / 7",
    gridRow: "1 / 3",
    tooltip: {
      bmc: "What unique value are you delivering? Why should customers choose you over others?",
      lean: "What is your single, clear, compelling message that states why you are different.",
      ai: "AI refines your messaging and highlights your unique competitive edge.",
    },
  },
  {
    type: "customer_relationships",
    bmcLabel: "Customer Relationships",
    leanLabel: "Unfair Advantage",
    gridCol: "7 / 9",
    gridRow: "1 / 2",
    tooltip: {
      bmc: "How do you interact with customers? Define your service and retention style.",
      lean: "What do you have that cannot be easily copied or bought by competitors?",
      ai: "AI evaluates retention strategies and identifies defensive moats.",
    },
  },
  {
    type: "channels",
    bmcLabel: "Channels",
    leanLabel: null,
    gridCol: "7 / 9",
    gridRow: "2 / 3",
    tooltip: {
      bmc: "How do you reach your customers? Define distribution and sales touchpoints.",
      lean: "How do you reach your customers? Define distribution and sales touchpoints.",
      ai: "AI simulates channel effectiveness and suggests optimal reach strategies.",
    },
  },
  {
    type: "customer_segments",
    bmcLabel: "Customer Segments",
    leanLabel: null,
    gridCol: "9 / 11",
    gridRow: "1 / 3",
    tooltip: {
      bmc: "Who are your customers? Define the specific groups you aim to reach and serve.",
      lean: "Who are your customers? Define the specific groups you aim to reach and serve.",
      ai: "AI builds TAM/SAM/SOM models, segments, and detailed personas.",
    },
  },
  {
    type: "cost_structure",
    bmcLabel: "Cost Structure",
    leanLabel: null,
    gridCol: "1 / 6",
    gridRow: "3 / 4",
    tooltip: {
      bmc: "What are your biggest costs? Identify fixed and variable expenses to run the business.",
      lean: "What are your biggest costs? Identify fixed and variable expenses to run the business.",
      ai: "AI flags hidden costs and suggests ways to optimize your burn rate.",
    },
  },
  {
    type: "revenue_streams",
    bmcLabel: "Revenue Streams",
    leanLabel: null,
    gridCol: "6 / 11",
    gridRow: "3 / 4",
    tooltip: {
      bmc: "How does your business make money? Define your pricing and payment models.",
      lean: "How does your business make money? Define your pricing and payment models.",
      ai: "AI explores pricing models and validates revenue scalability.",
    },
  },
];

/** Blocks with leanLabel: null share content between BMC and Lean modes */
export function isSharedBlock(blockType: BlockType): boolean {
  const def = BLOCK_DEFINITIONS.find((d) => d.type === blockType);
  return def?.leanLabel === null;
}

/** Get the display value for a block, respecting shared blocks */
export function getBlockValue(
  content: { bmc: string; lean: string },
  blockType: BlockType,
  mode: "bmc" | "lean",
): string {
  return isSharedBlock(blockType)
    ? content.bmc
    : mode === "lean"
      ? content.lean
      : content.bmc;
}

/**
 * Zone tint per block. The BMC already groups its nine blocks into four
 * zones — infrastructure on the left, the value proposition at the hinge,
 * the customer on the right, money along the bottom — so the colour encodes
 * that structure rather than just labelling nine boxes differently.
 *
 * Kept as a tint, not a fill: state colours (healthy/warning/critical) still
 * need to outrank zone colour when a block goes fragile.
 */
export const BLOCK_ZONE_COLOR: Record<BlockType, string> = {
  key_partnerships: "var(--chroma-indigo)",
  key_activities: "var(--chroma-indigo)",
  key_resources: "var(--chroma-indigo)",
  value_prop: "var(--chroma-amber)",
  customer_relationships: "var(--chroma-cyan)",
  channels: "var(--chroma-cyan)",
  customer_segments: "var(--chroma-cyan)",
  cost_structure: "var(--chroma-pink)",
  revenue_streams: "var(--chroma-pink)",
};
