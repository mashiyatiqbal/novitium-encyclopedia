/* ==========================================================================
   Novitium Encyclopedia — content data
   Replace / extend these arrays to add real documents and glossary entries.
   ========================================================================== */

const CATEGORIES = [
  "Solar PV",
  "Energy Storage",
  "Wind",
  "Policy & Incentives",
  "Financing",
  "Installation & O&M",
  "Grid & Interconnection",
];

const DOC_TYPES = ["Guide", "Whitepaper", "Spec Sheet", "Template", "Case Study", "Video"];

const LEVELS = ["Beginner", "Intermediate", "Advanced"];

/* Each document: title, summary, category, type, level, date, readTime, author, tags, url */
const DOCUMENTS = [
  {
    title: "Commercial Solar PV: A Buyer's Guide",
    summary: "End-to-end overview of planning, sizing, and procuring a commercial rooftop or ground-mount PV system.",
    category: "Solar PV", type: "Guide", level: "Beginner",
    date: "2026-04-12", readTime: "14 min", author: "Novitium Energy Team",
    tags: ["rooftop", "procurement", "sizing"], url: "#",
  },
  {
    title: "Battery Energy Storage Sizing Worksheet",
    summary: "Editable worksheet to estimate kWh capacity, peak-shaving potential, and backup runtime for C&I sites.",
    category: "Energy Storage", type: "Template", level: "Intermediate",
    date: "2026-03-28", readTime: "Download", author: "Priya Nair, P.E.",
    tags: ["BESS", "peak shaving", "calculator"], url: "#",
  },
  {
    title: "Understanding the Investment Tax Credit (ITC)",
    summary: "How the federal ITC works for commercial solar and storage, including stacking with state incentives.",
    category: "Policy & Incentives", type: "Whitepaper", level: "Intermediate",
    date: "2026-02-09", readTime: "11 min", author: "Marcus Reed",
    tags: ["ITC", "tax", "incentives", "depreciation"], url: "#",
  },
  {
    title: "Power Purchase Agreement (PPA) Template",
    summary: "Starter PPA contract template with annotated clauses for term, escalator, and performance guarantees.",
    category: "Financing", type: "Template", level: "Advanced",
    date: "2026-01-20", readTime: "Download", author: "Legal & Finance Desk",
    tags: ["PPA", "contract", "financing"], url: "#",
  },
  {
    title: "Interconnection Application Checklist",
    summary: "Step-by-step utility interconnection checklist covering single-line diagrams, studies, and timelines.",
    category: "Grid & Interconnection", type: "Guide", level: "Intermediate",
    date: "2026-05-02", readTime: "9 min", author: "Dana Whitfield",
    tags: ["interconnection", "utility", "checklist"], url: "#",
  },
  {
    title: "Bifacial Module Spec Sheet — 580W",
    summary: "Datasheet for high-efficiency bifacial modules: electrical characteristics, temperature coefficients, warranty.",
    category: "Solar PV", type: "Spec Sheet", level: "Advanced",
    date: "2026-04-30", readTime: "PDF", author: "Manufacturer Specs",
    tags: ["modules", "bifacial", "datasheet"], url: "#",
  },
  {
    title: "O&M Best Practices for Commercial Arrays",
    summary: "Preventive maintenance schedule, cleaning cadence, and monitoring KPIs to protect long-term yield.",
    category: "Installation & O&M", type: "Guide", level: "Intermediate",
    date: "2026-03-15", readTime: "13 min", author: "Carlos Mendes",
    tags: ["maintenance", "monitoring", "yield"], url: "#",
  },
  {
    title: "Manufacturing Plant Cuts Energy Costs 42%",
    summary: "Case study: a 1.2 MW rooftop array paired with storage delivers demand-charge savings and resilience.",
    category: "Solar PV", type: "Case Study", level: "Beginner",
    date: "2026-02-26", readTime: "7 min", author: "Novitium Projects",
    tags: ["case study", "ROI", "demand charges"], url: "#",
  },
  {
    title: "How Net Metering Works (Video)",
    summary: "Six-minute explainer on net metering, net billing, and how exports are credited on commercial accounts.",
    category: "Policy & Incentives", type: "Video", level: "Beginner",
    date: "2026-01-08", readTime: "6 min", author: "VOLT Explains",
    tags: ["net metering", "billing", "explainer"], url: "#",
  },
  {
    title: "Wind-Solar Hybrid Feasibility Primer",
    summary: "When co-locating wind with solar makes sense: capacity factors, land use, and shared interconnection.",
    category: "Wind", type: "Whitepaper", level: "Advanced",
    date: "2026-05-18", readTime: "16 min", author: "Dr. Lena Hoffmann",
    tags: ["wind", "hybrid", "feasibility"], url: "#",
  },
  {
    title: "Roof Structural Load Assessment Template",
    summary: "Template for documenting dead/live loads and ballast calculations ahead of a rooftop solar install.",
    category: "Installation & O&M", type: "Template", level: "Advanced",
    date: "2026-04-04", readTime: "Download", author: "Engineering Desk",
    tags: ["structural", "ballast", "roofing"], url: "#",
  },
  {
    title: "MACRS Depreciation for Solar Assets",
    summary: "Modified Accelerated Cost Recovery System schedules and how bonus depreciation accelerates payback.",
    category: "Financing", type: "Whitepaper", level: "Advanced",
    date: "2026-03-01", readTime: "10 min", author: "Marcus Reed",
    tags: ["MACRS", "depreciation", "tax"], url: "#",
  },
];

/* Glossary terms — surfaced in search and used by the VOLT chatbot */
const GLOSSARY = [
  { term: "ITC", full: "Investment Tax Credit", def: "A federal tax credit that lets commercial owners deduct a percentage of a solar or storage system's cost from their federal taxes." },
  { term: "PPA", full: "Power Purchase Agreement", def: "A contract where a developer installs and owns a system on a customer's site, and the customer buys the generated electricity at a set rate." },
  { term: "BESS", full: "Battery Energy Storage System", def: "A system that stores electricity (typically in lithium-ion batteries) for later use, enabling peak shaving, backup power, and load shifting." },
  { term: "Net Metering", full: "Net Metering", def: "A billing arrangement that credits solar owners for electricity they export to the grid, offsetting power drawn at other times." },
  { term: "kWh", full: "Kilowatt-hour", def: "A unit of energy equal to using 1 kilowatt of power for one hour. It's what utilities bill you for." },
  { term: "kW", full: "Kilowatt", def: "A unit of power (rate of energy use). System size is often described in kW (or MW for larger arrays)." },
  { term: "Demand Charge", full: "Demand Charge", def: "A fee based on a facility's highest power draw in a billing period. Storage and solar can reduce these peaks." },
  { term: "Interconnection", full: "Grid Interconnection", def: "The utility approval process and physical connection that lets an on-site system safely feed power to the grid." },
  { term: "Bifacial", full: "Bifacial Module", def: "A solar panel that captures light on both its front and back surfaces, boosting energy yield on reflective sites." },
  { term: "MACRS", full: "Modified Accelerated Cost Recovery System", def: "A U.S. depreciation method that lets businesses recover solar investment costs over an accelerated schedule." },
  { term: "Capacity Factor", full: "Capacity Factor", def: "The ratio of actual energy produced to the maximum possible if a system ran at full output the entire time." },
  { term: "O&M", full: "Operations & Maintenance", def: "Ongoing activities — monitoring, cleaning, inspections, repairs — that keep an energy system performing over its life." },
];

/* Dual-environment export: usable as <script> globals in the browser AND as a
   CommonJS module on the Node backend (single source of truth for VOLT). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { CATEGORIES, DOC_TYPES, LEVELS, DOCUMENTS, GLOSSARY };
}
